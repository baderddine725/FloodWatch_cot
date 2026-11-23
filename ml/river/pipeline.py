# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : apprentissage automatique – données réelles ouvertes
#  Fichier   : ml/river/pipeline.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Guesmi Baderddine
#  Créé le   : 2026-11-23          Modifié le : 2026-11-23          Version : 1.0
# =============================================================================
"""Prévision de crue à 1, 2, 3 et 6 h apprise sur des MESURES RÉELLES (Calder, Environment Agency).

Même cycle que le modèle de la pile (``ml/forecast``), sur des données qui ne doivent rien au
simulateur. Protocole, fixé AVANT de regarder les résultats :

1. **Données.** Niveaux (15 min) de Todmorden, Hebden Bridge et Sowerby Bridge et pluie de quatre
   pluviomètres, de 2008 à aujourd'hui ; lectures « Suspect » écartées. Instantané versionné par
   empreinte du contenu.
2. **Découpage temporel** 70 / 15 / 15 % de la période, séparé de 6 h : on apprend sur le passé, on
   choisit sur la suite, on mesure sur les dernières années, jamais vues.
3. **Références** : persistance (« rien ne change ») et tendance de la dernière heure prolongée.
4. **Mesures** à chaque horizon : erreur absolue moyenne sur tout le test ET en **hautes eaux**
   (niveau à t ou à t + h ≥ 80 % du seuil « typical high ») ; **détection des débordements** : parmi
   les instants sous le seuil, le dépassement à t + h est-il annoncé ? (taux de détection, fausses
   alertes, indice de succès critique).
5. **Critère d'acceptation** : à CHAQUE horizon, erreur plus faible que les DEUX références sur tout
   le test et en hautes eaux ; évaluateur exporté identique à scikit-learn.
6. **Registre** : modèle accepté = challenger ; promu champion s'il n'y en a pas, ou s'il fait mieux
   en hautes eaux que le champion sur la période de test la plus récente. MLflow : expérience et
   modèle enregistré ``floodwatch-river-forecast``.

Échantillonnage de l'apprentissage seulement (la validation et le test restent complets) : tous les
instants « actifs » (pluie, montée, niveau ≥ 50 % du seuil) et 15 % des autres, pondérés par 1/0,15
pour que l'ensemble reste représentatif — 17 ans d'étiage ralentiraient l'apprentissage sans rien lui
apprendre.

Usage (depuis ``ml/``) ::

    python -m river.pipeline train              # télécharge (cache), apprend, évalue, enregistre
    python -m river.pipeline train --check      # code de sortie 1 si le critère n'est pas atteint
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from forecast import model as M
from forecast.registry import Registry, Tracker, write_atomic
from .sources import GAUGES, LICENCE, RAIN_GAUGES, fetch_all

LOG = logging.getLogger("river")
STEP = 900
HORIZONS = (4, 8, 12, 24)                       # pas de 15 min : 1, 2, 3 et 6 h
NAME = "floodwatch-river-forecast"
FEATURES = (
    "level_m", "level_norm",                    # niveau, niveau / seuil « typical high »
    "d15m_m", "d1h_m", "d3h_m",                 # variations sur 15 min, 1 h, 3 h
    "rain_mm", "rain_1h_mm", "rain_3h_mm", "rain_6h_mm", "rain_24h_mm",   # pluie moyenne du bassin
    "up_level_m", "up_d1h_m", "up_lag1h_m", "up_lag2h_m",               # station amont
    "has_upstream", "typical_high_m",
)
QUIET_KEEP = 0.15
SEED = 7
GRID = [{"n_estimators": 200, "max_depth": d, "learning_rate": 0.1, "subsample": 0.5, "min_samples_leaf": 50}
        for d in (3, 5)]


# ======================================================================================= grille
def to_grid(rows: list[tuple[int, float]], t0: int, n: int) -> np.ndarray:
    a = np.full(n, np.nan)
    if rows:
        ts = np.array([r[0] for r in rows])
        v = np.array([r[1] for r in rows])
        ok = (ts % STEP == 0) & (ts >= t0) & (ts < t0 + n * STEP)
        a[(ts[ok] - t0) // STEP] = v[ok]
    return a


def lag(a: np.ndarray, k: int) -> np.ndarray:
    out = np.full_like(a, np.nan)
    out[k:] = a[:-k]
    return out


def lead(a: np.ndarray, k: int) -> np.ndarray:
    out = np.full_like(a, np.nan)
    out[:-k] = a[k:]
    return out


def rolling_sum(a: np.ndarray, k: int) -> np.ndarray:
    """Somme des k derniers pas (pas courant compris) ; inconnue si un pas manque."""
    vals = np.concatenate([[0.0], np.cumsum(np.nan_to_num(a))])
    miss = np.concatenate([[0], np.cumsum(np.isnan(a))])
    out = np.full_like(a, np.nan)
    out[k - 1:] = vals[k:] - vals[:-k]
    bad = np.zeros_like(a, dtype=bool)
    bad[k - 1:] = (miss[k:] - miss[:-k]) > 0
    bad[:k - 1] = True
    out[bad] = np.nan
    return out


def catchment_rain(rains: list[np.ndarray]) -> np.ndarray:
    """Moyenne des pluviomètres présents, si au moins deux le sont."""
    stack = np.vstack(rains)
    present = (~np.isnan(stack)).sum(axis=0)
    with np.errstate(invalid="ignore"):
        mean = np.nanmean(np.where(np.isnan(stack), np.nan, stack), axis=0)
    mean[present < 2] = np.nan
    return mean


class Grid:
    """Séries alignées sur une grille commune de 15 min, et leur empreinte."""

    def __init__(self, series: dict[str, list[tuple[int, float]]]):
        t0 = min(rows[0][0] for rows in series.values() if rows)
        t1 = max(rows[-1][0] for rows in series.values() if rows)
        self.t0 = t0 - t0 % STEP
        self.n = (t1 - self.t0) // STEP + 1
        self.arrays = {k: to_grid(rows, self.t0, self.n) for k, rows in sorted(series.items())}
        h = hashlib.sha256(np.int64(self.t0).tobytes())
        for k, a in self.arrays.items():
            h.update(k.encode()), h.update(a.tobytes())
        self.sha256 = h.hexdigest()
        self.id = self.sha256[:12]
        self.t = self.t0 + STEP * np.arange(self.n)

    def manifest(self) -> dict:
        return {"id": self.id, "sha256": self.sha256, "source": "environment-agency-hydrology", "licence": LICENCE,
                "from": datetime.fromtimestamp(self.t0, timezone.utc).isoformat(),
                "to": datetime.fromtimestamp(int(self.t[-1]), timezone.utc).isoformat(), "stepS": STEP,
                "rows": int(sum(np.isfinite(a).sum() for a in self.arrays.values())),
                "perSeries": {k: int(np.isfinite(a).sum()) for k, a in self.arrays.items()},
                "gauges": {c: {"reference": g[0], "measure": g[1], "typicalHighM": g[2], "upstream": g[3]}
                           for c, g in GAUGES.items()},
                "rainGauges": RAIN_GAUGES}

    def save(self, root: Path) -> Path:
        folder = root / "datasets" / self.id
        if not (folder / "manifest.json").is_file():
            folder.mkdir(parents=True, exist_ok=True)
            np.savez_compressed(folder / "grid.npz", t0=np.int64(self.t0), **self.arrays)
            write_atomic(folder / "manifest.json", json.dumps(self.manifest(), indent=2) + "\n")
        return folder


# ======================================================================================= exemples
def station_features(g: Grid, code: str, rain: np.ndarray, rain_sums: dict[int, np.ndarray]) -> np.ndarray:
    _, _, typical, upstream = GAUGES[code]
    lv = g.arrays[f"level:{code}"]
    if upstream:
        up = g.arrays[f"level:{upstream}"]
        up_cols = [up, up - lag(up, 4), lag(up, 4), lag(up, 8)]
    else:
        zero = np.zeros(g.n)
        up_cols = [zero, zero, zero, zero]
    cols = [lv, lv / typical, lv - lag(lv, 1), lv - lag(lv, 4), lv - lag(lv, 12),
            rain, rain_sums[4], rain_sums[12], rain_sums[24], rain_sums[96],
            *up_cols, np.full(g.n, 1.0 if upstream else 0.0), np.full(g.n, typical)]
    return np.column_stack(cols)


def build(g: Grid, k: int) -> dict:
    """Exemples de toutes les stations pour l'horizon k (pas de 15 min)."""
    rain = catchment_rain([g.arrays[f"rain:{c}"] for c in RAIN_GAUGES])
    sums = {w: rolling_sum(rain, w) for w in (4, 12, 24, 96)}
    parts = {"t": [], "X": [], "y": [], "level": [], "typical": [], "code": []}
    for code in GAUGES:
        X = station_features(g, code, rain, sums)
        lv = g.arrays[f"level:{code}"]
        y = lead(lv, k) - lv
        ok = np.isfinite(X).all(axis=1) & np.isfinite(y)
        parts["t"].append(g.t[ok]), parts["X"].append(X[ok]), parts["y"].append(y[ok])
        parts["level"].append(lv[ok]), parts["typical"].append(np.full(ok.sum(), GAUGES[code][2]))
        parts["code"].append(np.full(ok.sum(), code))
    return {key: np.concatenate(v) for key, v in parts.items()}


def select(d: dict, mask: np.ndarray) -> dict:
    return {key: v[mask] for key, v in d.items()}


def training_sample(d: dict, rng: np.random.Generator) -> tuple[dict, np.ndarray]:
    """Instants actifs + 15 % des instants calmes, pondérés pour rester représentatifs."""
    F = {n: i for i, n in enumerate(FEATURES)}
    X = d["X"]
    active = (X[:, F["rain_6h_mm"]] > 0.5) | (X[:, F["level_norm"]] > 0.5) | (np.abs(X[:, F["d1h_m"]]) > 0.02)
    keep = active | (rng.random(len(X)) < QUIET_KEEP)
    weights = np.where(active, 1.0, 1.0 / QUIET_KEEP)[keep]
    return select(d, keep), weights


# ======================================================================================= mesures
def trend(d: dict, k: int) -> np.ndarray:
    return d["X"][:, FEATURES.index("d1h_m")] * k / 4.0


def errors(d: dict, delta: np.ndarray) -> dict:
    """Erreurs en cm (unité du projet), sur tout le test et en hautes eaux."""
    err = (d["level"] + delta) - (d["level"] + d["y"])
    high = np.maximum(d["level"], d["level"] + d["y"]) >= 0.8 * d["typical"]

    def stats(e):
        if not len(e):
            return {"n": 0, "maeCm": None, "biasCm": None, "rmseCm": None}
        return {"n": int(len(e)), "maeCm": round(float(np.mean(np.abs(e))) * 100, 3),
                "biasCm": round(float(np.mean(e)) * 100, 3), "rmseCm": round(float(np.sqrt(np.mean(e ** 2))) * 100, 3)}

    return {**stats(err), "highWater": stats(err[high])}


def events(d: dict, delta: np.ndarray) -> dict:
    """Détection des dépassements du seuil à t + h, parmi les instants encore sous le seuil."""
    below = d["level"] < d["typical"]
    actual = (d["level"] + d["y"] >= d["typical"])[below]
    pred = (d["level"] + delta >= d["typical"])[below]
    hits, misses, false = int(np.sum(actual & pred)), int(np.sum(actual & ~pred)), int(np.sum(~actual & pred))
    return {"crossings": hits + misses, "hits": hits, "misses": misses, "falseAlarms": false,
            "pod": round(hits / (hits + misses), 3) if hits + misses else None,
            "far": round(false / (hits + false), 3) if hits + false else None,
            "csi": round(hits / (hits + misses + false), 3) if hits + misses + false else None}


def predict_np(horizon: dict, X: np.ndarray) -> np.ndarray:
    """Évaluateur vectorisé du format exporté (même règle que predict_json : float32, <=, somme ordonnée)."""
    xf = X.astype(np.float32).astype(np.float64)
    out = np.full(len(X), horizon["init"])
    rows = np.arange(len(X))
    for tree in horizon["trees"]:
        f, thr = np.array(tree["f"]), np.array(tree["t"])
        left, right, val = np.array(tree["l"]), np.array(tree["r"]), np.array(tree["v"])
        node = np.zeros(len(X), dtype=int)
        while True:
            inner = f[node] >= 0
            if not inner.any():
                break
            go_left = xf[rows, np.maximum(f[node], 0)] <= thr[node]
            node = np.where(inner, np.where(go_left, left[node], right[node]), node)
        out += horizon["learningRate"] * val[node]
    return out


# ======================================================================================= apprentissage
def train(root: Path, last_year: int | None = None, tracker: Tracker | None = None) -> dict:
    series = fetch_all(root / "raw", last_year)
    g = Grid(series)
    g.save(root)
    created = datetime.now(timezone.utc)
    model_id = f"river-gbt-{created:%Y%m%d%H%M}-{g.id[:6]}"
    split = M.time_split(float(g.t[0]), float(g.t[-1]), gap_s=24 * STEP)
    report = {"modelId": model_id, "createdAt": created.isoformat(timespec="seconds"), "dataset": g.manifest(),
              "features": list(FEATURES), "split": {k: [datetime.fromtimestamp(a, timezone.utc).date().isoformat(),
                                                        datetime.fromtimestamp(b, timezone.utc).date().isoformat()]
                                                    for k, (a, b) in split.items()},
              "horizons": [], "accepted": False, "problems": [], "licence": LICENCE}
    rng = np.random.default_rng(SEED)
    exported = []
    for k in HORIZONS:
        sec = k * STEP
        d = build(g, k)
        part = {name: select(d, (d["t"] >= a) & (d["t"] <= b)) for name, (a, b) in split.items()}
        tr, w = training_sample(part["train"], rng)
        va = part["validation"]
        te = part["test"]
        if min(len(tr["y"]), len(va["y"]), len(te["y"])) < 1000:
            report["problems"].append(f"h={sec // 3600} h : trop peu d'exemples")
            continue
        trials = []
        for params in GRID:
            m = M.GradientBoostingRegressor(loss="squared_error", random_state=SEED, **params)
            m.fit(tr["X"].astype(np.float32), tr["y"], sample_weight=w)
            mae = float(np.mean(np.abs(m.predict(va["X"].astype(np.float32)) - va["y"])))
            trials.append({**params, "valMaeCm": round(mae * 100, 3)})
            LOG.info("h=%d h profondeur %d : validation %.2f cm", sec // 3600, params["max_depth"], mae * 100)
        best = min(trials, key=lambda r: (r["valMaeCm"], r["max_depth"]))
        params = {key: best[key] for key in GRID[0]}
        trva, wva = training_sample(select(d, d["t"] <= split["validation"][1]), rng)
        final = M.GradientBoostingRegressor(loss="squared_error", random_state=SEED, **params)
        final.fit(trva["X"].astype(np.float32), trva["y"], sample_weight=wva)
        exp = M.export_horizon(final, sec)
        sk = final.predict(te["X"].astype(np.float32))
        parity = float(np.max(np.abs(sk - predict_np(exp, te["X"]))))
        test = {"model": errors(te, sk), "persistence": errors(te, np.zeros(len(te["y"]))),
                "linear": errors(te, trend(te, k))}
        ev = {"model": events(te, sk), "linear": events(te, trend(te, k))}
        ok = all(test["model"][key] < min(test["persistence"][key], test["linear"][key]) for key in ("maeCm",)) \
            and test["model"]["highWater"]["maeCm"] < min(test["persistence"]["highWater"]["maeCm"],
                                                         test["linear"]["highWater"]["maeCm"]) \
            and parity <= 1e-9
        if not ok:
            report["problems"].append(f"h={sec // 3600} h : critère non atteint")
        skill = 1 - test["model"]["highWater"]["maeCm"] / test["persistence"]["highWater"]["maeCm"]
        report["horizons"].append({"sec": sec, "params": params, "trials": trials, "test": test, "events": ev,
                                   "skill": round(skill, 4), "evaluatorMaxDiff": parity, "accepted": ok,
                                   "samples": {"train": int(len(trva["y"])), "test": int(len(te["y"]))},
                                   "importance": dict(sorted(zip(FEATURES, (round(float(v), 4) for v in
                                                                            final.feature_importances_)),
                                                             key=lambda kv: -kv[1])[:6])})
        exported.append(exp)
    report["accepted"] = not report["problems"] and len(exported) == len(HORIZONS)
    write_atomic(root / "reports" / f"{model_id}.json", json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    show(report)
    model = None
    if report["accepted"]:
        model = {"format": M.FORMAT, "modelId": model_id, "createdAt": report["createdAt"], "features": list(FEATURES),
                 "stepS": STEP, "dataset": g.manifest(), "licence": LICENCE,
                 "metrics": {str(h["sec"]): h["test"] for h in report["horizons"]}, "horizons": exported}
    register(root, report, model, g, tracker)
    return report


def register(root: Path, report: dict, model: dict | None, g: Grid, tracker: Tracker | None) -> None:
    reg = Registry(root)
    path = None
    if model:
        path = reg.models / f"{model['modelId']}.json"
        write_atomic(path, json.dumps(model, separators=(",", ":")) + "\n")
    version = tracker.log_training(report, model, path) if tracker else None
    if not model:
        st = reg.state()
        reg.event(st, "rejected-offline", model=report["modelId"], problems=report["problems"])
        reg.save(st)
        return
    reg.add_challenger(model, version)
    champion = reg.model(reg.state().get("champion"))
    if champion is None:
        reg.promote({"reason": "premier modèle accepté sur données réelles"})
        if tracker:
            tracker.alias("champion", version)
        return
    # champion et challenger sur la MÊME période de test (la plus récente) : hautes eaux
    split = M.time_split(float(g.t[0]), float(g.t[-1]), gap_s=24 * STEP)
    champ_hw = chall_hw = 0.0
    for h in champion["horizons"]:
        k = h["sec"] // STEP
        d = build(g, k)
        te = select(d, (d["t"] >= split["test"][0]) & (d["t"] <= split["test"][1]))
        champ_hw += errors(te, predict_np(h, te["X"]))["highWater"]["maeCm"]
        chall_hw += next(x for x in report["horizons"] if x["sec"] == h["sec"])["test"]["model"]["highWater"]["maeCm"]
    if chall_hw < champ_hw:
        reg.promote({"highWaterSumMaeCm": round(chall_hw, 3), "championHighWaterSumMaeCm": round(champ_hw, 3)})
        if tracker:
            tracker.alias("champion", version)
    else:
        st = reg.state()
        reg.event(st, "rejected-vs-champion", model=st["challenger"], highWaterSumMaeCm=round(chall_hw, 3),
                  championHighWaterSumMaeCm=round(champ_hw, 3))
        st["challenger"] = None
        reg.save(st)


def show(r: dict) -> None:
    print(f"\n===== {r['modelId']} — Calder (Environment Agency), {r['dataset']['from'][:10]} → "
          f"{r['dataset']['to'][:10]}, test {r['split']['test'][0]} → {r['split']['test'][1]}")
    print("horizon |  erreur moyenne (cm)        |  hautes eaux (cm)          | débordements annoncés")
    print("        |  modèle  persist. tendance  |  modèle  persist. tendance | modèle (détection / fausses) · tendance")
    for h in r["horizons"]:
        t, e = h["test"], h["events"]
        hw = {n: t[n]["highWater"]["maeCm"] for n in ("model", "persistence", "linear")}
        print(f"  {h['sec'] // 3600} h   | {t['model']['maeCm']:7.2f} {t['persistence']['maeCm']:8.2f} "
              f"{t['linear']['maeCm']:8.2f}  | {hw['model']:7.2f} {hw['persistence']:8.2f} {hw['linear']:8.2f} | "
              f"{e['model']['hits']}/{e['model']['crossings']} ({e['model']['falseAlarms']} fausses) · "
              f"{e['linear']['hits']}/{e['linear']['crossings']} ({e['linear']['falseAlarms']})")
    print("ACCEPTÉ" if r["accepted"] else "REFUSÉ :\n  - " + "\n  - ".join(r["problems"]))
    print(LICENCE)


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("train")
    t.add_argument("--last-year", type=int, default=None)
    t.add_argument("--check", action="store_true")
    a = p.parse_args(argv)
    root = Path(os.environ.get("ML_HOME", Path(__file__).resolve().parents[1] / "var")) / "river"
    started = time.time()
    report = train(root, a.last_year, Tracker(NAME, NAME))
    LOG.info("terminé en %.0f s", time.time() - started)
    return 0 if report["accepted"] or not a.check else 1


if __name__ == "__main__":
    sys.exit(main())

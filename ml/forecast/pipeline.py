# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : apprentissage automatique – cloud (prévision du niveau)
#  Fichier   : ml/forecast/pipeline.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Guesmi Baderddine
#  Créé le   : 2026-11-23          Modifié le : 2026-11-23          Version : 1.0
# =============================================================================
"""Cycle MLOps du modèle de prévision du niveau : données → apprentissage → critères → registre →
évaluation EN SERVICE → promotion → surveillance → réapprentissage.

Protocole, fixé AVANT de regarder les résultats :

1. **Données.** Instantané versionné de la télémétrie acceptée par le middleware (``data.py``).
2. **Découpage temporel** 70 / 15 / 15 %, séparé d'un horizon maximal (30 min) : on apprend sur le
   passé, on choisit sur la suite, on mesure sur la fin, jamais vue.
3. **Références** à chaque horizon : persistance (« rien ne change ») et tendance des 2 dernières
   minutes (la régression du moteur d'alerte).
4. **Critère d'acceptation hors ligne** (à chaque horizon, sur le test) : erreur absolue moyenne
   inférieure à CELLES DES DEUX références, au moins 100 exemples, et évaluateur exporté identique à
   scikit-learn. Sinon le modèle n'est pas déployé (l'exécution reste tracée).
5. **Évaluation en service (ombre).** Le modèle accepté devient *challenger* : le middleware enregistre
   ses prévisions sans s'en servir, et les note sur les mesures réelles comme les autres modèles.
6. **Promotion** (comparaison APPARIÉE : mêmes stations, mêmes instants, mêmes horizons, 24 h) : au moins
   100 paires par horizon (1, 3, 5, 10 min), somme des erreurs moyennes inférieure à celle du sortant,
   et aucun horizon pire de plus de 5 %. Le sortant est le champion, ou à défaut la régression du
   moteur d'alerte : un premier champion doit battre la référence EN SERVICE.
7. **Rétrogradation.** Un champion que la régression bat (même règle) est retiré : la prévision
   retombe sur les autres méthodes.
8. **Surveillance.** Dérive des indicateurs (PSI, 10 classes) entre l'apprentissage du modèle en
   service et les dernières 24 h ; erreurs en service de chaque modèle. Une dérive (PSI > 0,25)
   déclenche un réapprentissage, sinon toutes les ``ML_RETRAIN_HOURS`` heures.
9. **Démarrage à froid.** Tant que la base compte moins de 12 h de télémétrie et qu'aucun modèle
   n'existe, le premier challenger est appris sur le banc simulé (48 h). Il passe par la même
   évaluation en service : il ne sert que s'il bat la régression sur les mesures RÉELLES, puis il est
   remplacé par un modèle appris sur la base dès qu'elle suffit.

Usage (depuis la racine du dépôt, ``ML_HOME`` = dossier de travail, défaut ``ml/var``) ::

    python -m forecast.pipeline train --source sim --hours 48      # hors pile (banc du fog)
    python -m forecast.pipeline train --source db                  # sur la télémétrie de PostgreSQL
    python -m forecast.pipeline evaluate                           # promotion / rétrogradation
    python -m forecast.pipeline monitor                            # dérive et erreurs en service
    python -m forecast.pipeline loop                               # service d'apprentissage (Docker)
    python -m forecast.pipeline fixture [--check]                  # données du test de parité Java
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import model as M
from .data import REPO, Dataset, from_db, from_sim
from .features import FEATURES, GRID_S, HORIZONS_S, MEDIAN_WINDOW_S, STALE_S, features
from .registry import Registry, Tracker, now_iso, write_atomic

LOG = logging.getLogger("forecast")
#: modèle de référence du middleware (AlertEngine.modelId())
REFERENCE = os.environ.get("ML_REFERENCE_MODEL", "median+linreg-120s")
LIVE_HORIZONS = (60, 180, 300, 600)
MIN_TEST = 100
MIN_SPAN_H = 3.0
#: télémétrie réelle exigée avant d'apprendre sur la base (en deçà : démarrage à froid sur le banc)
MIN_DB_SPAN_H = float(os.environ.get("ML_MIN_DB_HOURS", "12"))
MIN_PAIRS = int(os.environ.get("ML_MIN_PAIRS", "100"))
WINDOW_H = float(os.environ.get("ML_EVAL_WINDOW_HOURS", "24"))
TOLERANCE = 0.05
PSI_DRIFT = 0.25
PARITY_FIXTURE = REPO / "middleware" / "api" / "src" / "test" / "resources" / "forecast_parity.json"


def home() -> Path:
    return Path(os.environ.get("ML_HOME", REPO / "ml" / "var"))


# ============================================================================================ train
def train(ds: Dataset, root: Path, tracker: Tracker | None = None, register: bool = True) -> dict:
    folder = ds.save(root)
    LOG.info("instantané %s : %d mesures (%s)", ds.id, len(ds.rows), folder)
    data = ds.series()
    t0 = min(s.ts[0] for s in data.values()) if data else 0.0
    t1 = max(s.ts[-1] for s in data.values()) if data else 0.0
    created = datetime.now(timezone.utc)
    model_id = f"gbt-{created:%Y%m%d%H%M}-{ds.id[:6]}"
    report = {"modelId": model_id, "createdAt": created.isoformat(timespec="seconds"), "dataset": ds.manifest,
              "features": list(FEATURES), "spanHours": round((t1 - t0) / 3600, 2), "horizons": [], "accepted": False,
              "problems": []}
    if (t1 - t0) / 3600 < MIN_SPAN_H:
        report["problems"].append(f"données insuffisantes : {report['spanHours']} h < {MIN_SPAN_H} h")
        return _finish(report, None, root, tracker, register)
    split = M.time_split(t0, t1)
    report["split"] = {k: [round(a, 1), round(b, 1)] for k, (a, b) in split.items()}
    exported_h = []
    for h in HORIZONS_S:
        all_s = M.build_samples(ds.sites, data, h)
        # chaque période s'arrête un horizon maximal avant la suivante : la cible t + h n'y déborde pas
        tr, va, te = (M.window(all_s, *split[k]) for k in ("train", "validation", "test"))
        if min(len(tr.y), len(va.y), len(te.y)) < MIN_TEST:
            report["problems"].append(f"h={h}s : trop peu d'exemples (apprentissage {len(tr.y)}, "
                                      f"validation {len(va.y)}, test {len(te.y)})")
            continue
        params, trials = M.choose(tr, va)
        final = M.fit(M.Samples(np.concatenate([tr.t, va.t]), tr.code + va.code, np.vstack([tr.X, va.X]),
                                np.concatenate([tr.y, va.y]), np.concatenate([tr.level, va.level]),
                                np.concatenate([tr.height, va.height])), params)
        exp = M.export_horizon(final, h)
        sk = final.predict(te.X.astype(np.float32))
        js = np.array([M.predict_json(exp, list(x)) for x in te.X])
        parity = float(np.max(np.abs(sk - js))) if len(js) else 0.0
        test = {"model": M.metrics(te, sk), "persistence": M.metrics(te, M.persistence(te, h)),
                "linear": M.metrics(te, M.linear(te, h))}
        skill = 1.0 - test["model"]["maeCm"] / test["persistence"]["maeCm"] if test["persistence"]["maeCm"] else 0.0
        ok = (test["model"]["maeCm"] < test["persistence"]["maeCm"] and test["model"]["maeCm"] < test["linear"]["maeCm"]
              and parity <= 1e-9)
        if not ok:
            report["problems"].append(f"h={h}s : critère non atteint (modèle {test['model']['maeCm']} cm, persistance "
                                      f"{test['persistence']['maeCm']}, tendance {test['linear']['maeCm']}, "
                                      f"écart d'évaluateur {parity:.2e})")
        importance = dict(sorted(zip(FEATURES, (round(float(v), 4) for v in final.feature_importances_)),
                                 key=lambda kv: -kv[1])[:6])
        report["horizons"].append({"sec": h, "params": params, "trials": trials, "test": test,
                                   "skill": round(skill, 4), "evaluatorMaxDiff": parity, "accepted": ok,
                                   "samples": {"train": len(tr.y), "validation": len(va.y), "test": len(te.y)},
                                   "importance": importance})
        exported_h.append(exp)
    report["accepted"] = not report["problems"] and len(exported_h) == len(HORIZONS_S)
    exported = None
    if report["accepted"]:
        exported = {"format": M.FORMAT, "modelId": model_id, "createdAt": report["createdAt"], "features": list(FEATURES),
                    "featureSpec": {"gridS": GRID_S, "medianWindowS": MEDIAN_WINDOW_S, "staleS": STALE_S},
                    "dataset": ds.manifest,
                    "metrics": {str(h["sec"]): h["test"] for h in report["horizons"]},
                    "horizons": exported_h}
    return _finish(report, exported, root, tracker, register)


def _finish(report: dict, exported: dict | None, root: Path, tracker: Tracker | None, register: bool) -> dict:
    reports = root / "reports"
    write_atomic(reports / f"{report['modelId']}.json", json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    show(report)
    if not register:
        return report
    reg = Registry(root)
    path = None
    if exported:
        path = reg.models / f"{exported['modelId']}.json"
        write_atomic(path, json.dumps(exported, separators=(",", ":")) + "\n")
    version = tracker.log_training(report, exported, path) if tracker else None
    if exported:
        reg.add_challenger(exported, version)
    else:
        st = reg.state()
        reg.event(st, "rejected-offline", model=report["modelId"], problems=report["problems"])
        reg.save(st)
    return report


def show(report: dict) -> None:
    print(f"\n===== {report['modelId']} — instantané {report['dataset']['id']} ({report['dataset']['source']}, "
          f"{report['dataset']['rows']} mesures, {report['spanHours']} h)")
    print("horizon   exemples(test)   modèle    persistance   tendance   gain/persistance   accepté")
    for h in report["horizons"]:
        t = h["test"]
        print(f"{h['sec'] // 60:>4} min   {h['samples']['test']:>10}   {t['model']['maeCm']:>7.3f}   "
              f"{t['persistence']['maeCm']:>10.3f}   {t['linear']['maeCm']:>8.3f}   {h['skill']:>+15.3f}   "
              f"{'oui' if h['accepted'] else 'NON'}")
    print("ACCEPTÉ : déployé comme challenger (évaluation en ombre)" if report["accepted"]
          else "REFUSÉ :\n  - " + "\n  - ".join(report["problems"]))


# ======================================================================================= en service
def _connect():
    import psycopg

    dsn = os.environ.get("ML_DB_DSN") or (
        f"host={os.environ.get('DB_HOST', 'postgres')} port={os.environ.get('DB_PORT', '5432')} "
        f"dbname={os.environ.get('DB_NAME', 'floodwatch')} user={os.environ.get('DB_USER', 'floodwatch')} "
        f"password={os.environ.get('DB_PASSWORD', '')}")
    conn = psycopg.connect(dsn, autocommit=True)
    conn.read_only = True
    return conn


PAIRED_SQL = """
WITH a AS (SELECT station_id, generated_at, horizon_sec, abs(error_cm) AS e FROM prediction_records
           WHERE model = %(a)s AND status = 'SCORED' AND generated_at >= now() - make_interval(secs => %(w)s)),
     b AS (SELECT station_id, generated_at, horizon_sec, abs(error_cm) AS e FROM prediction_records
           WHERE model = %(b)s AND status = 'SCORED' AND generated_at >= now() - make_interval(secs => %(w)s))
SELECT a.horizon_sec, count(*), avg(a.e), avg(b.e)
FROM a JOIN b USING (station_id, generated_at, horizon_sec) GROUP BY 1 ORDER BY 1
"""


def compare(rows: list[tuple], min_pairs: int = MIN_PAIRS, tolerance: float = TOLERANCE) -> dict:
    """Règle de promotion (point 6) sur des lignes (horizon_s, paires, erreur du candidat, erreur du sortant)."""
    by_h = {int(h): (int(n), float(a), float(b)) for h, n, a, b in rows}
    detail = {str(h): {"pairs": v[0], "candidateMaeCm": round(v[1], 4), "incumbentMaeCm": round(v[2], 4)}
              for h, v in by_h.items()}
    if any(h not in by_h or by_h[h][0] < min_pairs for h in LIVE_HORIZONS):
        return {"decision": "wait", "perHorizon": detail}
    cand = sum(by_h[h][1] for h in LIVE_HORIZONS)
    inc = sum(by_h[h][2] for h in LIVE_HORIZONS)
    no_regression = all(by_h[h][1] <= by_h[h][2] * (1 + tolerance) for h in LIVE_HORIZONS)
    return {"decision": "better" if cand < inc and no_regression else "worse", "candidateSumMaeCm": round(cand, 4),
            "incumbentSumMaeCm": round(inc, 4), "perHorizon": detail}


def evaluate(root: Path, tracker: Tracker | None = None, conn=None) -> dict:
    reg = Registry(root)
    st = reg.state()
    own = conn is None
    conn = conn or _connect()
    out = {}
    try:
        def paired(a, b):
            return conn.execute(PAIRED_SQL, {"a": a, "b": b, "w": WINDOW_H * 3600}).fetchall()

        if st.get("challenger"):
            incumbent = st.get("champion") or REFERENCE
            res = compare(paired(st["challenger"], incumbent))
            out["challenger"] = {"model": st["challenger"], "against": incumbent, **res}
            if res["decision"] == "better":
                reg.promote({"against": incumbent, "sumMaeCm": res["candidateSumMaeCm"],
                             "incumbentSumMaeCm": res["incumbentSumMaeCm"]})
                if tracker:
                    tracker.alias("champion", reg.state().get("mlflow", {}).get(st["challenger"]))
            elif res["decision"] == "worse":
                st = reg.state()
                reg.event(st, "rejected-live", model=st["challenger"], against=incumbent,
                          sumMaeCm=res["candidateSumMaeCm"], incumbentSumMaeCm=res["incumbentSumMaeCm"])
                st["challenger"] = None
                reg.save(st)
        st = reg.state()
        if st.get("champion"):
            res = compare(paired(REFERENCE, st["champion"]))
            out["champion"] = {"model": st["champion"], "reference": REFERENCE, **res}
            if res["decision"] == "better":           # la référence bat le champion : retrait
                reg.demote({"reference": REFERENCE, "referenceSumMaeCm": res["candidateSumMaeCm"],
                            "championSumMaeCm": res["incumbentSumMaeCm"]})
    finally:
        if own:
            conn.close()
    LOG.info("évaluation en service : %s", json.dumps(out, ensure_ascii=False))
    return out


# ======================================================================================= surveillance
def psi(reference: np.ndarray, current: np.ndarray, bins: int = 10) -> float | None:
    """Indice de stabilité de population ; None si l'indicateur est constant ou les données trop rares."""
    if len(reference) < 50 or len(current) < 50 or np.ptp(reference) == 0:
        return None
    edges = np.unique(np.quantile(reference, np.linspace(0, 1, bins + 1)[1:-1]))
    if len(edges) == 0:
        return None
    ref = np.bincount(np.searchsorted(edges, reference, side="right"), minlength=len(edges) + 1) / len(reference)
    cur = np.bincount(np.searchsorted(edges, current, side="right"), minlength=len(edges) + 1) / len(current)
    ref, cur = np.clip(ref, 1e-4, None), np.clip(cur, 1e-4, None)
    return float(np.sum((cur - ref) * np.log(cur / ref)))


def feature_matrix(ds: Dataset, start: float | None = None, end: float | None = None, limit: int = 5000) -> np.ndarray:
    s = M.build_samples(ds.sites, ds.series(), 600, start, end)
    if len(s.X) > limit:
        s = M.subset(s, np.linspace(0, len(s.X) - 1, limit).astype(int))
    return s.X


def monitor(root: Path, tracker: Tracker | None = None, current: Dataset | None = None, conn=None) -> dict:
    reg = Registry(root)
    st = reg.state()
    serving = st.get("champion") or st.get("challenger")
    report = {"at": now_iso(), "model": serving, "psi": {}, "drift": False, "live": []}
    m = reg.model(serving)
    if m:
        ref_ds = Dataset.load(root / "datasets" / m["dataset"]["id"])
        data = ref_ds.series()
        t0 = min(s.ts[0] for s in data.values())
        t1 = max(s.ts[-1] for s in data.values())
        ref = feature_matrix(ref_ds, *M.time_split(t0, t1)["train"])
        current = current or from_db(days=WINDOW_H / 24)
        cur = feature_matrix(current)
        for i, name in enumerate(FEATURES):
            v = psi(ref[:, i], cur[:, i]) if len(cur) else None
            if v is not None:
                report["psi"][name] = round(v, 4)
        report["drift"] = any(v > PSI_DRIFT for v in report["psi"].values())
        report["currentSamples"] = int(len(cur))
    own = conn is None
    try:
        conn = conn or _connect()
        for model, h, n, mae, bias in conn.execute(
                "SELECT model, horizon_sec, count(*), avg(abs(error_cm)), avg(error_cm) FROM prediction_records "
                "WHERE status = 'SCORED' AND generated_at >= now() - make_interval(secs => %s) GROUP BY 1, 2 ORDER BY 1, 2",
                (WINDOW_H * 3600,)):
            report["live"].append({"model": model, "horizonSec": h, "scored": n, "maeCm": round(float(mae), 4),
                                   "biasCm": round(float(bias), 4)})
    except Exception as e:  # noqa: BLE001 – la surveillance ne doit pas arrêter le cycle
        report["liveError"] = str(e)
    finally:
        if own and conn is not None:
            conn.close()
    reg.set_monitoring(report)
    if tracker:
        tracker.log_monitoring(report)
    LOG.info("surveillance : dérive=%s psi=%s", report["drift"], report["psi"])
    return report


# ======================================================================================= boucle
def loop(root: Path) -> None:
    """Service d'apprentissage : évaluation et surveillance à chaque cycle, apprentissage à échéance."""
    cycle_s = float(os.environ.get("ML_CYCLE_MINUTES", "30")) * 60
    retrain_s = float(os.environ.get("ML_RETRAIN_HOURS", "6")) * 3600
    stale_challenger_s = float(os.environ.get("ML_CHALLENGER_MAX_HOURS", "48")) * 3600
    days = float(os.environ.get("ML_TRAIN_DAYS", "14"))
    cold_start_h = float(os.environ.get("ML_COLD_START_SIM_HOURS", "48"))
    tracker = Tracker()
    last_train = 0.0
    river_every_s = float(os.environ.get("ML_RIVER_RETRAIN_DAYS", "7")) * 86400
    last_river = 0.0
    while True:
        if river_every_s > 0 and time.time() - last_river >= river_every_s:
            # modèle sur DONNÉES RÉELLES ouvertes (Environment Agency) : nouvelles lectures chaque semaine
            try:
                from river import pipeline as river

                river.train(root / "river", tracker=Tracker(river.NAME, river.NAME))
            except Exception:  # noqa: BLE001 – réseau ou service de l'agence indisponible : on réessaiera
                LOG.exception("apprentissage sur données réelles en échec")
            last_river = time.time()
        try:
            evaluate(root, tracker)
            mon = monitor(root, tracker)
            st = Registry(root).state()
            challenger_age = _age_s(st, "challenger")
            due = time.time() - last_train >= retrain_s
            if (not st.get("challenger") or challenger_age > stale_challenger_s) and (due or mon["drift"]
                                                                                      or not st.get("champion")):
                LOG.info("apprentissage (échéance=%s, dérive=%s)", due, mon["drift"])
                ds = from_db(days=days)
                if ds.span_hours() < MIN_DB_SPAN_H and not st.get("champion") and not st.get("challenger") \
                        and cold_start_h > 0:
                    # démarrage à froid : pas encore assez de télémétrie. Premier challenger appris sur le
                    # banc simulé ; il ne servira que s'il bat la régression SUR LES MESURES RÉELLES.
                    LOG.info("démarrage à froid : %.1f h de télémétrie < %.0f h, apprentissage sur %g h simulées",
                             ds.span_hours(), MIN_DB_SPAN_H, cold_start_h)
                    ds = from_sim(seed=1, hours=cold_start_h)
                elif ds.span_hours() < MIN_DB_SPAN_H:
                    LOG.info("%.1f h de télémétrie < %.0f h : apprentissage reporté", ds.span_hours(), MIN_DB_SPAN_H)
                    last_train = time.time()
                    time.sleep(cycle_s)
                    continue
                train(ds, root, tracker)
                last_train = time.time()
        except Exception:  # noqa: BLE001 – un cycle raté ne tue pas le service
            LOG.exception("cycle MLOps en échec")
        time.sleep(cycle_s)


def _age_s(state: dict, role: str) -> float:
    for e in reversed(state.get("events", [])):
        if e["event"] == role and e.get("model") == state.get(role):
            return time.time() - datetime.fromisoformat(e["at"]).timestamp()
    return math.inf if state.get(role) else 0.0


# ======================================================================================= parité Java
def fixture() -> dict:
    """Mesures, petit modèle et vecteurs attendus pour ``LearnedForecastParityTest`` (middleware)."""
    ds = from_sim(seed=11, hours=2.5)
    data = ds.series()
    horizons = []
    for h in (300, 1800):
        s = M.build_samples(ds.sites, data, h)
        horizons.append(M.export_horizon(M.fit(s, {"n_estimators": 25, "max_depth": 3, "learning_rate": 0.1,
                                                  "subsample": 1.0, "min_samples_leaf": 5}), h))
    cases = []
    t_end = max(s.ts[-1] for s in data.values())
    for code in sorted(ds.sites):
        for t in (900.0, 1795.5, 2400.0, 4321.7, 6000.0, t_end - 30.0):
            for hz in horizons:
                f = features(ds.sites[code], t, hz["sec"], data)
                cases.append({"code": code, "t": t, "sec": hz["sec"], "features": f,
                              "delta": None if f is None else M.predict_json(hz, f)})
    model = {"format": M.FORMAT, "modelId": "gbt-parity", "features": list(FEATURES), "horizons": horizons}
    sites = {c: {"criticalCm": s.critical_cm, "sensorHeightCm": s.sensor_height_cm,
                 "upstream": [[u, tr] for u, tr in s.upstream]} for c, s in sorted(ds.sites.items())}
    return {"sites": sites, "measurements": [[c, ts, lv, rn] for c, ts, lv, rn in ds.rows], "model": model,
            "cases": cases}


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("train")
    t.add_argument("--source", choices=["sim", "db"], default="sim")
    t.add_argument("--hours", type=float, default=48.0, help="sim : durée simulée")
    t.add_argument("--seed", type=int, default=1, help="sim : graine")
    t.add_argument("--days", type=float, default=14.0, help="db : profondeur d'historique")
    t.add_argument("--check", action="store_true", help="intégration continue : code de sortie 1 si refusé")
    sub.add_parser("evaluate")
    sub.add_parser("monitor")
    sub.add_parser("loop")
    sub.add_parser("fixture")
    a = p.parse_args(argv)
    root = home()
    if a.cmd == "train":
        ds = from_sim(a.seed, a.hours) if a.source == "sim" else from_db(days=a.days)
        report = train(ds, root, Tracker())
        return 0 if report["accepted"] or not a.check else 1
    if a.cmd == "evaluate":
        print(json.dumps(evaluate(root, Tracker()), indent=2, ensure_ascii=False))
        return 0
    if a.cmd == "monitor":
        print(json.dumps(monitor(root, Tracker()), indent=2, ensure_ascii=False))
        return 0
    if a.cmd == "loop":
        loop(root)
        return 0
    # pas de contrôle à l'octet (scikit-learn peut varier d'une machine à l'autre) : ml/tests vérifie que
    # les valeurs attendues du fichier versionné découlent bien de features.py et de predict_json
    text = json.dumps(fixture(), separators=(",", ":")) + "\n"
    write_atomic(PARITY_FIXTURE, text)
    print(f"écrit : {PARITY_FIXTURE} ({len(text) // 1024} Kio)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

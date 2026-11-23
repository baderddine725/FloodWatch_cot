# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : apprentissage automatique – cloud (prévision du niveau)
#  Fichier   : ml/forecast/model.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Guesmi Baderddine
#  Créé le   : 2026-11-23          Modifié le : 2026-11-23          Version : 1.0
# =============================================================================
"""Exemples, découpage temporel, apprentissage, références, export et évaluateur sans dépendance.

Un modèle par horizon : arbres de décision renforcés par gradient (``GradientBoostingRegressor``)
qui prédisent la **variation** du niveau entre t et t + h. Le format exporté
(``floodwatch-gbt/1``) se lit sans scikit-learn : ``predict_json`` ici, ``LearnedModel.java`` dans le
middleware. scikit-learn compare des indicateurs convertis en float32 (``x <= seuil``) et somme en
float64 ``init + taux × Σ feuilles`` dans l'ordre des arbres : les deux évaluateurs font de même.
"""
from __future__ import annotations

import math
import struct
from dataclasses import dataclass

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor

from .features import FEATURES, GRID_S, HORIZONS_S, Site, features, label

FORMAT = "floodwatch-gbt/1"
#: grille d'hyperparamètres explorée en validation (petite : le modèle doit rester lisible et léger)
GRID = [{"n_estimators": n, "max_depth": d, "learning_rate": 0.05, "subsample": 0.8, "min_samples_leaf": 20}
        for n in (150, 300) for d in (2, 3, 4)]
SEED = 7


@dataclass
class Samples:
    t: np.ndarray            # instant de chaque exemple (s)
    code: list[str]
    X: np.ndarray            # indicateurs
    y: np.ndarray            # variation observée (cm)
    level: np.ndarray        # niveau g(t)
    height: np.ndarray       # plafond physique (hauteur du capteur)


def build_samples(sites: dict[str, Site], data, horizon_s: float, start: float | None = None,
                  end: float | None = None) -> Samples:
    """Un exemple toutes les 30 s (instants alignés) pour chaque station, si tout est connu."""
    t_out, codes, X, y, lv, hh = [], [], [], [], [], []
    for code in sorted(sites):
        series = data.get(code)
        if series is None or not series.ts:
            continue
        site = sites[code]
        lo = math.ceil((series.ts[0] if start is None else max(start, series.ts[0])) / GRID_S) * GRID_S
        hi = series.ts[-1] if end is None else min(end, series.ts[-1])
        t = lo
        while t + horizon_s <= hi:
            f = features(site, t, horizon_s, data)
            if f is not None:
                target = label(site, t, horizon_s, data)
                if target is not None:
                    t_out.append(t), codes.append(code), X.append(f), y.append(target)
                    lv.append(f[0]), hh.append(site.sensor_height_cm)
            t += GRID_S
    return Samples(np.array(t_out), codes, np.array(X, dtype=np.float64).reshape(-1, len(FEATURES)),
                   np.array(y), np.array(lv), np.array(hh))


def time_split(t0: float, t1: float, gap_s: float = max(HORIZONS_S)) -> dict[str, tuple[float, float]]:
    """70 / 15 / 15 % de la période, dans l'ordre du temps, séparés d'un horizon maximal : aucune
    cible d'apprentissage ne regarde dans la période de validation, ni la validation dans le test."""
    span = t1 - t0
    a, b = t0 + 0.70 * span, t0 + 0.85 * span
    return {"train": (t0, a - gap_s), "validation": (a, b - gap_s), "test": (b, t1)}


def subset(s: Samples, mask: np.ndarray) -> Samples:
    return Samples(s.t[mask], [c for c, m in zip(s.code, mask) if m], s.X[mask], s.y[mask], s.level[mask],
                   s.height[mask])


def window(s: Samples, lo: float, hi: float) -> Samples:
    return subset(s, (s.t >= lo) & (s.t <= hi))


# --------------------------------------------------------------------------------------- références
def persistence(s: Samples, horizon_s: float) -> np.ndarray:
    return np.zeros(len(s.y))


def linear(s: Samples, horizon_s: float) -> np.ndarray:
    """Tendance des 2 dernières minutes prolongée : la régression du moteur d'alerte (median+linreg-120s)."""
    return s.X[:, FEATURES.index("d2_cm")] / 120.0 * horizon_s


def clamp_levels(s: Samples, delta: np.ndarray) -> np.ndarray:
    """Niveaux prévus bornés à [0, hauteur du capteur], comme au service."""
    return np.minimum(np.maximum(s.level + delta, 0.0), s.height)


def metrics(s: Samples, delta: np.ndarray) -> dict:
    err = clamp_levels(s, delta) - (s.level + s.y)
    return {"n": int(len(err)), "maeCm": round(float(np.mean(np.abs(err))), 4) if len(err) else None,
            "biasCm": round(float(np.mean(err)), 4) if len(err) else None,
            "rmseCm": round(float(np.sqrt(np.mean(err ** 2))), 4) if len(err) else None}


# --------------------------------------------------------------------------------------- apprentissage
def fit(s: Samples, params: dict) -> GradientBoostingRegressor:
    m = GradientBoostingRegressor(loss="squared_error", random_state=SEED, **params)
    return m.fit(s.X.astype(np.float32), s.y)


def choose(train: Samples, val: Samples) -> tuple[dict, list[dict]]:
    """Hyperparamètres : plus petite erreur absolue moyenne en validation (à égalité, le plus petit)."""
    trials = []
    for params in GRID:
        mae = metrics(val, fit(train, params).predict(val.X.astype(np.float32)))["maeCm"]
        trials.append({**params, "valMaeCm": mae})
    best = min(trials, key=lambda r: (r["valMaeCm"], r["n_estimators"] * 2 ** r["max_depth"]))
    return {k: best[k] for k in GRID[0]}, trials


# --------------------------------------------------------------------------------------- export
def export_horizon(m: GradientBoostingRegressor, horizon_s: int) -> dict:
    trees = []
    for est in m.estimators_[:, 0]:
        t = est.tree_
        trees.append({"f": [int(v) if v >= 0 else -1 for v in t.feature],
                      "t": [float(v) for v in t.threshold],
                      "l": [int(v) for v in t.children_left], "r": [int(v) for v in t.children_right],
                      "v": [float(v) for v in t.value[:, 0, 0]]})
    return {"sec": int(horizon_s), "init": float(m.init_.constant_.reshape(-1)[0]),
            "learningRate": float(m.learning_rate), "trees": trees}


def _f32(x: float) -> float:
    return struct.unpack("f", struct.pack("f", x))[0]


def predict_json(horizon: dict, x: list[float]) -> float:
    """Variation prévue (cm) : même règle que scikit-learn et que LearnedModel.java."""
    xf = [_f32(v) for v in x]
    out = horizon["init"]
    lr = horizon["learningRate"]
    for tree in horizon["trees"]:
        i = 0
        while tree["f"][i] >= 0:
            i = tree["l"][i] if xf[tree["f"][i]] <= tree["t"][i] else tree["r"][i]
        out += lr * tree["v"][i]
    return out

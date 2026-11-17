# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : apprentissage automatique – edge (TinyML)
#  Fichier   : ml/sensor_anomaly/codegen.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Guesmi Baderddine
#  Créé le   : 2026-11-17          Modifié le : 2026-11-17
#  Version   : 1.0
# =============================================================================
"""Conversion exacte d'un arbre ou d'une forêt scikit-learn en C (ESP32) et en JSON (simulateur).

Pourquoi pas emlearn : son code « inline » écrit les seuils avec 6 décimales et compare avec ``<``,
alors que scikit-learn compare avec ``<=`` au seuil exact. Une lecture tombant entre les deux est
décidée différemment sur l'ESP32 et à l'entraînement ; rien ne le garantit sur les données de test.

Ici, chaque seuil est arrondi VERS LE BAS au flottant 32 bits le plus proche, et la comparaison
reste ``x <= seuil``. Pour toute entrée float32 x, ``x <= arrondi_bas(s)`` équivaut exactement à
``x <= s`` : le C, l'évaluateur Python du simulateur et scikit-learn décident pareil par construction.
"""
from __future__ import annotations

import math

import numpy as np


def floor_f32(value: float) -> float:
    """Plus grand float32 inférieur ou égal à ``value``."""
    f = np.float32(value)
    if float(f) > value:
        f = np.nextafter(f, np.float32(-np.inf))
    return float(f)


def c_float(value: float) -> str:
    """Littéral C float qui relit exactement ``value`` (déjà float32)."""
    if not math.isfinite(value):
        raise ValueError(f"seuil non fini : {value}")
    return f"{value:.9g}f" if "e" in f"{value:.9g}" or "." in f"{value:.9g}" else f"{value:.9g}.0f"


def trees_of(model) -> list:
    return list(model.estimators_) if hasattr(model, "estimators_") else [model]


def nodes_of(estimator) -> list[list]:
    """Nœuds ``[feature, seuil float32, gauche, droite, classe]`` (feature = -1 pour une feuille)."""
    t = estimator.tree_
    out = []
    for i in range(t.node_count):
        leaf = t.children_left[i] == -1
        out.append([-1 if leaf else int(t.feature[i]), 0.0 if leaf else floor_f32(float(t.threshold[i])),
                    int(t.children_left[i]), int(t.children_right[i]),
                    int(np.argmax(t.value[i][0])) if leaf else 0])
    return out


def to_json(model, features: list[str], description: str) -> dict:
    return {"name": "sensor-anomaly", "description": description, "n_features": len(features),
            "features": list(features), "comparison": "x <= threshold (float32)",
            "trees": [nodes_of(est) for est in trees_of(model)]}


def to_c(model, prefix: str = "sensor_anomaly") -> str:
    """Corps C : une fonction par arbre puis ``<prefix>_predict`` (vote majoritaire strict)."""
    parts = []
    trees = trees_of(model)
    for k, est in enumerate(trees):
        nodes = nodes_of(est)

        def emit(i: int, depth: int) -> list[str]:
            pad = "    " * depth
            feature, threshold, left, right, value = nodes[i]
            if feature < 0:
                return [f"{pad}return {value};"]
            return ([f"{pad}if (f[{feature}] <= {c_float(threshold)}) {{"] + emit(left, depth + 1)
                    + [f"{pad}}} else {{"] + emit(right, depth + 1) + [f"{pad}}}"])

        parts.append(f"static int32_t {prefix}_tree_{k}(const float *f) {{\n" + "\n".join(emit(0, 1)) + "\n}\n")
    calls = "\n".join(f"    votes += {prefix}_tree_{k}(features);" for k in range(len(trees)))
    parts.append(
        f"/** 1 = lecture probablement fausse : au moins {len(trees) // 2 + 1} arbre(s) sur {len(trees)} "
        f"(à égalité : lecture plausible). */\n"
        f"static inline int32_t {prefix}_predict(const float *features, int32_t features_length) {{\n"
        f"    (void)features_length;\n    int32_t votes = 0;\n{calls}\n"
        f"    return 2 * votes > {len(trees)} ? 1 : 0;\n}}\n")
    return "\n".join(parts)


__all__ = ["c_float", "floor_f32", "nodes_of", "to_c", "to_json", "trees_of"]

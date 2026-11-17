# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : apprentissage automatique – edge (TinyML)
#  Fichier   : ml/sensor_anomaly/features.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Guesmi Baderddine
#  Créé le   : 2026-11-17          Modifié le : 2026-11-17
#  Version   : 1.0
# =============================================================================
"""Indicateurs calculés à chaque lecture, pour le classifieur embarqué.

Contrainte de conception : ce calcul doit pouvoir être **recopié tel quel sur l'ESP32**. D'où :

* un état de taille fixe (deux tampons circulaires de ``WINDOW`` = 6 entrées), aucune allocation ;
* uniquement des sommes, une médiane de 3 valeurs, une variance et une pente par moindres carrés ;
* aucune information que la station ne possède pas : ni niveau réel, ni condition du capteur.

Le classifieur **observe sans filtrer ses propres entrées** : toute lecture retenue par le
firmware entre dans l'historique, même si le classifieur la juge fausse. Cela évite une boucle
de rétroaction (un modèle qui écarterait les lectures qui le contredisent) et garantit que les
indicateurs calculés à l'entraînement sont exactement ceux calculés en service.

Limite connue : le banc lit le capteur toutes les 5 s (surveillance renforcée, le régime des
épisodes pluvieux). En régime normal le firmware lit toutes les 30 s ; les fenêtres de 6 lectures
couvrent alors 3 min au lieu de 30 s. La pente est exprimée en cm/min pour limiter cet écart,
mais le modèle n'a pas été évalué à cette cadence.
"""
from __future__ import annotations

import math
from collections import deque

#: profondeur de l'historique (lectures)
WINDOW = 6

#: ordre des entrées du modèle : cet ordre est aussi celui du tableau passé au code C embarqué
FEATURES = (
    "echo_ok",          # échos reçus sur la salve courante (0..5)
    "spread_cm",        # écart max − min de la salve courante
    "jump_cm",          # niveau courant − médiane des 3 lectures retenues précédentes (signé)
    "std6_cm",          # écart type des 6 derniers niveaux retenus (courant inclus)
    "slope6_cm_min",    # pente des 6 derniers niveaux retenus, en cm/min
    "rain",             # pluie courante (0..1)
    "rain_mean6",       # pluie moyenne sur les 6 dernières salves
    "rejected6",        # salves rejetées par le firmware parmi les 6 dernières
    "spread_mean6",     # dispersion moyenne des 6 dernières salves
    "echo_ok_mean6",    # échos moyens des 6 dernières salves
)


class FeatureState:
    """État de l'extracteur pour UNE station : deux tampons circulaires de 6 entrées."""

    def __init__(self):
        self.bursts: deque[tuple[bool, int, float, float]] = deque(maxlen=WINDOW)  # (retenue, échos, dispersion, pluie)
        self.levels: deque[tuple[float, float]] = deque(maxlen=WINDOW)             # (t en s, niveau) retenus

    def update(self, t_s: float, sensor_ok: bool, level_cm: float | None, echo_ok: int, spread_cm: float,
               rain: float) -> list[float] | None:
        """Intègre une salve ; renvoie les indicateurs si la lecture est retenue, ``None`` sinon.

        Une salve rejetée par le firmware n'a pas de niveau à juger, mais elle compte dans
        l'historique : une série de rejets est elle-même un signe (mousse, capteur aveugle).
        """
        self.bursts.append((bool(sensor_ok), int(echo_ok), float(spread_cm), float(rain)))
        if not sensor_ok:
            return None
        previous = [level for _, level in self.levels]
        jump = level_cm - median3(previous[-3:]) if len(previous) >= 3 else 0.0
        self.levels.append((float(t_s), float(level_cm)))
        levels = [level for _, level in self.levels]
        n = len(self.bursts)
        return [
            float(echo_ok),
            float(spread_cm),
            jump,
            pstdev(levels) if len(levels) >= 2 else 0.0,
            slope_per_min(self.levels) if len(levels) >= 3 else 0.0,
            float(rain),
            sum(b[3] for b in self.bursts) / n,
            float(sum(not b[0] for b in self.bursts)),
            sum(b[2] for b in self.bursts) / n,
            sum(b[1] for b in self.bursts) / n,
        ]


def median3(values: list[float]) -> float:
    """Médiane de 3 valeurs (ou moins) : un tri par insertion suffit, comme dans le firmware."""
    s = sorted(values)
    return s[len(s) // 2]


def pstdev(values: list[float]) -> float:
    """Écart type de population, en une passe (sommes, comme sur l'ESP32)."""
    n = len(values)
    mean = sum(values) / n
    return math.sqrt(max(0.0, sum((v - mean) ** 2 for v in values) / n))


def slope_per_min(points) -> float:
    """Pente des moindres carrés du niveau en fonction du temps, en cm/min."""
    t0 = points[-1][0]
    xs = [(t - t0) / 60.0 for t, _ in points]
    ys = [level for _, level in points]
    n = len(xs)
    sx, sy = sum(xs), sum(ys)
    sxx = sum(x * x for x in xs)
    sxy = sum(x * y for x, y in zip(xs, ys))
    denominator = n * sxx - sx * sx
    return 0.0 if abs(denominator) < 1e-12 else (n * sxy - sx * sy) / denominator


def extract(rows: list[dict]) -> tuple[list[list[float]], list[dict]]:
    """Indicateurs de chaque lecture RETENUE d'une série de lectures du banc (une station).

    :return: (matrice des indicateurs, lignes correspondantes du banc)
    """
    state = FeatureState()
    X, kept = [], []
    for row in rows:
        level = float(row["level_cm"]) if row["sensor_ok"] else None
        features = state.update(float(row["t_s"]), bool(row["sensor_ok"]), level, int(row["echo_ok"]),
                                float(row["echo_spread_cm"]), float(row["rain"]))
        if features is not None:
            X.append(features)
            kept.append(row)
    return X, kept


__all__ = ["FEATURES", "WINDOW", "FeatureState", "extract", "median3", "pstdev", "slope_per_min"]

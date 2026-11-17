# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – edge (TinyML), jumeau Python du firmware
#  Fichier   : backend/simulator/fwsim/anomaly.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Guesmi Baderddine
#  Créé le   : 2026-11-17          Modifié le : 2026-11-17
#  Version   : 1.0
# =============================================================================
"""Classifieur embarqué de validité du capteur, évalué en Python pur (sans scikit-learn).

Le modèle est exporté par ``ml/sensor_anomaly/train.py`` en deux formes identiques : un en-tête C
pour l'ESP32 et ``sensor_anomaly_model.json`` (ce dossier) pour les stations virtuelles. Les
entrées sont arrondies en float32 comme sur l'ESP32, les seuils sont déjà des float32 arrondis vers
le bas et la comparaison est ``<=`` des deux côtés ; une forêt vote à la majorité stricte (égalité :
lecture plausible), comme le code C généré.
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

DEFAULT_MODEL = Path(__file__).resolve().parent / "sensor_anomaly_model.json"


def f32(x: float) -> float:
    """Arrondi en simple précision, comme la conversion ``(float)`` du firmware."""
    return struct.unpack("f", struct.pack("f", x))[0]


class AnomalyModel:
    """Arbres de décision au format JSON : nœuds ``[feature, threshold, left, right, value]``."""

    def __init__(self, data: dict):
        self.trees = data["trees"]
        self.n_features = data["n_features"]
        self.name = data.get("name", "sensor-anomaly")

    @classmethod
    def load(cls, path: Path | str | None = None) -> "AnomalyModel | None":
        """Charge le modèle exporté ; ``None`` s'il est absent (station sans classifieur)."""
        p = Path(path) if path else DEFAULT_MODEL
        return cls(json.loads(p.read_text(encoding="utf-8"))) if p.is_file() else None

    @staticmethod
    def _tree(nodes: list, x: list[float]) -> int:
        i = 0
        while True:
            feature, threshold, left, right, value = nodes[i]
            if feature < 0:
                return value
            i = left if x[feature] <= threshold else right   # même comparaison que le code C

    def suspect(self, features: list[float]) -> bool:
        """Vrai si la lecture est probablement fausse."""
        x = [f32(v) for v in features]
        votes = sum(self._tree(t, x) for t in self.trees)
        return votes > len(self.trees) / 2


__all__ = ["AnomalyModel", "DEFAULT_MODEL", "f32"]

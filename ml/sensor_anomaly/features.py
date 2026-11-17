# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : apprentissage automatique – edge (TinyML)
#  Fichier   : ml/sensor_anomaly/features.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Guesmi Baderddine
#  Créé le   : 2026-11-17          Modifié le : 2026-11-17
#  Version   : 1.1
# =============================================================================
"""Indicateurs du classifieur : réexporte l'implémentation de référence du simulateur.

Une seule implémentation Python (``backend/simulator/fwsim/features.py``), utilisée à la fois pour
entraîner le modèle et par les stations virtuelles : l'entraînement et le service ne peuvent pas
diverger. Son jumeau C++ est ``firmware/lib/floodwatch_core``.
"""
import sys
from pathlib import Path

_SIM = Path(__file__).resolve().parents[2] / "backend" / "simulator"
if str(_SIM) not in sys.path:
    sys.path.insert(0, str(_SIM))

from fwsim.features import FEATURES, WINDOW, FeatureState, extract, median3, pstdev, slope_per_min  # noqa: E402,F401

__all__ = ["FEATURES", "WINDOW", "FeatureState", "extract", "median3", "pstdev", "slope_per_min"]

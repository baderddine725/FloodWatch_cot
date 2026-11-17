# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : apprentissage automatique – tests
#  Fichier   : ml/tests/test_features.py
#  Équipe    : FloodWatch – Auteur : Guesmi Baderddine
#  Créé le   : 2026-11-17          Modifié le : 2026-11-17          Version : 1.0
# =============================================================================
"""Indicateurs du classifieur embarqué : valeurs de référence (que le portage C sur l'ESP32 devra
reproduire), traitement des salves rejetées, absence de toute vérité terrain dans les entrées."""
import math
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO / "ml"), str(REPO / "backend" / "simulator"), str(REPO / "backend" / "simulator" / "tools")]

import sensor_bench  # noqa: E402
from sensor_anomaly.features import FEATURES, WINDOW, FeatureState, extract, median3, pstdev, slope_per_min  # noqa: E402

F = {name: i for i, name in enumerate(FEATURES)}


def feed(state, t, level, ok=True, echo_ok=5, spread=0.3, rain=0.0):
    return state.update(t, ok, level, echo_ok, spread, rain)


def test_primitives():
    assert median3([3.0, 1.0, 2.0]) == 2.0
    assert median3([4.0, 1.0]) == 4.0           # moins de 3 valeurs : élément central après tri
    assert pstdev([2.0, 2.0, 2.0]) == 0.0
    assert pstdev([1.0, 3.0]) == pytest.approx(1.0)
    # niveau qui monte de 1 cm toutes les 30 s : 2 cm/min
    assert slope_per_min([(0, 10.0), (30, 11.0), (60, 12.0)]) == pytest.approx(2.0)
    assert slope_per_min([(5, 1.0), (5, 2.0)]) == 0.0       # instants confondus : pente nulle


def test_reference_vector():
    """Valeurs de référence : le portage C devra produire exactement ce vecteur."""
    s = FeatureState()
    for t, level in ((0, 10.0), (5, 10.2), (10, 10.1)):
        feed(s, t, level, rain=0.4)
    feed(s, 15, None, ok=False, echo_ok=2, spread=4.0, rain=0.5)   # salve rejetée
    x = feed(s, 20, 14.1, echo_ok=4, spread=2.5, rain=0.6)         # saut de 4 cm
    assert len(x) == len(FEATURES)
    assert x[F["echo_ok"]] == 4 and x[F["spread_cm"]] == 2.5
    assert x[F["jump_cm"]] == pytest.approx(14.1 - 10.1)           # médiane de 10.0, 10.2, 10.1
    assert x[F["std6_cm"]] == pytest.approx(pstdev([10.0, 10.2, 10.1, 14.1]))
    assert x[F["slope6_cm_min"]] == pytest.approx(slope_per_min([(0, 10.0), (5, 10.2), (10, 10.1), (20, 14.1)]))
    assert x[F["rain"]] == 0.6
    assert x[F["rain_mean6"]] == pytest.approx((0.4 * 3 + 0.5 + 0.6) / 5)
    assert x[F["rejected6"]] == 1
    assert x[F["spread_mean6"]] == pytest.approx((0.3 * 3 + 4.0 + 2.5) / 5)
    assert x[F["echo_ok_mean6"]] == pytest.approx((5 * 3 + 2 + 4) / 5)


def test_rejected_burst_yields_no_features_but_is_remembered():
    s = FeatureState()
    assert feed(s, 0, None, ok=False, echo_ok=0, spread=0.0) is None
    x = feed(s, 5, 10.0)
    assert x[F["rejected6"]] == 1 and x[F["jump_cm"]] == 0.0 and x[F["std6_cm"]] == 0.0


def test_window_is_bounded():
    s = FeatureState()
    for i in range(20):
        x = feed(s, 5 * i, 10.0 + i, ok=(i % 2 == 0))      # une salve sur deux rejetée
    assert len(s.bursts) == WINDOW and len(s.levels) == WINDOW
    assert x is None or x[F["rejected6"]] <= WINDOW


def test_stuck_sensor_signature_is_temporal():
    """Un capteur figé sous la pluie : salve normale, mais niveau plat alors qu'il pleut."""
    s = FeatureState()
    for i in range(6):
        x = feed(s, 5 * i, 8.0 + 0.01 * (i % 2), rain=0.9)
    assert x[F["echo_ok"]] == 5 and x[F["spread_cm"]] < 1.0       # invisible sur une seule salve
    assert x[F["std6_cm"]] < 0.05 and abs(x[F["slope6_cm_min"]]) < 0.2 and x[F["rain_mean6"]] == pytest.approx(0.9)


def test_extract_uses_only_what_the_station_knows():
    rows = sensor_bench.generate(seed=9, hours=0.5)
    X, kept = extract(rows)
    assert len(X) == len(kept) == sum(r["sensor_ok"] for r in rows)
    assert all(len(x) == len(FEATURES) and all(math.isfinite(v) for v in x) for x in X)
    # aucune entrée ne dépend de la vérité terrain : changer le niveau réel et la condition ne change rien
    tampered = [{**r, "true_level_cm": -999.0, "condition": "NORMAL", "quality": "GOOD", "error_cm": 0.0} for r in rows]
    assert extract(tampered)[0] == X

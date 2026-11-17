# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : apprentissage automatique – tests
#  Fichier   : ml/tests/test_train.py
#  Équipe    : FloodWatch – Auteur : Guesmi Baderddine
#  Créé le   : 2026-11-17          Modifié le : 2026-11-17          Version : 1.0
# =============================================================================
"""Règle de décision commune à Python et au C embarqué, mesures et critères d'acceptation."""
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ml" / "sensor_anomaly"))
import train  # noqa: E402


class FixedVote:
    """Faux arbre qui vote toujours la même chose."""

    def __init__(self, vote):
        self.vote = vote

    def predict(self, X):
        return np.full(len(X), float(self.vote))


def forest(ones: int, total: int = 10):
    return SimpleNamespace(estimators_=[FixedVote(1)] * ones + [FixedVote(0)] * (total - ones))


def test_forest_decides_by_strict_majority_like_emlearn():
    """emlearn compte les votes et retient la classe 0 à égalité : Python doit faire pareil."""
    X = np.zeros((3, len(train.FEATURES)), dtype=np.float32)
    assert train.decide(forest(6), X).tolist() == [1, 1, 1]
    assert train.decide(forest(5), X).tolist() == [0, 0, 0]       # égalité 5-5 : lecture plausible
    assert train.decide(forest(0), X).tolist() == [0, 0, 0]


def test_score_counts_only_accepted_good_and_bad():
    rows = [{"quality": q, "condition": c} for q, c in
            (("BAD", "STUCK"), ("BAD", "GLITCH"), ("GOOD", "NORMAL"), ("GOOD", "NORMAL"), ("DEGRADED", "SPLASH"))]
    s = train.score(np.array([True, False, True, False, True]), rows)
    assert s["bad_recall"] == 0.5 and s["false_alarm"] == 0.5 and s["flagged_degraded"] == 1.0
    assert s["by_condition"] == {"GLITCH": {"bad": 1, "caught": 0.0}, "STUCK": {"bad": 1, "caught": 1.0}}


def _report(model_nominal, model_shifted, **selected):
    sel = {"depth": 4, "nodes": 31, "meets_false_alarm_limit": True, "text_bytes_x86_Os": 300, "c_agreement": 1.0,
           **selected}
    rule = {"bad_recall": 0.6, "false_alarm": 0.1}
    return {"protocol": {"exported_experiment": "randomized"}, "experiments": {"randomized": {
        "chosen_family": "tree", "selected": {"tree": sel},
        "test_nominal": {"rule": rule, "tree": model_nominal},
        "test_shifted": {"rule": {"bad_recall": 0.4, "false_alarm": 0.3}, "tree": model_shifted}}}}


def test_gate_requires_beating_the_rule_on_both_sensors():
    good = {"bad_recall": 0.9, "false_alarm": 0.05}
    assert train.gate(_report(good, {"bad_recall": 0.8, "false_alarm": 0.3})) == []
    # excellent sur le capteur nominal, mais inondé de fausses alertes sur un capteur différent
    problems = train.gate(_report(good, {"bad_recall": 0.9, "false_alarm": 0.7}))
    assert len(problems) == 1 and "capteur décalé" in problems[0]
    assert any("Python" in p for p in train.gate(_report(good, good, c_agreement=0.9926)))
    assert any("code compilé" in p for p in train.gate(_report(good, good, text_bytes_x86_Os=20_000)))

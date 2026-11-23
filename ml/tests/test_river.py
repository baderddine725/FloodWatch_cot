# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : apprentissage automatique – tests
#  Fichier   : ml/tests/test_river.py
#  Équipe    : FloodWatch – Auteur : Guesmi Baderddine
#  Créé le   : 2026-11-23          Modifié le : 2026-11-23          Version : 1.0
# =============================================================================
"""Prévision sur données réelles : lecture des fichiers de l'agence, grille, cumuls de pluie,
mesure des débordements annoncés, évaluateur vectorisé. Aucun accès réseau."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from forecast import model as M  # noqa: E402
from river import pipeline as P  # noqa: E402
from river.sources import parse  # noqa: E402

CSV = '''"measure","dateTime","date","value","completeness","quality","qcode"
"m","2015-12-26T12:45:00","2015-12-26","3.401","","Good",""
"m","2015-12-26T12:30:00","2015-12-26","3.300","","Good","Edited"
"m","2015-12-26T13:00:00","2015-12-26","3.628","","Suspect",""
"m","2015-12-26T13:15:00","2015-12-26","","","Good",""
"m","2015-12-26T13:30:00","2015-12-26","3.5","","Estimated",""
'''


def test_agency_csv_keeps_usable_readings_in_utc_order():
    rows = parse(CSV)
    assert [v for _, v in rows] == [3.3, 3.401, 3.5]               # « Suspect » et valeur vide écartés
    assert rows[0][0] == 1451133000 and rows[1][0] - rows[0][0] == 900


def test_grid_places_readings_on_their_step_and_leaves_gaps_unknown():
    a = P.to_grid([(0, 1.0), (900, 2.0), (2700, 4.0), (1000, 9.0)], 0, 4)   # 1000 s : hors grille
    assert a[0] == 1.0 and a[1] == 2.0 and np.isnan(a[2]) and a[3] == 4.0


def test_rolling_sum_is_unknown_when_a_step_is_missing():
    a = np.array([1.0, 2.0, 3.0, np.nan, 5.0, 6.0, 7.0])
    s = P.rolling_sum(a, 3)
    assert np.isnan(s[:2]).all() and s[2] == 6.0
    assert np.isnan(s[3:6]).all() and s[6] == 18.0


def test_catchment_rain_needs_two_gauges():
    r = P.catchment_rain([np.array([1.0, np.nan, np.nan]), np.array([3.0, 2.0, np.nan]), np.array([np.nan, 4.0, 1.0])])
    assert r[0] == 2.0 and r[1] == 3.0 and np.isnan(r[2])


def test_lead_and_lag_shift_without_wrapping():
    a = np.arange(5.0)
    assert np.isnan(P.lag(a, 2)[:2]).all() and P.lag(a, 2)[2] == 0.0
    assert P.lead(a, 2)[0] == 2.0 and np.isnan(P.lead(a, 2)[3:]).all()


def test_flood_crossings_are_counted_only_from_below_the_threshold():
    d = {"level": np.array([1.0, 1.0, 1.0, 1.0, 2.0]), "y": np.array([0.7, 0.7, 0.1, 0.1, 0.5]),
         "typical": np.full(5, 1.6)}
    e = P.events(d, np.array([0.8, 0.0, 0.9, 0.0, 0.0]))          # réussite, manqué, fausse alerte, rien ; 5e déjà au-dessus
    assert (e["crossings"], e["hits"], e["misses"], e["falseAlarms"]) == (2, 1, 1, 1)
    assert e["pod"] == 0.5 and e["far"] == 0.5 and e["csi"] == round(1 / 3, 3)


def test_high_water_errors_select_the_rows_near_or_above_the_threshold():
    d = {"level": np.array([0.2, 1.4]), "y": np.array([0.0, 0.3]), "typical": np.full(2, 1.6)}
    e = P.errors(d, np.array([0.1, 0.0]))
    assert e["n"] == 2 and e["highWater"]["n"] == 1 and e["highWater"]["maeCm"] == 30.0


def test_vectorized_evaluator_matches_scikit_learn_and_the_reference_evaluator():
    rng = np.random.default_rng(1)
    X = rng.normal(size=(800, len(P.FEATURES))) * 3.1
    y = np.tanh(X[:, 0]) + 0.2 * X[:, 5] + rng.normal(size=800) * 0.05
    m = M.GradientBoostingRegressor(n_estimators=30, max_depth=4, random_state=0).fit(X.astype(np.float32), y)
    exp = M.export_horizon(m, 3600)
    fast = P.predict_np(exp, X)
    assert np.max(np.abs(fast - m.predict(X.astype(np.float32)))) <= 1e-12
    assert all(fast[i] == M.predict_json(exp, list(X[i])) for i in range(0, 800, 97))

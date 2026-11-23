# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : apprentissage automatique – tests
#  Fichier   : ml/tests/test_forecast.py
#  Équipe    : FloodWatch – Auteur : Guesmi Baderddine
#  Créé le   : 2026-11-23          Modifié le : 2026-11-23          Version : 1.0
# =============================================================================
"""Prévision du niveau : indicateurs, évaluateur exporté, versionnage des données, règles de promotion."""
import json
import random
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from forecast import model as M  # noqa: E402
from forecast.data import Dataset, parse_links  # noqa: E402
from forecast.features import FEATURES, Series, Site, features, label  # noqa: E402
from forecast.pipeline import PARITY_FIXTURE, compare, psi  # noqa: E402
from forecast.registry import Registry  # noqa: E402


def series(points):
    s = Series()
    for ts, level, rain in points:
        s.ts.append(float(ts)), s.level.append(float(level)), s.rain.append(float(rain))
    return s


def steady(level=5.0, rain=0.0, until=3600, every=10):
    return series([(t, level, rain) for t in range(0, until + 1, every)])


# --------------------------------------------------------------------------------------- indicateurs
def test_level_is_the_median_of_the_last_minute_so_a_single_echo_spike_is_ignored():
    s = series([(0, 5, 0), (10, 5, 0), (20, 29, 0), (30, 5, 0), (40, 5, 0)])
    assert s.level_at(40) == 5.0
    assert series([(10, 4, 0), (20, 6, 0)]).level_at(30) == 5.0          # nombre pair : moyenne des deux


def test_stale_reading_is_kept_three_minutes_then_unknown():
    s = series([(0, 7, 0.4)])
    assert s.level_at(170) == 7.0 and s.rain_at(170) == 0.4
    assert s.level_at(181) is None and s.rain_at(181) is None


def test_features_need_thirty_minutes_of_history():
    site = Site("a", 20.0, 30.0)
    data = {"a": steady(until=3600)}
    assert features(site, 1700, 300, data) is None
    f = features(site, 1800, 300, data)
    assert f is not None and len(f) == len(FEATURES)
    assert f[FEATURES.index("level_pct")] == 25.0 and f[FEATURES.index("has_upstream")] == 0.0


def test_upstream_input_uses_only_water_already_measured():
    """Parcours 480 s : à 5 min, l'eau qui arrive est passée en amont 3 min AVANT t (déjà mesurée) ;
    à 10 min, elle passera après t : on garde le dernier niveau connu, jamais le futur."""
    up = series([(t, 1.0 if t < 3000 else 10.0, 0) for t in range(0, 4001, 10)])
    data = {"a": steady(until=4000), "up": up}
    site = Site("a", 20.0, 30.0, (("up", 480.0),))
    i = FEATURES.index("up_at_h_cm")
    assert features(site, 3100, 300, data)[i] == 1.0           # 3100 + 300 − 480 = 2920 : avant la montée
    assert features(site, 3100, 600, data)[i] == 10.0          # min(t, 3220) = 3100 : niveau actuel
    data["up"] = up = series([(t, 1.0 if t < 3000 else 10.0, 0) for t in range(0, 3101, 10)])
    assert features(site, 3100, 600, data)[i] == 10.0          # rien après t n'est lu


def test_label_is_the_level_change_over_the_horizon():
    s = series([(t, 2.0 + t / 600.0, 0) for t in range(0, 4000, 10)])
    assert label(Site("a", 20, 30), 1800, 600, {"a": s}) == pytest.approx(1.0)


def test_links_text_is_parsed_like_the_middleware():
    assert parse_links("up:480, wadi:300.5,bad,x:y,") == (("up", 480.0), ("wadi", 300.5))


# --------------------------------------------------------------------------------------- évaluateur
def test_exported_trees_predict_exactly_like_scikit_learn():
    rng = np.random.default_rng(3)
    X = rng.normal(size=(600, len(FEATURES))) * 7.3
    y = X[:, 0] * 0.3 - np.sin(X[:, 3]) + rng.normal(size=600) * 0.1
    s = M.Samples(np.arange(600.0), ["a"] * 600, X, y, X[:, 0], np.full(600, 30.0))
    m = M.fit(s, {"n_estimators": 40, "max_depth": 3, "learning_rate": 0.1, "subsample": 0.8, "min_samples_leaf": 5})
    exp = M.export_horizon(m, 300)
    sk = m.predict(X.astype(np.float32))
    js = np.array([M.predict_json(exp, list(x)) for x in X])
    assert np.max(np.abs(sk - js)) <= 1e-12


def test_committed_parity_data_follows_from_the_python_specification():
    """Les valeurs attendues par le test Java découlent bien de features.py et de predict_json."""
    fx = json.loads(PARITY_FIXTURE.read_text(encoding="utf-8"))
    sites = {c: Site(c, v["criticalCm"], v["sensorHeightCm"], tuple((u, float(t)) for u, t in v["upstream"]))
             for c, v in fx["sites"].items()}
    data: dict[str, Series] = {}
    for code, ts, level, rain in fx["measurements"]:
        s = data.setdefault(code, Series())
        s.ts.append(ts), s.level.append(level), s.rain.append(rain)
    horizons = {h["sec"]: h for h in fx["model"]["horizons"]}
    usable = 0
    for case in fx["cases"]:
        f = features(sites[case["code"]], case["t"], case["sec"], data)
        assert f == case["features"]
        if f is not None:
            usable += 1
            assert M.predict_json(horizons[case["sec"]], f) == case["delta"]
    assert usable >= len(fx["cases"]) // 2 and any(c["features"] is None for c in fx["cases"])


# --------------------------------------------------------------------------------------- découpage
def test_time_split_leaves_a_full_horizon_between_periods():
    sp = M.time_split(0.0, 100_000.0)
    assert sp["train"][1] + 1800 <= sp["validation"][0] and sp["validation"][1] + 1800 <= sp["test"][0]


def test_dataset_snapshot_is_content_addressed_and_immutable(tmp_path):
    sites = {"a": Site("a", 20.0, 30.0, (("b", 300.0),)), "b": Site("b", 25.0, 35.0)}
    rows = [("a", 1.5, 3.25, 0.1), ("b", 2.0, 4.0, 0.0), ("a", 0.5, 3.0, 0.0)]
    d1 = Dataset(sites, rows, "sim")
    folder = d1.save(tmp_path)
    d2 = Dataset(sites, list(reversed(rows)), "sim")
    d2.save(tmp_path)
    assert d1.id == d2.id == folder.name
    back = Dataset.load(folder)
    assert back.rows == d1.rows and back.sites == sites
    assert Dataset(sites, rows[:2], "sim").save(tmp_path).name != d1.id


# --------------------------------------------------------------------------------------- promotion
def rows(cand, inc, pairs=150):
    return [(h, pairs, c, i) for h, c, i in zip((60, 180, 300, 600), cand, inc)]


def test_promotion_waits_for_enough_paired_forecasts_on_every_horizon():
    assert compare(rows([1, 1, 1, 1], [2, 2, 2, 2], pairs=99))["decision"] == "wait"
    assert compare(rows([1, 1, 1], [2, 2, 2]))["decision"] == "wait"           # un horizon manque


def test_promotion_needs_a_lower_total_error_without_regressing_any_horizon():
    assert compare(rows([0.5, 1.5, 2.5, 3.5], [0.6, 1.6, 2.6, 3.6]))["decision"] == "better"
    assert compare(rows([0.62, 1.0, 2.0, 3.0], [0.6, 1.6, 2.6, 3.6]))["decision"] == "better"   # +3 % toléré
    assert compare(rows([0.7, 1.0, 2.0, 3.0], [0.6, 1.6, 2.6, 3.6]))["decision"] == "worse"    # +17 % à 1 min
    assert compare(rows([1, 2, 3, 4], [1, 2, 3, 4]))["decision"] == "worse"                     # égalité : on garde


def test_registry_moves_challenger_to_champion_and_keeps_an_event_trail(tmp_path):
    reg = Registry(tmp_path)
    reg.add_challenger({"modelId": "gbt-1", "dataset": {"id": "abc"}}, None)
    assert reg.state()["challenger"] == "gbt-1" and reg.model("gbt-1")["modelId"] == "gbt-1"
    reg.promote({"against": "median+linreg-120s"})
    st = reg.state()
    assert st["champion"] == "gbt-1" and st["challenger"] is None
    reg.demote({"reference": "median+linreg-120s"})
    assert reg.state()["champion"] is None
    assert [e["event"] for e in reg.state()["events"]] == ["challenger", "promoted", "demoted"]


# --------------------------------------------------------------------------------------- surveillance
def test_psi_is_near_zero_for_the_same_distribution_and_large_after_a_shift():
    rng = random.Random(5)
    ref = np.array([rng.gauss(0, 1) for _ in range(4000)])
    same = np.array([rng.gauss(0, 1) for _ in range(4000)])
    shifted = same + 1.5
    assert psi(ref, same) < 0.05 and psi(ref, shifted) > 0.25
    assert psi(np.zeros(500), np.zeros(500)) is None                               # indicateur constant

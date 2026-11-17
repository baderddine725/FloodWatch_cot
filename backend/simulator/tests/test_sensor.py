# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – tests
#  Fichier   : backend/simulator/tests/test_sensor.py
#  Équipe    : FloodWatch – Auteur : Guesmi Baderddine
#  Créé le   : 2026-11-17          Modifié le : 2026-11-17          Version : 1.0
# =============================================================================
"""Banc de mesure simulé : résumé d'une salve (identique au firmware), conditions du capteur,
calendrier des défauts, effet d'un capteur défaillant sur la règle de sécurité locale, jeu de
lectures étiquetées."""
import math
import random
import statistics
import sys
from dataclasses import replace
from pathlib import Path

import pytest

from fwsim.config import BUILTIN_STATIONS, SimConfig
from fwsim.scenarios import scenario_for
from fwsim.sensor import Condition, FaultEpisode, FaultPlan, SensorPhysics, UltrasonicSensor, summarize
from fwsim.station import VirtualStation

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import sensor_bench  # noqa: E402

HEIGHT = 30.0
#: capteur sans écho parasite isolé, pour isoler l'effet de chaque condition
QUIET = replace(SensorPhysics(), glitch_prob=0.0)


def readings(condition, n=400, level=10.0, seed=7, physics=QUIET, t_step=5.0):
    sensor = UltrasonicSensor(random.Random(seed), physics)
    episode = None if condition is Condition.NORMAL else FaultEpisode(condition, 0.0)
    return [sensor.read(level, HEIGHT, i * t_step, episode) for i in range(n)]


# ----------------------------------------------------------------------------- résumé d'une salve
def test_summary_matches_the_firmware():
    r = summarize([20.2, 19.9, 20.0, 20.1, 20.0], HEIGHT)
    assert r.sensor_ok and r.echo_ok == 5
    assert r.distance_cm == 20.0                     # médiane : v[ok / 2] après tri
    assert r.level_cm == pytest.approx(10.0)         # hauteur du capteur − distance
    assert r.echo_spread_cm == pytest.approx(0.3)    # max − min
    even = summarize([20.0, 21.0, 22.0, 23.0], HEIGHT)
    assert even.distance_cm == 22.0                  # 4 échos : indice 2, comme le firmware


def test_fewer_than_three_echoes_is_rejected_but_still_diagnosed():
    two = summarize([20.0, 24.0], HEIGHT)
    assert not two.sensor_ok and two.level_cm is None and two.distance_cm is None
    assert two.echo_ok == 2 and two.echo_spread_cm == pytest.approx(4.0)   # le diagnostic reste publié
    none = summarize([], HEIGHT)
    assert not none.sensor_ok and none.echo_ok == 0 and none.echo_spread_cm == 0.0


def test_out_of_range_distance_is_rejected():
    assert summarize([35.0, 35.0, 35.0], HEIGHT).sensor_ok           # hauteur + 5 cm : limite incluse
    assert not summarize([35.1, 35.1, 35.1], HEIGHT).sensor_ok


# ----------------------------------------------------------------------------- conditions
def test_healthy_sensor_reads_the_true_level():
    rs = readings(Condition.NORMAL)
    assert all(r.sensor_ok and abs(r.level_cm - 10.0) < 1.0 for r in rs)
    assert statistics.mean(r.echo_spread_cm for r in rs) < 1.0


def test_stuck_sensor_looks_healthy_and_never_moves():
    sensor = UltrasonicSensor(random.Random(3), QUIET)
    episode = FaultEpisode(Condition.STUCK, 0.0)
    first = sensor.read(5.0, HEIGHT, 0.0, episode)
    later = [sensor.read(19.0, HEIGHT, 60.0 + i, episode) for i in range(50)]   # l'eau a monté de 14 cm
    assert all(abs(r.level_cm - first.level_cm) < 1.0 for r in later)          # la mesure ne suit pas
    # ... et la salve ressemble à celle d'un capteur sain : rien à voir sur une seule lecture
    assert statistics.mean(r.echo_ok for r in later) > 4.8
    assert statistics.mean(r.echo_spread_cm for r in later) < 1.0
    assert statistics.mean(r.echo_spread_cm for r in later) > 0.05   # bruit présent : salve non figée


def test_echoes_have_the_firmware_resolution():
    """Durées en microsecondes entières : chaque écho est un multiple de 0,0343 / 2 cm."""
    from fwsim.sensor import ECHO_STEP_CM
    for r in readings(Condition.NORMAL, n=50):
        for e in r.echoes:
            assert abs(e / ECHO_STEP_CM - round(e / ECHO_STEP_CM)) < 1e-6


def test_obstruction_reads_a_falsely_high_level():
    rs = [r for r in readings(Condition.OBSTRUCTED) if r.sensor_ok]
    assert statistics.mean(r.level_cm for r in rs) > 10.0 + 2.0


def test_foam_loses_echoes_and_overestimates():
    foam, normal = readings(Condition.FOAM), readings(Condition.NORMAL)
    assert statistics.mean(r.echo_ok for r in foam) < statistics.mean(r.echo_ok for r in normal) - 1
    accepted = [r.level_cm for r in foam if r.sensor_ok]
    assert statistics.mean(accepted) > 10.5


def test_splash_disperses_the_burst():
    splash, normal = readings(Condition.SPLASH), readings(Condition.NORMAL)
    assert statistics.mean(r.echo_spread_cm for r in splash) > 3 * statistics.mean(r.echo_spread_cm for r in normal)


def test_dropout_rejects_most_readings():
    rs = readings(Condition.DROPOUT)
    assert sum(not r.sensor_ok for r in rs) > 0.9 * len(rs)


def test_drift_grows_with_time():
    rs = readings(Condition.DRIFT, n=600, t_step=5.0)     # 50 minutes
    early = statistics.mean(abs(r.level_cm - 10.0) for r in rs[:60])
    late = statistics.mean(abs(r.level_cm - 10.0) for r in rs[-60:])
    assert late > early + 1.0


def test_isolated_glitches_happen_on_a_healthy_sensor():
    rs = readings(Condition.NORMAL, n=2000, physics=SensorPhysics())
    glitches = [r for r in rs if r.condition is Condition.GLITCH]
    assert 0.01 * len(rs) < len(glitches) < 0.06 * len(rs)        # ~3 % des lectures
    assert statistics.mean(r.level_cm - 10.0 for r in glitches if r.sensor_ok) > 2.0


# ----------------------------------------------------------------------------- calendrier des défauts
def test_fault_plan_single_and_none():
    plan = FaultPlan.single(Condition.FOAM, 100, 200)
    assert plan.at(99) is None and plan.at(100).condition is Condition.FOAM and plan.at(200) is None
    assert FaultPlan.none().at(12345) is None


def test_random_fault_plan_is_reproducible_and_never_overlaps():
    def episodes(seed):
        plan = FaultPlan.random(random.Random(seed))
        seen = []
        for t in range(0, 6 * 3600, 5):
            e = plan.at(t)
            if e is not None and (not seen or seen[-1] is not e):
                seen.append(e)
        return [(e.condition, round(e.start_s, 3), round(e.end_s, 3)) for e in seen]

    a = episodes(11)
    assert a == episodes(11) and a != episodes(12)
    assert len(a) > 5
    assert all(c in FaultPlan.FAULTS for c, _, _ in a)
    assert all(a[i][2] <= a[i + 1][1] for i in range(len(a) - 1))     # un épisode à la fois


# ----------------------------------------------------------------------------- effet sur la station
def test_stuck_sensor_blinds_the_local_safety_rule(cfg, fake_mqtt):
    """Le danger qu'un détecteur de défaut doit couvrir : capteur figé, la station ne ferme pas."""
    st = VirtualStation(BUILTIN_STATIONS["underpass-01"], cfg, seed=1, mqtt_service=fake_mqtt,
                        fault_plan=FaultPlan.single(Condition.STUCK), physics=QUIET)
    st.level = 5.0
    st.read_sensor()
    st.level = 19.0                                   # 95 % du niveau critique : au-dessus du rouge
    st.read_sensor()
    assert st.true_pct() >= 85 and st.pct() < 40      # la station croit toujours voir 5 cm
    assert not st.local_safety_rule(now=0) and st.barrier == "OPEN"


def test_healthy_sensor_closes_the_barrier(cfg, fake_mqtt):
    st = VirtualStation(BUILTIN_STATIONS["underpass-01"], cfg, seed=1, mqtt_service=fake_mqtt, physics=QUIET)
    st.level = 19.0
    st.read_sensor()
    assert st.local_safety_rule(now=0) and st.barrier == "CLOSED"


def test_blind_sensor_warns_then_closes_under_rain(cfg, fake_mqtt):
    """Politique de capteur dégradé (firmware 1.3) : avertissement, puis fermeture de précaution."""
    st = VirtualStation(BUILTIN_STATIONS["underpass-01"], cfg, seed=1, mqtt_service=fake_mqtt, physics=QUIET)
    st.scenario, st.sim_t = scenario_for("fault"), 120
    st.level, st.rain = 19.0, 0.3                       # pluie du scénario « fault » : au-dessus du seuil
    reading = st.read_sensor()
    assert not reading.sensor_ok and reading.condition is Condition.DROPOUT
    assert st.local_safety_rule(now=0) and st.light == "ORANGE" and st.barrier == "OPEN"
    assert not st.local_safety_rule(now=119) and st.barrier == "OPEN"
    assert st.local_safety_rule(now=120) and st.barrier == "CLOSED" and not st.siren
    assert st.safety.mode == "DEGRADED" and st.local_safety


def test_faults_option_is_validated():
    info = BUILTIN_STATIONS["underpass-01"]
    assert SimConfig(stations=(info,)).faults == "none"
    assert SimConfig(stations=(info,), faults="random").problems() == []
    assert any("faults" in p for p in SimConfig(stations=(info,), faults="bogus").problems())


# ----------------------------------------------------------------------------- jeu de lectures étiquetées
def test_bench_is_reproducible_and_labelled():
    rows = sensor_bench.generate(seed=4, hours=1.0)
    assert rows == sensor_bench.generate(seed=4, hours=1.0)          # même graine, mêmes lectures
    assert rows != sensor_bench.generate(seed=5, hours=1.0)
    assert len(rows) == 720                                          # une lecture toutes les 5 s
    assert set(rows[0]) == set(sensor_bench.COLUMNS)
    assert {r["quality"] for r in rows} <= {"GOOD", "DEGRADED", "BAD", "REJECTED"}
    assert all((r["level_cm"] == "") == (r["sensor_ok"] == 0) for r in rows)
    assert all(r["quality"] != "GOOD" or abs(r["error_cm"]) <= sensor_bench.BAD_ERROR_CM for r in rows)


def test_bench_summary_and_csv(tmp_path):
    rows = sensor_bench.generate(seed=4, hours=3.0)
    summary = sensor_bench.summarize_rows(rows)
    assert summary["readings"] == len(rows) == sum(summary["quality"].values())
    assert sum(c["readings"] for c in summary["by_condition"].values()) == len(rows)
    rule = summary["rule"]
    assert 0.0 <= rule["bad_recall"] <= 1.0 and 0.0 <= rule["false_alarm"] <= 1.0
    out = tmp_path / "bench.csv"
    sensor_bench.write_csv(rows, out)
    lines = out.read_text(encoding="utf-8").splitlines()
    assert lines[0].split(",") == list(sensor_bench.COLUMNS) and len(lines) == len(rows) + 1
    assert math.isclose(float(lines[1].split(",")[0]), 5.0)          # première lecture à t = 5 s


def test_randomized_sensors_vary_and_exclude_the_shifted_profile():
    """La randomisation de domaine ne doit jamais couvrir le profil décalé : il reste un test d'extrapolation."""
    shifted = SensorPhysics.shifted()
    draws = [SensorPhysics.randomized(random.Random(s)) for s in range(200)]
    assert len({d.noise_cm for d in draws}) == 200                          # capteurs différents
    assert SensorPhysics.randomized(random.Random(3)) == SensorPhysics.randomized(random.Random(3))
    for name in ("noise_cm", "miss_prob", "glitch_prob", "splash_prob", "foam_miss_prob", "foam_noise_cm",
                 "obstruct_hit_prob", "obstruct_noise_cm", "dropout_miss_prob"):
        values = [getattr(d, name) for d in draws]
        target = getattr(shifted, name)
        assert not min(values) <= target <= max(values), f"{name} : le profil décalé est dans la plage"
    assert all(d.glitch_cm[0] > shifted.glitch_cm[0] and d.splash_cm[1] > shifted.splash_cm[1] for d in draws)

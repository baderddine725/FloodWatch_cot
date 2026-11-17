# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : apprentissage automatique – tests
#  Fichier   : ml/tests/test_core_parity.py
#  Équipe    : FloodWatch – Auteur : Guesmi Baderddine
#  Créé le   : 2026-11-17          Modifié le : 2026-11-17          Version : 1.0
# =============================================================================
"""Le firmware et le simulateur décident exactement pareil.

Les mêmes lectures (banc simulé, avec défauts du capteur, crues et capteur aveugle) sont rejouées :

* dans le cœur C++ de l'ESP32 (``firmware/lib/floodwatch_core``), compilé pour le poste ;
* dans son jumeau Python du simulateur (``fwsim.features``, ``fwsim.anomaly``, ``fwsim.core``).

Pour chaque lecture : indicateurs au bit près (float32), décision du classifieur, barrière, feu,
sirène et mode. Une seule différence fait échouer le test.
"""
import os
import random
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SIM = REPO / "backend" / "simulator"
sys.path[:0] = [str(SIM), str(SIM / "tools")]

import sensor_bench  # noqa: E402
from fwsim.anomaly import AnomalyModel, f32  # noqa: E402
from fwsim.core import Outputs, SafetyController  # noqa: E402
from fwsim.features import FeatureState  # noqa: E402
from fwsim.sensor import SensorPhysics  # noqa: E402

CORE = REPO / "firmware" / "lib" / "floodwatch_core" / "src"
HARNESS = REPO / "firmware" / "test" / "host" / "core_replay.cpp"


@pytest.fixture(scope="module")
def replay_exe(tmp_path_factory):
    gxx = shutil.which("g++")
    if gxx is None:
        if os.environ.get("CI"):
            pytest.fail("g++ requis en intégration continue pour le test de parité firmware / simulateur")
        pytest.skip("g++ absent : test de parité non exécuté")
    exe = tmp_path_factory.mktemp("core") / "core_replay"
    subprocess.run([gxx, "-std=c++17", "-O2", "-Wall", "-Wextra", "-Werror", "-ffp-contract=off", f"-I{CORE}",
                    str(HARNESS), str(CORE / "fw_core.cpp"), "-o", str(exe)], check=True)
    return exe


def as_text(rows):
    """Lectures au format d'entrée du banc C++ : les MÊMES chaînes décimales des deux côtés."""
    return "".join(f"{r['t_s']},{r['sensor_ok']},{r['level_cm']},{r['echo_ok']},{r['echo_spread_cm']},{r['rain']}\n"
                   for r in rows)


def python_twin(rows):
    model = AnomalyModel.load()
    features, safety, out = FeatureState(), SafetyController(), Outputs()
    lines = []
    for r in rows:
        ok = bool(r["sensor_ok"])
        t, rain = float(str(r["t_s"])), float(str(r["rain"]))
        level = float(str(r["level_cm"])) if ok else 0.0
        x = features.update(t, ok, level if ok else None, int(r["echo_ok"]), float(str(r["echo_spread_cm"])), rain)
        suspect = bool(x is not None and model.suspect(x))
        safety.step(t, ok, level, rain, suspect, out)
        head = ";".join(format(f32(v), ".9g") for v in x) if x is not None else "-"
        lines.append(f"{head}|{int(suspect)}|{int(out.barrier_closed)}|{out.light}|{int(out.siren)}|{safety.mode}")
    return lines


@pytest.mark.parametrize("seed,physics", [(7, SensorPhysics()), (8, SensorPhysics.shifted()),
                                          (9, SensorPhysics.randomized(random.Random(9)))])
def test_firmware_and_simulator_decide_identically(replay_exe, seed, physics):
    rows = sensor_bench.generate(seed=seed, hours=8.0, physics=physics)
    native = subprocess.run([str(replay_exe)], input=as_text(rows), capture_output=True, text=True,
                            check=True).stdout.splitlines()
    twin = python_twin(rows)
    assert len(native) == len(twin) == len(rows)
    diffs = [(i, a, b) for i, (a, b) in enumerate(zip(native, twin)) if a != b]
    assert not diffs, f"{len(diffs)} lecture(s) divergent ; première : n°{diffs[0][0]}\n C++ : {diffs[0][1]}\n Py  : {diffs[0][2]}"
    # le rejeu couvre bien tous les cas : crue, lectures suspectes, capteur aveugle et mode dégradé
    modes = {line.rsplit("|", 1)[1] for line in twin}
    assert "LOCAL_SAFETY" in modes
    assert any(line.split("|")[1] == "1" for line in twin)
    assert any(line.startswith("-") for line in twin)


def test_degraded_policy_scenario():
    """Capteur aveugle sous la pluie : avertissement, puis fermeture de précaution, puis reprise."""
    s, out = SafetyController(), Outputs()
    assert s.step(0, False, 0.0, 0.5, False, out) and out.light == "ORANGE" and not out.barrier_closed
    assert not s.step(119, False, 0.0, 0.5, False, out) and s.mode == "NORMAL"
    assert s.step(120, False, 0.0, 0.5, False, out) and s.mode == "DEGRADED"
    assert out.barrier_closed and out.light == "RED" and not out.siren        # pas de sirène pour un défaut
    s.step(125, True, 5.0, 0.5, False, out)                                    # capteur revenu, sous l'orange
    assert s.mode == "DEGRADED"
    s.step(185, True, 5.0, 0.5, True, out)                                     # lecture suspecte : ne compte pas
    assert s.mode == "DEGRADED" and out.barrier_closed
    s.step(186, True, 5.0, 0.5, False, out)
    assert s.mode == "NORMAL" and not out.barrier_closed and out.light == "GREEN"


def test_suspect_reading_never_delays_a_closure():
    s, out = SafetyController(), Outputs()
    assert s.step(0, True, 18.0, 0.0, True, out) and out.barrier_closed and s.mode == "LOCAL_SAFETY"


def test_blind_without_rain_only_warns():
    s, out = SafetyController(), Outputs()
    for t in range(0, 600, 5):
        s.step(t, False, 0.0, 0.0, False, out)
    assert s.mode == "NORMAL" and not out.barrier_closed and out.light == "ORANGE"
    s.step(600, True, 3.0, 0.0, False, out)
    assert out.light == "GREEN"                                                # avertissement levé

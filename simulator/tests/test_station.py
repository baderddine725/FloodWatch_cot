# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – tests
#  Fichier   : simulator/tests/test_station.py
#  Équipe    : FloodWatch – Auteur : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03          Version : 1.0
# =============================================================================
"""Logique de la station virtuelle, sans broker : règle de sécurité locale, verrou, commandes,
publications (TD retenue, LWT, acquittements)."""
import json

from fwsim.config import BUILTIN_STATIONS
from fwsim.scenarios import SCENARIOS, scenario_for
from fwsim.station import VirtualStation
from fwsim.wot import validate_thing_description


def make(cfg, fake_mqtt):
    return VirtualStation(BUILTIN_STATIONS["underpass-01"], cfg, seed=1, mqtt_service=fake_mqtt)


def test_local_safety_closes_barrier_at_red_threshold(cfg, fake_mqtt):
    st = make(cfg, fake_mqtt)
    st.level = 17.2  # 86 % de 20 cm
    assert st.local_safety_rule(now=0)
    assert (st.barrier, st.light, st.siren, st.local_safety) == ("CLOSED", "RED", True, True)


def test_reopening_only_after_delay_below_orange(cfg, fake_mqtt):
    st = make(cfg, fake_mqtt)
    st.level = 18
    st.local_safety_rule(now=0)
    st.level = 11  # 55 % < orange
    assert not st.local_safety_rule(now=1)
    assert not st.local_safety_rule(now=60)   # 59 s : encore fermé
    assert st.barrier == "CLOSED"
    assert st.local_safety_rule(now=61.5)     # > 60 s : réouverture
    assert (st.barrier, st.light, st.local_safety) == ("OPEN", "ORANGE", False)


def test_open_command_refused_above_red(cfg, fake_mqtt):
    st = make(cfg, fake_mqtt)
    st.level = 18
    st._on_cmd("floodwatch/stations/underpass-01/cmd",
               json.dumps({"id": "c-1", "actuator": "barrier", "value": "OPEN"}).encode())
    topic, ack, qos, retain = fake_mqtt.last("/ack")
    assert ack == {"id": "c-1", "ok": False, "detail": "verrouillage sécurité : niveau au-dessus du seuil rouge"}
    assert st.barrier == "OPEN"  # inchangé par la commande refusée
    assert fake_mqtt.last("/state")[3] is True  # état republié, retenu


def test_commands_and_ack(cfg, fake_mqtt):
    st = make(cfg, fake_mqtt)
    for actuator, value in (("barrier", "CLOSE"), ("light", "ORANGE"), ("siren", "ON"), ("sampling", "WATCH")):
        st._on_cmd("t", json.dumps({"id": actuator, "actuator": actuator, "value": value}).encode())
        assert fake_mqtt.last("/ack")[1] == {"id": actuator, "ok": True}
    assert (st.barrier, st.light, st.siren, st.effective_sampling()) == ("CLOSED", "ORANGE", True, "WATCH")
    st._on_cmd("t", json.dumps({"id": "x", "actuator": "valve", "value": "ON"}).encode())
    assert fake_mqtt.last("/ack")[1]["ok"] is False


def test_retained_config_overrides_thresholds(cfg, fake_mqtt):
    st = make(cfg, fake_mqtt)
    st._on_config("t", json.dumps({"criticalCm": 40, "redPct": 90, "unknown": 1}).encode())
    st.level = 35  # 87,5 % de 40 cm : sous le nouveau seuil rouge
    assert not st.local_safety_rule(now=0)
    assert "unknown" not in st.thresholds


def test_connection_publishes_status_td_and_state_retained(cfg, fake_mqtt):
    st = make(cfg, fake_mqtt)
    st._on_connected()
    status, td, state = fake_mqtt.last("/status"), fake_mqtt.last("/td"), fake_mqtt.last("/state")
    assert status[:2] == ("floodwatch/stations/underpass-01/status", "online") and status[3]
    assert td[0] == "floodwatch/stations/underpass-01/td" and td[3] is True
    assert validate_thing_description(td[1])["valid"]
    assert state[3] is True


def test_raw_mode_publishes_to_gateway_topic(cfg, fake_mqtt):
    from dataclasses import replace
    st = VirtualStation(BUILTIN_STATIONS["underpass-01"], replace(cfg, raw=True), seed=1, mqtt_service=fake_mqtt)
    st.tick(now=1000)
    assert fake_mqtt.last("/telemetry")[0] == "fw/raw/underpass-01/telemetry"
    assert fake_mqtt.last("/heartbeat")[0] == "floodwatch/stations/underpass-01/heartbeat"


def test_storm_scenario_reaches_red_then_recedes(cfg, fake_mqtt):
    st = make(cfg, fake_mqtt)
    peak = 0.0
    for _ in range(int(600 / 0.5)):  # 10 min simulées
        st.step(0.5)
        peak = max(peak, st.pct())
    assert peak >= 85 and st.pct() < peak


def test_scenario_registry_strategy():
    assert set(SCENARIOS) == {"storm", "flash", "drizzle", "calm", "fault"}
    assert scenario_for("fault").sensor_fault(120) and not scenario_for("storm").sensor_fault(120)

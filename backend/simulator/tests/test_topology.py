# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – tests
#  Fichier   : backend/simulator/tests/test_topology.py
#  Équipe    : FloodWatch – Auteur : Guesmi Baderddine
#  Créé le   : 2026-11-17          Modifié le : 2026-11-17          Version : 1.0
# =============================================================================
"""Couplage hydrologique des stations (fog) : historique, liens du registre, temps de parcours."""
from fwsim.config import DEFAULT_STATIONS_FILE, SimConfig, load_registry
from fwsim.scenarios import RainScenario
from fwsim.station import VirtualStation
from fwsim.topology import LevelHistory, couple, links_of


class Rain(RainScenario):
    """Pluie constante sur l'amont seulement."""

    def __init__(self, value):
        self.value = value

    def rain(self, t):
        return self.value


def test_history_answers_the_last_known_level():
    h = LevelHistory(horizon_s=100)
    for t in range(0, 300, 10):
        h.add(t, t / 10)
    assert h.at(255) == 25.0, "dernier niveau connu avant l'instant demandé"
    assert h.at(155) == 0.0, "au-delà de l'horizon (100 s) : oublié"
    assert h.times[0] >= 190


def test_registry_declares_the_zone_topology():
    links = {(l.upstream, l.downstream): l for l in links_of(load_registry(DEFAULT_STATIONS_FILE))}
    assert set(links) == {("upstream-01", "wadi-01"), ("wadi-01", "underpass-01")}
    assert links[("upstream-01", "wadi-01")].travel_s == 480


def test_upstream_water_reaches_downstream_after_the_travel_time(fake_mqtt):
    reg = load_registry(DEFAULT_STATIONS_FILE)
    cfg = SimConfig(stations=(reg["upstream-01"], reg["wadi-01"])).validate()
    up = VirtualStation(reg["upstream-01"], cfg, seed=1, scenario=Rain(0.9), mqtt_service=fake_mqtt)
    down = VirtualStation(reg["wadi-01"], cfg, seed=2, scenario=Rain(0.0), mqtt_service=fake_mqtt)
    up.level = down.level = 0.0
    assert len(couple([up, down])) == 1 and len(down.inflows) == 1
    for _ in range(int(470 / 0.5)):                   # moins que le temps de parcours (480 s)
        up.step(0.5)
        down.step(0.5)
    assert up.level > 15 and down.level < 0.5, "l'eau amont n'est pas encore arrivée"
    for _ in range(int(600 / 0.5)):
        up.step(0.5)
        down.step(0.5)
    assert down.level > 5, "puis elle arrive et fait monter l'aval, sans pluie locale"


def test_station_without_its_upstream_simulated_is_uncoupled(fake_mqtt):
    reg = load_registry(DEFAULT_STATIONS_FILE)
    cfg = SimConfig(stations=(reg["wadi-01"],)).validate()
    down = VirtualStation(reg["wadi-01"], cfg, seed=2, mqtt_service=fake_mqtt)
    assert couple([down]) == [] and down.inflows == []

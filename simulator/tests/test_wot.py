# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – tests
#  Fichier   : simulator/tests/test_wot.py
#  Équipe    : FloodWatch – Auteur : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03          Version : 1.0
# =============================================================================
"""Validation des Thing Descriptions (comme validateThingDescription du cours) :
TD de chaque type de station, gabarit du firmware, cas invalides."""
import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest

from fwsim.config import STATION_TYPES, StationInfo
from fwsim.wot import ThingDescriptionFactory, validate_thing_description

SIM_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIM_DIR / "tools"))
import export_td  # noqa: E402

FACTORY = ThingDescriptionFactory("mqtts://broker.test:8883")


def td_for(station_type="UNDERPASS", code="underpass-01"):
    return FACTORY.create(StationInfo(code, "Station de test", station_type, "ariana", 36.86, 10.19))


@pytest.mark.parametrize("station_type", STATION_TYPES)
def test_td_of_each_station_type_is_valid(station_type):
    result = validate_thing_description(td_for(station_type))
    assert result == {"valid": True, "errors": []}


def test_td_follows_course_format_and_middleware_contract():
    td = td_for()
    assert td["@context"][0] == "https://www.w3.org/2022/wot/td/v1.1"
    assert td["id"] == "urn:floodwatch:station:underpass-01"  # même id que ThingDescriptions.java
    assert {"Thing", "Sensor", "Actuator"} <= set(td["@type"])
    assert set(td["properties"]) == {"waterLevel", "rain", "barrier", "light"}
    assert set(td["actions"]) == {"closeBarrier", "openBarrier", "setLight", "siren"}
    assert set(td["events"]) == {"floodAlert", "offline"}
    form = td["actions"]["closeBarrier"]["forms"][0]
    assert form["href"] == "mqtts://broker.test:8883/floodwatch/stations/underpass-01/cmd"
    assert form["mqv:topic"] == "floodwatch/stations/underpass-01/cmd"
    assert form["mqv:controlPacket"] == "publish" and form["op"] == ["invokeaction"]
    # la commande décrite est exactement celle du middleware (CommandManager) : actuator + value
    cmd = td["actions"]["closeBarrier"]["input"]["properties"]
    assert cmd["actuator"]["const"] == "barrier" and cmd["value"]["const"] == "CLOSE"
    assert td["events"]["offline"]["forms"][0]["mqv:topic"].endswith("/status")
    assert td["events"]["offline"]["forms"][0]["mqv:retain"] is True
    assert td["location"] == {"type": "Point", "coordinates": [10.19, 36.86]}  # [lon, lat] comme le cours


def test_td_is_json_serializable_and_small_enough_for_esp32():
    # forme compacte publiée par le simulateur et le firmware (envoyée en flux par PubSubClient.beginPublish)
    text = json.dumps(td_for(), ensure_ascii=False, separators=(",", ":"))
    assert len(text.encode("utf-8")) < 12 * 1024


@pytest.mark.parametrize("mutate, expected", [
    (lambda td: td.pop("@context"), "Missing @context"),
    (lambda td: td.pop("id"), "Missing id"),
    (lambda td: td.pop("title"), "Missing title"),
    (lambda td: td.pop("security"), "Missing security configuration"),
    (lambda td: td.update(id="station-01"), "Thing id must be a valid URN"),
    (lambda td: td.update(security=["oauth_sc"]), "n'est pas défini"),
    (lambda td: td["securityDefinitions"]["basic_sc"].update(scheme="password"), "scheme inconnu"),
    (lambda td: td["properties"]["waterLevel"].update(type="float"), "type « float » inconnu"),
    (lambda td: td["properties"]["waterLevel"].pop("forms"), "au moins un formulaire"),
    (lambda td: td["actions"]["setLight"]["forms"][0].update(op=["readproperty"]), "interdite pour actions"),
    (lambda td: td["actions"]["siren"]["forms"][0].update({"mqv:qos": 3}), "mqv:qos"),
    (lambda td: td["events"]["offline"]["forms"][0].pop("mqv:topic"), "mqv:topic obligatoire"),
    (lambda td: td["actions"]["siren"]["forms"][0].update({"mqv:topic": "floodwatch/stations/+/cmd",
                                                           "href": "mqtts://b:8883/floodwatch/stations/+/cmd"}),
     "joker"),
    (lambda td: td["properties"]["rain"]["forms"][0].update({"mqv:topic": "floodwatch/ariana/underpass-01/rain",
                                                             "href": "mqtts://b:8883/floodwatch/ariana/underpass-01/rain"}),
     "hors contrat"),
    (lambda td: td["properties"]["rain"]["forms"][0].update({"mqv:topic": "floodwatch/stations/wadi-01/telemetry",
                                                             "href": "mqtts://b:8883/floodwatch/stations/wadi-01/telemetry"}),
     "autre station"),
    (lambda td: td["actions"].pop("openBarrier"), "actions.openBarrier : affordance FloodWatch manquante"),
    (lambda td: td.update(location={"type": "Point", "coordinates": [200, 36]}), "location"),
    (lambda td: td["properties"]["rain"].update(minimum=2), "minimum > maximum"),
])
def test_invalid_td_is_rejected(mutate, expected):
    td = copy.deepcopy(td_for())
    mutate(td)
    result = validate_thing_description(td)
    assert not result["valid"]
    assert any(expected in e for e in result["errors"]), result["errors"]


def test_course_example_td_passes_generic_validation():
    """Exemple MQTT de docs/README.md du cours (capteur de luminosité)."""
    td = {
        "@context": "https://www.w3.org/2022/wot/td/v1.1", "title": "MyIlluminanceSensor",
        "id": "urn:uuid:9489991a-7622-45b6-8437-f858b59835d4",
        "securityDefinitions": {"nosec_sc": {"scheme": "nosec"}}, "security": ["nosec_sc"],
        "events": {"illuminance": {"data": {"type": "integer"}, "forms": [{
            "href": "mqtt://192.168.1.187:1883/illuminance", "contentType": "text/plain",
            "op": ["subscribeevent", "unsubscribeevent"], "mqv:topic": "illuminance",
            "mqv:controlPacket": "subscribe"}]}},
    }
    assert validate_thing_description(td, floodwatch=False)["valid"]
    assert not validate_thing_description("pas une TD")["valid"]


@pytest.mark.parametrize("station_type", STATION_TYPES)
def test_firmware_template_produces_valid_td(station_type):
    """Le gabarit embarqué dans l'ESP32, une fois rempli comme le fait le firmware, est une TD valide."""
    text = export_td.fill(export_td.template_for(station_type), code="wadi-07", title="Gué test", zone="ariana",
                          broker="mqtts://cloud.test:8883", lat="36.8792", lon="10.1637", fw="1.1.0")
    assert "{{" not in text
    td = json.loads(text)
    assert validate_thing_description(td)["valid"], validate_thing_description(td)["errors"]
    assert td["location"]["coordinates"] == [10.1637, 36.8792]


def test_generated_files_are_up_to_date():
    """firmware/include/td_template.h et docs/wot/*.td.json sont régénérés après chaque changement de la fabrique."""
    run = subprocess.run([sys.executable, str(SIM_DIR / "tools" / "export_td.py"), "--check"],
                         capture_output=True, text=True, encoding="utf-8")
    assert run.returncode == 0, run.stdout + run.stderr

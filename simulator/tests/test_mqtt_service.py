# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – tests
#  Fichier   : simulator/tests/test_mqtt_service.py
#  Équipe    : FloodWatch – Auteur : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03          Version : 1.0
# =============================================================================
"""Service MQTT : correspondance des motifs et répartition par règles (rôle de mqtt-dispatcher du cours)."""
from types import SimpleNamespace

import pytest

from fwsim.mqtt_service import MqttService, topic_matches


@pytest.mark.parametrize("pattern, topic, expected", [
    ("floodwatch/stations/+/cmd", "floodwatch/stations/wadi-01/cmd", True),
    ("floodwatch/stations/+/cmd", "floodwatch/stations/wadi-01/config", False),
    ("floodwatch/#", "floodwatch/stations/wadi-01/td", True),
    ("floodwatch/stations/#", "floodwatch/stations", True),
    ("floodwatch/stations/+", "floodwatch/stations/a/b", False),
    ("fw/raw/+/telemetry", "fw/raw/underpass-01/telemetry", True),
    ("a/b", "a/b/c", False),
])
def test_topic_matches(pattern, topic, expected):
    assert topic_matches(pattern, topic) is expected


def test_dispatch_to_matching_rules_and_unsubscribe():
    svc = MqttService("test", "localhost", 1883)
    received = []
    cb_cmd = lambda t, p: received.append(("cmd", t, p))  # noqa: E731
    svc.subscribe("floodwatch/stations/+/cmd", cb_cmd, qos=1)
    svc.subscribe("floodwatch/#", lambda t, p: received.append(("all", t, p)))
    svc._on_message(None, None, SimpleNamespace(topic="floodwatch/stations/x/cmd", payload=b"{}"))
    assert [r[0] for r in received] == ["cmd", "all"]
    svc.unsubscribe("floodwatch/stations/+/cmd", cb_cmd)
    received.clear()
    svc._on_message(None, None, SimpleNamespace(topic="floodwatch/stations/x/cmd", payload=b"{}"))
    assert [r[0] for r in received] == ["all"]


def test_failing_rule_does_not_break_others():
    svc = MqttService("test", "localhost", 1883)
    received = []
    svc.subscribe("a/#", lambda t, p: 1 / 0)
    svc.subscribe("a/#", lambda t, p: received.append(t))
    svc._on_message(None, None, SimpleNamespace(topic="a/b", payload=b""))
    assert received == ["a/b"]


def test_publish_serializes_dict_as_json():
    svc = MqttService("test", "localhost", 1883)
    sent = {}
    svc.client.publish = lambda topic, payload, qos, retain: sent.update(t=topic, p=payload, r=retain) or \
        SimpleNamespace(rc=0)
    assert svc.publish("x/td", {"title": "Gué"}, qos=1, retain=True)
    assert sent == {"t": "x/td", "p": '{"title":"Gué"}', "r": True}

# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – tests
#  Fichier   : simulator/tests/conftest.py
#  Équipe    : FloodWatch – Auteur : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03          Version : 1.0
# =============================================================================
"""Fixtures communes : chemin du paquet fwsim, configuration de test, faux client MQTT."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fwsim.config import BUILTIN_STATIONS, SimConfig  # noqa: E402


class FakeMqtt:
    """Remplace MqttService : enregistre les publications, ne se connecte à rien."""

    def __init__(self):
        self.published = []
        self.connected = True

    def publish(self, topic, payload, qos=0, retain=False):
        self.published.append((topic, payload, qos, retain))
        return True

    def last(self, suffix):
        """Dernière publication dont le topic se termine par ``suffix``."""
        return next((p for p in reversed(self.published) if p[0].endswith(suffix)), None)


@pytest.fixture
def cfg():
    return SimConfig(stations=(BUILTIN_STATIONS["underpass-01"],), td_broker_url="mqtts://broker.test:8883").validate()


@pytest.fixture
def fake_mqtt():
    return FakeMqtt()

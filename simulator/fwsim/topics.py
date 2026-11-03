# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – back-end & IoT
#  Fichier   : simulator/fwsim/topics.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03
#  Version   : 1.0
# =============================================================================
"""Contrat MQTT, aligné sur le middleware (backend/.../managers/Topics.java, docs/mqtt-topics.md).

Seul ajout : ``floodwatch/stations/{code}/td`` (Thing Description, retenue). Le middleware ne s'y
abonne pas et ignore ce type de message sans erreur.
"""

ROOT = "floodwatch/stations"
RAW_ROOT = "fw/raw"

# Types de messages montants (station -> Cloud) et descendants (Cloud -> station)
UPLINK_KINDS = ("telemetry", "heartbeat", "state", "status", "ack", "td")
DOWNLINK_KINDS = ("cmd", "config")


def station(code: str, kind: str) -> str:
    """Topic ``floodwatch/stations/{code}/{kind}``."""
    return f"{ROOT}/{code}/{kind}"


def raw_telemetry(code: str) -> str:
    """Télémétrie brute destinée à la passerelle Node-RED (broker local uniquement)."""
    return f"{RAW_ROOT}/{code}/telemetry"

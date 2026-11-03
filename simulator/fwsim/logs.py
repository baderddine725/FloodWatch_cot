# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – back-end & IoT
#  Fichier   : simulator/fwsim/logs.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03
#  Version   : 1.0
# =============================================================================
"""Journaux structurés : une ligne JSON par événement (``LOG_FORMAT=json``, pour Docker)
ou une ligne lisible (``text``, par défaut en console).

Les champs métier passent par ``extra`` : ``log.info("...", extra={"station": code, "event": "cmd"})``.
"""
import json
import logging
import sys
import time

_EXTRA_FIELDS = ("station", "event", "topic", "levelCm", "pct", "detail")


class JsonFormatter(logging.Formatter):
    """Formate un enregistrement en un objet JSON sur une ligne."""

    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key in _EXTRA_FIELDS:
            if hasattr(record, key):
                entry[key] = getattr(record, key)
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    """Format console : ``HH:MM:SS NIVEAU [station] message``."""

    def format(self, record: logging.LogRecord) -> str:
        who = getattr(record, "station", record.name.split(".")[-1])
        return f"{time.strftime('%H:%M:%S', time.localtime(record.created))} {record.levelname:<7} [{who}] {record.getMessage()}"


def setup_logging(fmt: str = "text", verbose: bool = False) -> None:
    """Configure le journal racine (à appeler une seule fois, au démarrage)."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if fmt == "json" else TextFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.DEBUG if verbose else logging.INFO)
    logging.getLogger("paho").setLevel(logging.WARNING)

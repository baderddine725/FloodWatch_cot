# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – back-end & IoT
#  Fichier   : simulator/fwsim/config.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03
#  Version   : 1.0
# =============================================================================
"""Configuration centralisée du simulateur, validée au démarrage
(même principe que main/config/env.config.mjs + schéma zod du cours).

Ordre de priorité : option de ligne de commande > variable d'environnement ``SIM_*`` > défaut.
Les secrets (mot de passe MQTT) se passent par l'environnement (``SIM_PASSWORD``) : jamais dans le dépôt.
Une configuration invalide arrête le programme avec la liste de TOUS les problèmes (code 2).
"""
from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from .scenarios import SCENARIOS

#: valeur spéciale de --username : chaque station se connecte avec son code (ACL du broker local)
PER_STATION_USER = "{code}"
STATION_CODE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")
STATION_TYPES = ("UNDERPASS", "WADI", "LOW_ROAD", "FORD", "OTHER")  # = StationType du middleware
DEFAULT_STATIONS_FILE = Path(__file__).resolve().parents[2] / "gateway" / "stations.json"


class ConfigError(ValueError):
    """Configuration invalide. ``problems`` liste chaque erreur trouvée."""

    def __init__(self, problems):
        self.problems = list(problems)
        super().__init__("configuration invalide :\n  - " + "\n  - ".join(self.problems))


@dataclass(frozen=True)
class StationInfo:
    """Identité d'une station : code MQTT, titre, type, zone et position GPS."""

    code: str
    title: str
    type: str = "OTHER"
    zone: str = "default"
    lat: float = 0.0
    lon: float = 0.0
    critical_cm: float = 20.0
    sensor_height_cm: float = 30.0


#: stations de démonstration du middleware (SeedManager), si gateway/stations.json est absent
BUILTIN_STATIONS = {
    "underpass-01": StationInfo("underpass-01", "Passage souterrain Ariana", "UNDERPASS", "ariana", 36.8625, 10.1956),
    "wadi-01": StationInfo("wadi-01", "Gué de l'oued Ariana", "WADI", "ariana", 36.8792, 10.1637),
}


@dataclass(frozen=True)
class SimConfig:
    """Paramètres d'exécution du simulateur (immuables une fois validés)."""

    host: str = "localhost"
    port: int = 1883
    username: str = ""
    password: str = field(default="", repr=False)  # secret : jamais affiché
    tls: bool = False
    cafile: str | None = None
    insecure: bool = False
    stations: tuple[StationInfo, ...] = ()
    scenario: str = "storm"
    speed: float = 1.0
    raw: bool = False
    offline_after: float = 0.0
    duration: float = 0.0
    verbose: bool = False
    publish_td: bool = True
    td_broker_url: str = "mqtts://localhost:8883"
    health_port: int = 0
    log_format: str = "text"

    def username_for(self, code: str) -> str:
        """Nom d'utilisateur MQTT d'une station (son code si ``--username {code}``)."""
        return code if self.username == PER_STATION_USER else self.username

    def problems(self) -> list[str]:
        """Liste les incohérences (vide si la configuration est valide)."""
        p = []
        if not self.host:
            p.append("host : obligatoire")
        if not 1 <= self.port <= 65535:
            p.append(f"port : {self.port} hors de 1..65535")
        if self.username and not self.password:
            p.append("password : obligatoire quand username est défini (variable SIM_PASSWORD)")
        if self.tls and self.cafile and not Path(self.cafile).is_file():
            p.append(f"cafile : fichier introuvable ({self.cafile})")
        if not self.stations:
            p.append("stations : au moins une station")
        for s in self.stations:
            if not STATION_CODE_RE.match(s.code):
                p.append(f"station « {s.code} » : code invalide (minuscules, chiffres, tirets)")
            if s.type not in STATION_TYPES:
                p.append(f"station {s.code} : type {s.type} inconnu ({', '.join(STATION_TYPES)})")
            if not (-90 <= s.lat <= 90 and -180 <= s.lon <= 180):
                p.append(f"station {s.code} : coordonnées GPS invalides ({s.lat}, {s.lon})")
        if len({s.code for s in self.stations}) != len(self.stations):
            p.append("stations : codes en double")
        if self.scenario not in SCENARIOS:
            p.append(f"scenario : {self.scenario} inconnu ({', '.join(SCENARIOS)})")
        if self.speed <= 0:
            p.append("speed : doit être > 0")
        if self.offline_after < 0 or self.duration < 0:
            p.append("offline_after / duration : doivent être >= 0")
        if not re.match(r"^mqtts?://[^/\s]+$", self.td_broker_url):
            p.append(f"td_broker_url : {self.td_broker_url} (attendu mqtt://hôte:port ou mqtts://hôte:port)")
        if not 0 <= self.health_port <= 65535:
            p.append(f"health_port : {self.health_port} hors de 0..65535")
        if self.log_format not in ("text", "json"):
            p.append("log_format : text ou json")
        return p

    def validate(self) -> "SimConfig":
        """Lève :class:`ConfigError` si la configuration est incohérente ; sinon renvoie ``self``."""
        problems = self.problems()
        if problems:
            raise ConfigError(problems)
        return self


# --------------------------------------------------------------------------- chargement
def _bool(value: str | None, default: bool = False) -> bool:
    """Interprète une variable d'environnement booléenne (1/true/yes/on)."""
    if value is None or value == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def load_registry(path: Path | None) -> dict[str, StationInfo]:
    """Charge le registre des stations (gateway/stations.json) ; registre intégré s'il est absent."""
    if path is None or not path.is_file():
        return dict(BUILTIN_STATIONS)
    data = json.loads(path.read_text(encoding="utf-8"))
    registry = {}
    for s in data.get("stations", []):
        registry[s["code"]] = StationInfo(
            code=s["code"], title=s.get("title", s["code"]), type=s.get("type", "OTHER"),
            zone=s.get("zone", data.get("zone", "default")), lat=float(s.get("lat", 0)), lon=float(s.get("lon", 0)),
            critical_cm=float(s.get("criticalCm", 20)), sensor_height_cm=float(s.get("sensorHeightCm", 30)))
    return registry


def resolve_stations(codes: str, registry: dict[str, StationInfo]) -> tuple[StationInfo, ...]:
    """Associe chaque code demandé à son identité ; un code inconnu reçoit une identité générique."""
    zone = next(iter(registry.values())).zone if registry else "default"
    out = []
    for code in (c.strip() for c in codes.split(",")):
        if code:
            out.append(registry.get(code) or StationInfo(code=code, title=code, zone=zone))
    return tuple(out)


def build_parser(env: dict) -> argparse.ArgumentParser:
    """Options de ligne de commande ; leurs valeurs par défaut viennent de l'environnement."""
    e = env.get
    p = argparse.ArgumentParser(description="Simulateur de stations FloodWatch (remplace les ESP32)")
    p.add_argument("--host", default=e("SIM_HOST", "localhost"))
    p.add_argument("--port", type=int, default=int(e("SIM_PORT", "1883")))
    p.add_argument("--username", default=e("SIM_USERNAME", ""),
                   help=f"compte MQTT ; « {PER_STATION_USER} » = chaque station utilise son code (broker local)")
    p.add_argument("--password", default=e("SIM_PASSWORD", ""), help="préférer la variable SIM_PASSWORD")
    p.add_argument("--tls", action="store_true", default=_bool(e("SIM_TLS")), help="MQTT sur TLS (port 8883)")
    p.add_argument("--cafile", default=e("SIM_CAFILE") or None, help="certificat de l'AC du broker")
    p.add_argument("--insecure", action="store_true", default=_bool(e("SIM_INSECURE")),
                   help="ne pas vérifier le nom d'hôte du certificat")
    p.add_argument("--stations", default=e("SIM_STATIONS", "underpass-01,wadi-01"))
    p.add_argument("--stations-file", default=e("SIM_STATIONS_FILE", str(DEFAULT_STATIONS_FILE)),
                   help="registre des stations (zone, type, GPS)")
    p.add_argument("--scenario", default=e("SIM_SCENARIO", "storm"), help=", ".join(SCENARIOS))
    p.add_argument("--speed", type=float, default=float(e("SIM_SPEED", "1")), help="accélération du temps simulé")
    p.add_argument("--raw", action="store_true", default=_bool(e("SIM_RAW")),
                   help="télémétrie brute vers la passerelle Node-RED (fw/raw/...)")
    p.add_argument("--offline-after", type=float, default=float(e("SIM_OFFLINE_AFTER", "0")),
                   help="la 1re station se tait après N s (démo station muette)")
    p.add_argument("--duration", type=float, default=float(e("SIM_DURATION", "0")), help="arrêt après N s (0 = infini)")
    p.add_argument("--no-td", action="store_true", default=not _bool(e("SIM_PUBLISH_TD"), True),
                   help="ne pas publier la Thing Description")
    p.add_argument("--td-broker-url", default=e("SIM_TD_BROKER_URL", "mqtts://localhost:8883"),
                   help="URL publique du broker écrite dans les formulaires de la TD")
    p.add_argument("--health-port", type=int, default=int(e("SIM_HEALTH_PORT", "0")),
                   help="port HTTP de GET /health (0 = désactivé)")
    p.add_argument("--log-format", default=e("LOG_FORMAT", "text"), choices=["text", "json"])
    p.add_argument("--verbose", "-v", action="store_true", default=_bool(e("SIM_VERBOSE")))
    return p


def load_config(argv: list[str] | None = None, env: dict | None = None) -> SimConfig:
    """Construit et valide la configuration (lève :class:`ConfigError`)."""
    env = dict(os.environ if env is None else env)
    try:
        a = build_parser(env).parse_args(argv)
    except ValueError as exc:  # variable d'environnement numérique mal formée
        raise ConfigError([f"variable d'environnement invalide : {exc}"]) from exc
    registry = load_registry(Path(a.stations_file) if a.stations_file else None)
    cfg = SimConfig(
        host=a.host, port=a.port, username=a.username, password=a.password, tls=a.tls, cafile=a.cafile,
        insecure=a.insecure, stations=resolve_stations(a.stations, registry), scenario=a.scenario, speed=a.speed,
        raw=a.raw, offline_after=a.offline_after, duration=a.duration, verbose=a.verbose,
        publish_td=not a.no_td, td_broker_url=a.td_broker_url.rstrip("/"), health_port=a.health_port,
        log_format=a.log_format)
    return cfg.validate()


__all__ = ["ConfigError", "SimConfig", "StationInfo", "PER_STATION_USER", "load_config", "load_registry",
           "resolve_stations"]

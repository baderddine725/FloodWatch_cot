# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – back-end & IoT
#  Fichier   : simulator/fwsim/wot.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03
#  Version   : 1.0
# =============================================================================
"""W3C WoT Thing Description 1.1 des stations FloodWatch, au format du cours
(things/models/things.model.mjs et docs/README.md du projet WoT-NodeJS).

* :class:`ThingDescriptionFactory` (patron Factory) : une TD par type de station
  (passage souterrain, gué d'oued, route basse...) ; formulaires MQTT pointant vers les topics
  du contrat du middleware (``href`` = broker + topic, ``mqv:topic``, ``mqv:controlPacket``,
  ``mqv:qos``, ``mqv:retain``, comme le modèle du cours) ;
* :func:`validate_thing_description` : même résultat que ``validateThingDescription`` du cours
  (``{"valid": bool, "errors": [...]}``), mêmes contrôles de base (@context, id, title, sécurité),
  complétés par les contraintes du modèle Mongoose du cours (énumérations ``op``, types JSON Schema,
  schémas de sécurité, identifiant URN, ``location`` GeoJSON) et par le contrat FloodWatch.

Chaque station publie sa TD, retenue, sur ``floodwatch/stations/{code}/td``.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from . import topics
from .config import StationInfo

TD_CONTEXT = "https://www.w3.org/2022/wot/td/v1.1"
TD_CONTEXT_V1 = "https://www.w3.org/2019/wot/td/v1"
MQV_NS = "http://www.example.org/mqtt-binding#"  # même préfixe que ThingDescriptions.java (middleware)
FW_NS = "urn:floodwatch:vocab#"
TD_INSTANCE_VERSION = "1.1.0"
TD_MODEL = "floodwatch-station/1"

# --------------------------------------------------------------------------- profils par type
@dataclass(frozen=True)
class StationProfile:
    """Caractéristiques d'un type de station (texte et type sémantique de la TD)."""

    semantic_type: str
    description: str


PROFILES = {
    "UNDERPASS": StationProfile(
        "UnderpassStation",
        "Station de passage souterrain (trémie) : mesure du niveau d'eau (HC-SR04) et de la pluie ; "
        "barrière, feu tricolore et sirène. Ferme seule la barrière au seuil rouge, même sans Cloud."),
    "WADI": StationProfile(
        "WadiFordStation",
        "Station de gué d'oued : route basse traversant l'oued, crue rapide possible. Mesure du niveau "
        "et de la pluie ; barrière, feu et sirène ; fermeture autonome au seuil rouge."),
    "LOW_ROAD": StationProfile(
        "LowRoadStation", "Station de route basse inondable : niveau, pluie, barrière, feu et sirène."),
    "FORD": StationProfile(
        "FordStation", "Station de radier / gué : niveau, pluie, barrière, feu et sirène."),
    "OTHER": StationProfile(
        "FloodStation", "Station FloodWatch : niveau, pluie, barrière, feu et sirène."),
}

# --------------------------------------------------------------------------- schémas réutilisés
ACK_SCHEMA = {
    "type": "object",
    "description": "Acquittement publié par la station sur floodwatch/stations/{code}/ack",
    "properties": {
        "id": {"type": "string", "description": "identifiant de la commande"},
        "ok": {"type": "boolean"},
        "detail": {"type": "string", "description": "raison du refus (ex. verrouillage sécurité)"},
    },
    "required": ["id", "ok"],
}

STATE_SCHEMA = {
    "type": "object",
    "properties": {
        "barrier": {"type": "string", "enum": ["OPEN", "CLOSED"]},
        "light": {"type": "string", "enum": ["GREEN", "ORANGE", "RED", "OFF"]},
        "siren": {"type": "boolean"},
        "sampling": {"type": "string", "enum": ["NORMAL", "WATCH"]},
        "localSafety": {"type": "boolean", "description": "vrai pendant une fermeture autonome"},
    },
    "required": ["barrier", "light", "siren", "localSafety"],
}


def command_schema(actuator: str, values: list[str]) -> dict:
    """Schéma d'entrée d'une action = charge utile de ``…/cmd`` attendue par le firmware et le middleware."""
    value = {"type": "string", "const": values[0]} if len(values) == 1 else {"type": "string", "enum": values}
    return {
        "type": "object",
        "properties": {
            "id": {"type": "string", "description": "UUID de la commande, repris dans l'acquittement"},
            "actuator": {"type": "string", "const": actuator},
            "value": value,
            "ts": {"type": "integer", "description": "horodatage d'émission (ms depuis 1970)"},
        },
        "required": ["id", "actuator", "value"],
    }


# --------------------------------------------------------------------------- fabrique
class ThingDescriptionFactory:
    """Fabrique de Thing Descriptions de stations (une par type, cf. :data:`PROFILES`)."""

    def __init__(self, broker_url: str, firmware_version: str = "sim-1.1.0", device_model: str = "FloodWatch station"):
        self.broker_url = broker_url.rstrip("/")
        self.firmware_version = firmware_version
        self.device_model = device_model

    def _form(self, topic: str, packet: str, ops: list[str], *, retain: bool | None = None,
              content_type: str = "application/json") -> dict:
        """Formulaire MQTT au format du cours : href = broker + topic, puis vocabulaire ``mqv:``."""
        form = {"href": f"{self.broker_url}/{topic}", "contentType": content_type, "op": ops,
                "mqv:controlPacket": packet, "mqv:topic": topic, "mqv:qos": 1}
        if retain is not None:
            form["mqv:retain"] = retain
        return form

    def create(self, info: StationInfo) -> dict:
        """Construit la TD complète d'une station."""
        profile = PROFILES.get(info.type, PROFILES["OTHER"])
        t = lambda kind: topics.station(info.code, kind)  # noqa: E731
        observe = ["observeproperty", "unobserveproperty"]
        subscribe = ["subscribeevent", "unsubscribeevent"]

        def prop(title, description, schema, kind, field, retain=False):
            return {"title": title, "description": description, **schema, "readOnly": True, "observable": True,
                    "fw:field": field, "forms": [self._form(t(kind), "subscribe", observe, retain=retain)]}

        def action(title, description, actuator, values, idempotent=True):
            return {"title": title, "description": description, "input": command_schema(actuator, values),
                    "output": ACK_SCHEMA, "safe": False, "idempotent": idempotent, "synchronous": False,
                    "fw:ackTopic": t("ack"), "forms": [self._form(t("cmd"), "publish", ["invokeaction"])]}

        return {
            "@context": [TD_CONTEXT, {"mqv": MQV_NS, "fw": FW_NS}],
            "@type": ["Thing", "Sensor", "Actuator", "fw:FloodWatchStation", f"fw:{profile.semantic_type}"],
            "id": f"urn:floodwatch:station:{info.code}",
            "title": info.title,
            "description": profile.description,
            "version": {"instance": TD_INSTANCE_VERSION, "model": TD_MODEL},
            "securityDefinitions": {
                "basic_sc": {"scheme": "basic",
                             "description": "compte MQTT (utilisateur / mot de passe), droits fixés par les ACL Mosquitto"},
            },
            "security": ["basic_sc"],
            "properties": {
                "waterLevel": prop("Niveau d'eau", "Hauteur d'eau (HC-SR04), filtrée par la passerelle "
                                   "(champ levelCm du message telemetry)",
                                   {"type": "number", "unit": "cm", "minimum": 0}, "telemetry", "levelCm"),
                "rain": prop("Pluie", "Intensité de pluie normalisée, 0 = sec, 1 = saturé (champ rain)",
                             {"type": "number", "minimum": 0, "maximum": 1}, "telemetry", "rain"),
                "barrier": prop("Barrière", "État de la barrière (champ barrier du message state, retenu)",
                                {"type": "string", "enum": ["OPEN", "CLOSED"]}, "state", "barrier", retain=True),
                "light": prop("Feu", "Couleur du feu (champ light du message state, retenu)",
                              {"type": "string", "enum": ["GREEN", "ORANGE", "RED", "OFF"]}, "state", "light",
                              retain=True),
            },
            "actions": {
                "closeBarrier": action("Fermer la barrière", "Baisse la barrière et interdit la route", "barrier",
                                       ["CLOSE"]),
                "openBarrier": action("Ouvrir la barrière", "Lève la barrière. REFUSÉ par la station (ack ok=false) "
                                      "tant que le niveau dépasse le seuil rouge (verrou de sécurité)", "barrier",
                                      ["OPEN"]),
                "setLight": action("Commander le feu", "Change la couleur du feu tricolore", "light",
                                   ["GREEN", "ORANGE", "RED", "OFF"]),
                "siren": action("Commander la sirène", "Déclenche (ON) ou arrête (OFF) la sirène", "siren",
                                ["ON", "OFF"]),
            },
            "events": {
                "floodAlert": {
                    "title": "Alerte crue (sécurité locale)",
                    "description": "La station a fermé seule la barrière (niveau au-dessus du seuil rouge) : "
                                   "message state retenu avec localSafety = true",
                    "data": STATE_SCHEMA, "fw:condition": "localSafety == true",
                    "forms": [self._form(t("state"), "subscribe", subscribe, retain=True)],
                },
                "offline": {
                    "title": "Station hors ligne",
                    "description": "Message de dernière volonté MQTT (LWT, retenu) : « offline » à la perte de "
                                   "connexion, « online » au retour",
                    "data": {"type": "string", "enum": ["online", "offline"]}, "fw:lastWill": True,
                    "forms": [self._form(t("status"), "subscribe", subscribe, retain=True,
                                         content_type="text/plain")],
                },
            },
            "links": [{"rel": "alternate", "href": f"{self.broker_url}/{t('td')}", "type": "application/td+json"}],
            # Extensions du modèle Thing du cours (things.model.mjs)
            "location": {"type": "Point", "coordinates": [info.lon, info.lat]},
            "tags": ["floodwatch", info.zone, info.type.lower()],
            "model": self.device_model,
            "firmwareVersion": self.firmware_version,
            "fw:stationCode": info.code,
            "fw:stationType": info.type,
            "fw:zone": info.zone,
        }


# --------------------------------------------------------------------------- validation
# Contraintes reprises du modèle Mongoose du cours (things.model.mjs)
URN_RE = re.compile(r"^urn:[a-zA-Z0-9][a-zA-Z0-9-]{0,31}:([a-zA-Z0-9()+,\-.:=@;$_!*'/]|%[0-9A-Fa-f]{2})+$")
DATA_TYPES = {"null", "boolean", "object", "array", "number", "integer", "string"}
SECURITY_SCHEMES = {"nosec", "combo", "basic", "digest", "bearer", "oauth2", "apikey", "psk", "public"}
OPS = {
    "properties": {"readproperty", "writeproperty", "observeproperty", "unobserveproperty"},
    "actions": {"invokeaction", "queryaction", "cancelaction"},
    "events": {"subscribeevent", "unsubscribeevent"},
}
MQTT_PACKETS = {"publish", "subscribe", "unsubscribe"}
CONTRACT_TOPIC_RE = re.compile(r"^floodwatch/stations/([a-z0-9][a-z0-9-]*)/(telemetry|heartbeat|state|status|ack|cmd|config|td)$")
FLOODWATCH_AFFORDANCES = {
    "properties": ("waterLevel", "rain", "barrier", "light"),
    "actions": ("closeBarrier", "openBarrier", "setLight", "siren"),
    "events": ("floodAlert", "offline"),
}


def _check_schema(schema, where: str, errors: list[str]) -> None:
    """Contrôle récursif d'un DataSchema (types, enum, bornes, sous-schémas)."""
    if not isinstance(schema, dict):
        errors.append(f"{where} : le schéma doit être un objet")
        return
    if "type" in schema and schema["type"] not in DATA_TYPES:
        errors.append(f"{where} : type « {schema['type']} » inconnu")
    if "enum" in schema and (not isinstance(schema["enum"], list) or not schema["enum"]):
        errors.append(f"{where} : enum doit être une liste non vide")
    if isinstance(schema.get("minimum"), (int, float)) and isinstance(schema.get("maximum"), (int, float)) \
            and schema["minimum"] > schema["maximum"]:
        errors.append(f"{where} : minimum > maximum")
    for name, sub in (schema.get("properties") or {}).items():
        _check_schema(sub, f"{where}.properties.{name}", errors)
    if "items" in schema:
        _check_schema(schema["items"], f"{where}.items", errors)
    for key in ("required",):
        if key in schema and not (isinstance(schema[key], list) and all(isinstance(x, str) for x in schema[key])):
            errors.append(f"{where} : {key} doit être une liste de chaînes")


def _check_form(form, kind: str, where: str, errors: list[str]) -> None:
    """Contrôle d'un formulaire : href, op adaptées au type d'affordance, vocabulaire MQTT."""
    if not isinstance(form, dict):
        errors.append(f"{where} : le formulaire doit être un objet")
        return
    href = form.get("href")
    if not isinstance(href, str) or not href:
        errors.append(f"{where} : href obligatoire")
        href = ""
    ops = form.get("op")
    ops = [ops] if isinstance(ops, str) else ops
    if not isinstance(ops, list) or not ops:
        errors.append(f"{where} : op obligatoire")
    else:
        for op in ops:
            if op not in OPS[kind]:
                errors.append(f"{where} : op « {op} » interdite pour {kind}")
    if href.startswith(("mqtt://", "mqtts://")):
        topic = form.get("mqv:topic")
        if not isinstance(topic, str) or not topic:
            errors.append(f"{where} : mqv:topic obligatoire pour un formulaire MQTT")
        elif not href.endswith("/" + topic):
            errors.append(f"{where} : href doit se terminer par le topic ({topic})")
        if form.get("mqv:controlPacket") not in MQTT_PACKETS:
            errors.append(f"{where} : mqv:controlPacket doit valoir {sorted(MQTT_PACKETS)}")
        if form.get("mqv:controlPacket") == "publish" and isinstance(topic, str) and ("+" in topic or "#" in topic):
            errors.append(f"{where} : pas de joker dans un topic de publication")
    if "mqv:qos" in form and form["mqv:qos"] not in (0, 1, 2):
        errors.append(f"{where} : mqv:qos doit valoir 0, 1 ou 2")
    if "mqv:retain" in form and not isinstance(form["mqv:retain"], bool):
        errors.append(f"{where} : mqv:retain doit être un booléen")


def validate_thing_description(td, *, floodwatch: bool = True) -> dict:
    """Valide une TD. Renvoie ``{"valid": bool, "errors": [...]}`` comme ``validateThingDescription`` du cours.

    :param floodwatch: contrôle aussi le contrat FloodWatch (affordances obligatoires, topics du middleware).
    """
    errors: list[str] = []
    if not isinstance(td, dict):
        return {"valid": False, "errors": ["la Thing Description doit être un objet JSON"]}

    # 1. Contrôles de base, identiques au cours
    if not td.get("@context"):
        errors.append("Missing @context")
    if not td.get("id"):
        errors.append("Missing id")
    if not td.get("title"):
        errors.append("Missing title")
    if not td.get("securityDefinitions") or not td.get("security"):
        errors.append("Missing security configuration")

    # 2. Contraintes du modèle Thing du cours
    ctx = td.get("@context")
    ctx_list = ctx if isinstance(ctx, list) else [ctx]
    if ctx and not any(c in (TD_CONTEXT, TD_CONTEXT_V1) for c in ctx_list if isinstance(c, str)):
        errors.append(f"@context doit contenir {TD_CONTEXT}")
    if td.get("id") and not URN_RE.match(str(td["id"])):
        errors.append("Thing id must be a valid URN")
    if "@type" in td and not (isinstance(td["@type"], (str, list))):
        errors.append("@type doit être une chaîne ou une liste")
    defs = td.get("securityDefinitions") or {}
    if not isinstance(defs, dict):
        errors.append("securityDefinitions doit être un objet")
        defs = {}
    for name, scheme in defs.items():
        if not isinstance(scheme, dict) or scheme.get("scheme") not in SECURITY_SCHEMES:
            errors.append(f"securityDefinitions.{name} : scheme inconnu")
    security = td.get("security")
    for name in ([security] if isinstance(security, str) else security or []):
        if name not in defs:
            errors.append(f"security : « {name} » n'est pas défini dans securityDefinitions")
    loc = td.get("location")
    if loc is not None:
        coords = loc.get("coordinates") if isinstance(loc, dict) else None
        if not isinstance(loc, dict) or loc.get("type") != "Point" or not isinstance(coords, list) or len(coords) < 2 \
                or not (-180 <= coords[0] <= 180 and -90 <= coords[1] <= 90):
            errors.append("location : Point GeoJSON [longitude, latitude] attendu")

    # 3. Affordances
    for kind in ("properties", "actions", "events"):
        group = td.get(kind, {})
        if not isinstance(group, dict):
            errors.append(f"{kind} doit être un objet")
            continue
        for name, aff in group.items():
            where = f"{kind}.{name}"
            if not isinstance(aff, dict):
                errors.append(f"{where} : doit être un objet")
                continue
            forms = aff.get("forms")
            if not isinstance(forms, list) or not forms:
                errors.append(f"{where} : au moins un formulaire (forms)")
                forms = []
            for i, form in enumerate(forms):
                _check_form(form, kind, f"{where}.forms[{i}]", errors)
            if kind == "properties":
                _check_schema(aff, where, errors)
                if aff.get("readOnly") and aff.get("writeOnly"):
                    errors.append(f"{where} : readOnly et writeOnly incompatibles")
            elif kind == "actions":
                for key in ("input", "output"):
                    if key in aff:
                        _check_schema(aff[key], f"{where}.{key}", errors)
            elif "data" in aff:
                _check_schema(aff["data"], f"{where}.data", errors)

    # 4. Contrat FloodWatch
    if floodwatch:
        code = str(td.get("id", "")).rsplit(":", 1)[-1]
        for kind, names in FLOODWATCH_AFFORDANCES.items():
            for name in names:
                if name not in (td.get(kind) or {}):
                    errors.append(f"{kind}.{name} : affordance FloodWatch manquante")
        for kind in ("properties", "actions", "events"):
            for name, aff in (td.get(kind) or {}).items():
                for form in (aff.get("forms") or []) if isinstance(aff, dict) else []:
                    topic = form.get("mqv:topic") if isinstance(form, dict) else None
                    if topic is None:
                        continue
                    m = CONTRACT_TOPIC_RE.match(topic)
                    if not m:
                        errors.append(f"{kind}.{name} : topic {topic} hors contrat (floodwatch/stations/{{code}}/...)")
                    elif m.group(1) != code:
                        errors.append(f"{kind}.{name} : topic {topic} d'une autre station que {code}")

    return {"valid": not errors, "errors": errors}

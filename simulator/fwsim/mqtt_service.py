# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – back-end & IoT
#  Fichier   : simulator/fwsim/mqtt_service.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03
#  Version   : 1.0
# =============================================================================
"""Client MQTT sur le modèle de ``things/services/mqtt.service.mjs`` du cours :

* ``subscribe(motif, callback, qos, nl)`` : abonnement par MOTIF (``+`` / ``#``) avec une table de
  règles (rôle de ``mqtt-dispatcher``) ; un message est remis à chaque règle dont le motif correspond ;
* ``unsubscribe(motif, callback)`` et ``publish(topic, charge, qos, retain)`` ;
* MQTT v5 (nécessaire pour l'option ``nl`` – *no local*) ;
* reprise automatique (patron Retry : délai exponentiel 1 s -> 30 s) et réabonnement à chaque reconnexion ;
* observateurs ``on("connect" | "disconnect", fonction)`` (patron Observer) ;
* message de dernière volonté (LWT) et TLS (AC privée, TLS 1.2 minimum, 1.3 négocié).
"""
from __future__ import annotations

import json
import logging
import ssl
import threading
from dataclasses import dataclass
from typing import Callable

import paho.mqtt.client as mqtt
from paho.mqtt.subscribeoptions import SubscribeOptions

Callback = Callable[[str, bytes], None]
log = logging.getLogger("fwsim.mqtt")


def topic_matches(pattern: str, topic: str) -> bool:
    """Vrai si ``topic`` correspond au filtre MQTT ``pattern`` (``+`` = un niveau, ``#`` = la suite)."""
    p, t = pattern.split("/"), topic.split("/")
    for i, level in enumerate(p):
        if level == "#":
            return i == len(p) - 1
        if i >= len(t):
            return False
        if level != "+" and level != t[i]:
            return False
    return len(p) == len(t)


@dataclass
class _Rule:
    """Règle du répartiteur : motif, fonction appelée, options d'abonnement."""

    pattern: str
    callback: Callback
    qos: int
    nl: bool


class MqttService:
    """Client MQTT d'une station (une connexion par station, comme un ESP32)."""

    def __init__(self, client_id: str, host: str, port: int, *, username: str = "", password: str = "",
                 tls: bool = False, cafile: str | None = None, insecure: bool = False,
                 will: tuple[str, str, int, bool] | None = None, keepalive: int = 20):
        self.host, self.port, self.keepalive = host, port, keepalive
        self._rules: list[_Rule] = []
        self._listeners: dict[str, list[Callable[[], None]]] = {"connect": [], "disconnect": []}
        self._lock = threading.Lock()
        self.connected = False
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id, protocol=mqtt.MQTTv5)
        if username:
            self.client.username_pw_set(username, password)
        if tls:
            self.client.tls_set_context(self._tls_context(cafile, insecure))
            if insecure:
                self.client.tls_insecure_set(True)
        if will:
            topic, payload, qos, retain = will
            self.client.will_set(topic, payload, qos=qos, retain=retain)
        self.client.reconnect_delay_set(min_delay=1, max_delay=30)  # Retry : délai exponentiel
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

    @staticmethod
    def _tls_context(cafile: str | None, insecure: bool) -> ssl.SSLContext:
        """Contexte TLS client : vérifie le certificat du broker (AC privée FloodWatch)."""
        ctx = ssl.create_default_context(cafile=cafile)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2  # le broker Cloud impose TLS 1.3
        if insecure:
            ctx.check_hostname = False
        return ctx

    # ------------------------------------------------------------------ cycle de vie
    def on(self, event: str, listener: Callable[[], None]) -> None:
        """Ajoute un observateur de connexion (``connect``) ou de déconnexion (``disconnect``)."""
        self._listeners[event].append(listener)

    def start(self) -> None:
        """Connexion asynchrone ; la boucle réseau retente indéfiniment si le broker est absent."""
        self.client.connect_async(self.host, self.port, keepalive=self.keepalive, clean_start=True)
        self.client.loop_start()

    def stop(self, final: tuple[str, str, int, bool] | None = None) -> None:
        """Arrêt propre : publie éventuellement un dernier message (ex. status offline) puis DISCONNECT."""
        if final and self.connected:
            topic, payload, qos, retain = final
            self.client.publish(topic, payload, qos=qos, retain=retain).wait_for_publish(2)
        self.client.disconnect()
        self.client.loop_stop()

    def kill(self) -> None:
        """Simule une panne (coupure brutale, sans DISCONNECT) : le broker publie le LWT."""
        self.client.loop_stop()
        sock = self.client.socket()
        if sock:
            sock.close()
        self.connected = False

    # ------------------------------------------------------------------ API du cours
    def subscribe(self, pattern: str, callback: Callback, qos: int = 0, nl: bool = True) -> None:
        """Abonnement par motif : ``callback(topic, charge)`` est appelé pour chaque message correspondant."""
        with self._lock:
            self._rules.append(_Rule(pattern, callback, qos, nl))
        if self.connected:
            self.client.subscribe(pattern, options=SubscribeOptions(qos=qos, noLocal=nl))

    def unsubscribe(self, pattern: str, callback: Callback | None = None) -> None:
        """Retire les règles du motif (toutes, ou seulement celle de ``callback``)."""
        with self._lock:
            self._rules = [r for r in self._rules
                           if not (r.pattern == pattern and (callback is None or r.callback is callback))]
            still_used = any(r.pattern == pattern for r in self._rules)
        if not still_used and self.connected:
            self.client.unsubscribe(pattern)

    def publish(self, topic: str, payload, qos: int = 0, retain: bool = False) -> bool:
        """Publie une charge (``dict`` -> JSON UTF-8). Renvoie faux si le client n'a pas pu la prendre en charge."""
        if isinstance(payload, (dict, list)):
            payload = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        info = self.client.publish(topic, payload, qos=qos, retain=retain)
        return info.rc == mqtt.MQTT_ERR_SUCCESS

    # ------------------------------------------------------------------ rappels paho
    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            log.warning("connexion refusée par %s:%s (%s)", self.host, self.port, reason_code)
            return
        self.connected = True
        with self._lock:
            rules = list(self._rules)
        for r in rules:  # réabonnement après chaque (re)connexion
            client.subscribe(r.pattern, options=SubscribeOptions(qos=r.qos, noLocal=r.nl))
        for listener in self._listeners["connect"]:
            listener()

    def _on_disconnect(self, client, userdata, flags, reason_code, properties):
        was = self.connected
        self.connected = False
        if was:
            for listener in self._listeners["disconnect"]:
                listener()

    def _on_message(self, client, userdata, msg):
        with self._lock:
            rules = [r for r in self._rules if topic_matches(r.pattern, msg.topic)]
        for r in rules:
            try:
                r.callback(msg.topic, msg.payload)
            except Exception:  # une règle défaillante ne doit pas couper la boucle réseau
                log.exception("erreur dans le traitement de %s", msg.topic)

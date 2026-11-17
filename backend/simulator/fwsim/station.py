# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – back-end & IoT
#  Fichier   : backend/simulator/fwsim/station.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Ksontini Amine
#  Créé le   : 2026-11-02          Modifié le : 2026-11-03
#  Version   : 1.1
# =============================================================================
"""Station virtuelle : même comportement que firmware/src/main.cpp.

* mesure du niveau (modèle « réservoir » + bruit + échos parasites du HC-SR04) et de la pluie ;
* publication MQTT : telemetry, heartbeat (15 s), state (retenu), status online/offline (LWT retenu),
  td (Thing Description retenue, nouveau en 1.1) ;
* exécution des commandes du Cloud (barrière, feu, sirène, période) avec acquittement ;
* configuration retenue (seuils) reçue sur ``…/config`` ;
* RÈGLE DE SÉCURITÉ LOCALE : fermeture autonome au seuil rouge sans attendre le Cloud,
  réouverture seulement après ``reopenDelaySec`` sous le seuil orange ;
* verrou : une commande d'ouverture est refusée au-dessus du seuil rouge.

La partie « décision » (``execute``, ``local_safety_rule``, ``step``) ne dépend pas de MQTT : elle est
testée sans broker (tests/test_station.py).
"""
from __future__ import annotations

import json
import logging
import random
import threading
import time

from . import topics
from .anomaly import AnomalyModel
from .config import SimConfig, StationInfo
from .core import NORMAL, Outputs, SafetyController
from .features import FeatureState
from .topology import LevelHistory
from .mqtt_service import MqttService
from .sensor import Condition, FaultPlan, Reading, SensorPhysics, UltrasonicSensor, summarize
from .scenarios import RainScenario, scenario_for
from .wot import ThingDescriptionFactory

HEARTBEAT_SEC = 15
FIRMWARE = "sim-1.3.0"
log = logging.getLogger("fwsim.station")


class VirtualStation:
    """Station virtuelle (une connexion MQTT par station, comme un ESP32)."""

    def __init__(self, info: StationInfo, cfg: SimConfig, seed: int, scenario: RainScenario | None = None,
                 mqtt_service: MqttService | None = None, fault_plan: FaultPlan | None = None,
                 physics: SensorPhysics | None = None):
        self.info = info
        self.code = info.code
        self.cfg = cfg
        self.rng = random.Random(seed)
        self.scenario = scenario or scenario_for(cfg.scenario)
        # seuils par défaut (écrasés par le topic config retenu publié par le middleware)
        self.thresholds = {"criticalCm": info.critical_cm, "yellowPct": 30.0, "orangePct": 60.0, "redPct": 85.0,
                           "rainThreshold": 0.2, "reopenDelaySec": 60, "sensorHeightCm": info.sensor_height_cm,
                           "periodNormalSec": 30, "periodWatchSec": 5, "heartbeatSec": HEARTBEAT_SEC,
                           "degradedCloseSec": 120}
        self.level = 1.5 + self.rng.random()     # niveau RÉEL (vérité terrain du modèle physique)
        # Capteur simulé écho par écho (fwsim/sensor.py). La station ne connaît le niveau qu'à
        # travers lui : « seen_level » est ce qu'elle croit, « level » ce qui est vrai.
        self.sensor = UltrasonicSensor(self.rng, physics)
        self.faults = fault_plan or (FaultPlan.random(self.rng) if cfg.faults == "random" else FaultPlan.none())
        self.reading: Reading | None = None
        self.seen_level: float | None = None
        # Cœur de décision : jumeau Python de firmware/lib/floodwatch_core (même logique, mêmes
        # entrées) — indicateurs, classifieur embarqué, règle de sécurité et politique dégradée.
        self.features = FeatureState()
        self.model = AnomalyModel.load()
        self.safety = SafetyController(self.thresholds)
        self.suspect = False
        # Fog : historique du niveau réel (lu par les stations aval) et apports amont reçus
        self.history = LevelHistory()
        self.inflows: list = []        # (historique amont, temps de parcours s, gain 1/min)
        self.rain = 0.0
        self.barrier, self.light, self.siren = "OPEN", "GREEN", False
        self.cloud_sampling = "NORMAL"
        self.local_safety = False
        self.sim_t = 0.0
        self.last_tel = -1e9
        self.last_hb = -1e9
        self.last_publish = None
        self.dead = False
        self.lock = threading.Lock()
        self.td = ThingDescriptionFactory(cfg.td_broker_url, FIRMWARE).create(info)
        self.mqtt = mqtt_service or self._make_service()

    # ------------------------------------------------------------------ MQTT
    def _make_service(self) -> MqttService:
        """Fabrique le client MQTT de la station (LWT « offline » retenu sur …/status)."""
        cfg = self.cfg
        svc = MqttService(f"sim-{self.code}-{self.rng.randint(1000, 9999)}", cfg.host, cfg.port,
                          username=cfg.username_for(self.code), password=cfg.password, tls=cfg.tls,
                          cafile=cfg.cafile, insecure=cfg.insecure,
                          will=(topics.station(self.code, "status"), "offline", 1, True))
        svc.subscribe(topics.station(self.code, "cmd"), self._on_cmd, qos=1)
        svc.subscribe(topics.station(self.code, "config"), self._on_config, qos=1)
        svc.on("connect", self._on_connected)
        svc.on("disconnect", lambda: self._log(logging.WARNING, "déconnecté du broker", "disconnect"))
        return svc

    def _log(self, level, msg, event, **extra):
        log.log(level, msg, extra={"station": self.code, "event": event, **extra})

    def start(self):
        self.mqtt.start()

    def stop(self):
        """Arrêt propre : statut « offline » retenu puis déconnexion."""
        self.mqtt.stop(final=(topics.station(self.code, "status"), "offline", 1, True))

    def kill(self):
        """Panne simulée : plus aucun message, le broker publie le LWT."""
        self._log(logging.WARNING, "SIMULATION DE PANNE : la station se tait (plus aucun message)", "kill")
        self.dead = True
        self.mqtt.kill()

    def _on_connected(self):
        """Après chaque (re)connexion : statut, TD et état, tous retenus."""
        self._log(logging.INFO, f"connecté à {self.cfg.host}:{self.cfg.port}", "connect")
        self.mqtt.publish(topics.station(self.code, "status"), "online", qos=1, retain=True)
        if self.cfg.publish_td:
            self.mqtt.publish(topics.station(self.code, "td"), self.td, qos=1, retain=True)
        self.publish_state()

    def _on_config(self, topic: str, payload: bytes):
        """Seuils retenus publiés par le middleware (CommandManager.publishConfig)."""
        try:
            data = json.loads(payload.decode("utf-8"))
        except ValueError:
            return
        with self.lock:
            self.thresholds.update({k: v for k, v in data.items() if k in self.thresholds})
        self._log(logging.INFO, f"configuration reçue : critique {self.thresholds['criticalCm']} cm", "config")

    def _on_cmd(self, topic: str, payload: bytes):
        """Commande du Cloud (ou de la passerelle) : exécution puis acquittement sur …/ack."""
        try:
            data = json.loads(payload.decode("utf-8"))
        except ValueError:
            return
        with self.lock:
            ok, detail = self.execute(data.get("actuator"), str(data.get("value", "")).upper())
        ack = {"id": data.get("id"), "ok": ok}
        if detail:
            ack["detail"] = detail
        self.mqtt.publish(topics.station(self.code, "ack"), ack, qos=1)
        self.publish_state()

    # ------------------------------------------------------------------ actionneurs
    def execute(self, actuator, value):
        """Exécute une commande. Verrou de sécurité : refus d'ouvrir au-dessus du seuil rouge."""
        if actuator == "barrier":
            if value == "OPEN" and self.pct() >= self.thresholds["redPct"]:
                return False, "verrouillage sécurité : niveau au-dessus du seuil rouge"
            self.barrier = "CLOSED" if value in ("CLOSE", "CLOSED") else "OPEN"
            if self.barrier == "OPEN":
                self.local_safety = False
                self.safety.release_by_command()
        elif actuator == "light":
            if value not in ("GREEN", "ORANGE", "RED", "OFF"):
                return False, "couleur inconnue"
            self.light = value
        elif actuator == "siren":
            self.siren = value in ("ON", "TRUE", "1")
        elif actuator == "sampling":
            if value not in ("NORMAL", "WATCH"):
                return False, "mode inconnu"
            self.cloud_sampling = value
        else:
            return False, f"actionneur inconnu : {actuator}"
        self._log(logging.INFO, f"commande {actuator}={value} exécutée", "cmd")
        return True, None

    def believed_level(self):
        """Niveau que la station croit : sa dernière lecture VALIDE, comme le firmware.

        Le firmware ne met ``levelCm`` à jour que si la lecture est retenue ; une lecture rejetée
        laisse donc l'ancienne valeur en place. Avant toute lecture, c'est le niveau réel.
        """
        return self.level if self.seen_level is None else self.seen_level

    def pct(self):
        """Niveau en % du niveau critique, tel que la station le perçoit."""
        return 100.0 * self.believed_level() / self.thresholds["criticalCm"]

    def true_pct(self):
        """Niveau RÉEL en % du niveau critique (vérité terrain, inconnue de la station)."""
        return 100.0 * self.level / self.thresholds["criticalCm"]

    def read_sensor(self) -> Reading:
        """Lit le capteur simulé et retient ce que le firmware en retiendrait (``measure()``)."""
        height = self.thresholds["sensorHeightCm"]
        if self.scenario.sensor_fault(self.sim_t):   # panne franche du scénario : plus aucun écho
            reading = summarize([], height, Condition.DROPOUT)
        else:
            reading = self.sensor.read(self.level, height, self.sim_t, self.faults.at(self.sim_t))
        self.reading = reading
        if reading.sensor_ok:
            self.seen_level = reading.level_cm
        # indicateurs et classifieur embarqué (temps physique, comme millis() sur l'ESP32)
        x = self.features.update(self.sim_t, reading.sensor_ok, reading.level_cm, reading.echo_ok,
                                 reading.echo_spread_cm, self.rain)
        self.suspect = bool(x is not None and self.model is not None and self.model.suspect(x))
        return reading

    def effective_sampling(self):
        """WATCH (5 s) si pluie, niveau >= jaune ou demande du Cloud ; sinon NORMAL (30 s)."""
        local_watch = self.rain >= self.thresholds["rainThreshold"] or self.pct() >= self.thresholds["yellowPct"]
        return "WATCH" if (local_watch or self.cloud_sampling == "WATCH") else "NORMAL"

    def local_safety_rule(self, now):
        """Règle de sécurité locale et politique de capteur dégradé (jumeau de ``SafetyController``).

        Appliquée à la dernière lecture : valide (ou aucune lecture encore), elle porte sur le niveau
        perçu ; invalide, elle déclenche la politique dégradée.

        :return: vrai si l'état des actionneurs a changé
        """
        ok = self.reading is None or self.reading.sensor_ok
        self.safety.thresholds = self.thresholds
        out = Outputs(self.barrier == "CLOSED", self.light, self.siren)
        mode_before = self.safety.mode
        changed = self.safety.step(now, ok, self.believed_level(), self.rain, self.suspect and ok, out)
        self.barrier = "CLOSED" if out.barrier_closed else "OPEN"
        self.light, self.siren = out.light, out.siren
        self.local_safety = self.safety.mode != NORMAL
        if self.safety.mode != mode_before:
            if self.safety.mode == "LOCAL_SAFETY":
                self._log(logging.WARNING, f"SÉCURITÉ LOCALE : niveau {self.pct():.0f} % -> barrière fermée",
                          "local_safety", pct=round(self.pct(), 1))
            elif self.safety.mode == "DEGRADED":
                self._log(logging.WARNING, "CAPTEUR AVEUGLE sous la pluie : fermeture de précaution",
                          "degraded")
            else:
                self._log(logging.INFO, "sécurité locale levée : réouverture", "local_safety_end")
        return changed

    # ------------------------------------------------------------------ physique
    def step(self, dt_sim):
        """Modèle réservoir : dL/dt = a·pluie(t − retard) − b·L + Σ g·L_amont(t − τ) (cm/min)."""
        self.sim_t += dt_sim
        self.rain = self.scenario.rain(max(0.0, self.sim_t - self.info.rain_lag_s))
        dmin = dt_sim / 60.0
        upstream = sum(g * h.at(self.sim_t - travel) for h, travel, g in self.inflows)
        self.level += (self.scenario.inflow * self.rain - self.scenario.drain * self.level + upstream) * dmin
        self.level = max(0.0, min(self.level, self.thresholds["sensorHeightCm"] - 2))
        self.history.add(self.sim_t, self.level)

    # ------------------------------------------------------------------ boucle
    def tick(self, now):
        """Un pas de la boucle principale (appelé toutes les 250 ms)."""
        if self.dead:
            return
        safety_changed = False
        with self.lock:
            th = self.thresholds
            period = (th["periodWatchSec"] if self.effective_sampling() == "WATCH" else th["periodNormalSec"])
            period /= self.cfg.speed
            telemetry = None
            if now - self.last_tel >= period:
                self.last_tel = now
                reading = self.read_sensor()
                safety_changed = self.local_safety_rule(now)   # toujours, connecté ou non
                # Mêmes champs que le firmware. La vérité terrain (niveau réel, condition du
                # capteur) n'est JAMAIS publiée : une station réelle ne la connaît pas.
                telemetry = {"levelCm": round(reading.level_cm, 2) if reading.sensor_ok else -1,
                             "rain": round(self.rain, 2), "sensorOk": reading.sensor_ok,
                             "echoOk": reading.echo_ok, "echoSpreadCm": round(reading.echo_spread_cm, 2),
                             "suspect": self.suspect, "seq": int(now)}
        if safety_changed:
            self.publish_state()
        if telemetry:
            topic = topics.raw_telemetry(self.code) if self.cfg.raw else topics.station(self.code, "telemetry")
            if self.mqtt.publish(topic, telemetry, qos=1):
                self.last_publish = time.time()
            self._log(logging.DEBUG, f"niveau {telemetry['levelCm']:5.2f} cm ({self.pct():3.0f} %) pluie "
                      f"{self.rain:.2f} barrière {self.barrier} feu {self.light}", "telemetry",
                      levelCm=telemetry["levelCm"], pct=round(self.pct(), 1))
        if now - self.last_hb >= self.thresholds.get("heartbeatSec", HEARTBEAT_SEC):
            self.last_hb = now
            hb = {"uptime": int(self.sim_t), "rssi": -55 - self.rng.randint(0, 20), "fw": FIRMWARE, "heap": 180000}
            self.mqtt.publish(topics.station(self.code, "heartbeat"), hb, qos=0)

    def publish_state(self):
        """État des actionneurs, retenu (lu par le middleware et par l'événement floodAlert de la TD)."""
        with self.lock:
            state = {"barrier": self.barrier, "light": self.light, "siren": self.siren,
                     "sampling": self.effective_sampling(), "localSafety": self.local_safety,
                     "mode": self.safety.mode}
        self.mqtt.publish(topics.station(self.code, "state"), state, qos=1, retain=True)

    def health(self) -> dict:
        """État de santé de la station pour GET /health."""
        return {"connected": self.mqtt.connected, "dead": self.dead, "levelCm": round(self.level, 2),
                "barrier": self.barrier, "localSafety": self.local_safety, "mode": self.safety.mode,
                "lastPublishAgoSec": None if self.last_publish is None else round(time.time() - self.last_publish, 1)}

#!/usr/bin/env python3
# =============================================================================
#  Module   : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Fichier  : simulator/floodwatch_sim.py
#  Rôle     : simulateur de stations FloodWatch (remplace les ESP32 pour les démos)
#  Équipe   : FloodWatch – Auteur : Ksontini Amine
#  Version  : 1.0 – 2026-11-02
# =============================================================================
"""Simulateur de stations FloodWatch.

Chaque station virtuelle reproduit le comportement du firmware ESP32 :
  * mesure du niveau (modèle hydrologique « réservoir » + bruit + échos parasites) et de la pluie ;
  * publication MQTT : telemetry, heartbeat (15 s), state (retenu), status online/offline (LWT) ;
  * exécution des commandes cloud (barrière, feu, sirène, période) avec acquittement ;
  * application de la configuration retenue (seuils) ;
  * RÈGLE DE SÉCURITÉ LOCALE : fermeture autonome au seuil rouge, sans attendre le Cloud,
    réouverture seulement après retour sous le seuil orange pendant la temporisation.

Exemples :
  python3 floodwatch_sim.py --host localhost --port 1883 --username gateway --password gateway
  python3 floodwatch_sim.py --host floodwatch.example.tn --port 8883 --tls --cafile ca.crt ...
  python3 floodwatch_sim.py --scenario flash --speed 2 --offline-after 120 --stations wadi-01
"""
import argparse
import json
import math
import random
import ssl
import sys
import threading
import time

import paho.mqtt.client as mqtt

ROOT = "floodwatch/stations"
HEARTBEAT_SEC = 15


# --------------------------------------------------------------------------- scénarios de pluie
def rain_profile(scenario, t):
    """Intensité de pluie normalisée (0..1) à l'instant t (secondes simulées)."""
    if scenario == "calm":
        return 0.0
    if scenario == "flash":  # orage soudain et violent
        return 1.0 if 20 <= t < 240 else 0.0
    if scenario == "drizzle":  # pluie faible : jaune seulement
        return 0.35 if t >= 20 else 0.0
    if scenario == "fault":
        return 0.3 if t >= 20 else 0.0
    # storm (défaut) : montée progressive, plateau, arrêt
    if t < 30:
        return 0.0
    if t < 90:
        return 0.9 * (t - 30) / 60.0
    if t < 330:
        return 0.9
    return 0.0


class VirtualStation:
    """Station virtuelle (même logique que firmware/src/main.cpp)."""

    def __init__(self, code, args, seed):
        self.code = code
        self.args = args
        self.rng = random.Random(seed)
        # configuration (écrasée par le topic config retenu)
        self.cfg = {"criticalCm": 20.0, "yellowPct": 30.0, "orangePct": 60.0, "redPct": 85.0,
                    "rainThreshold": 0.2, "reopenDelaySec": 60, "sensorHeightCm": 30.0,
                    "periodNormalSec": 30, "periodWatchSec": 5, "heartbeatSec": HEARTBEAT_SEC}
        self.level = 1.5 + self.rng.random()
        self.rain = 0.0
        self.barrier, self.light, self.siren = "OPEN", "GREEN", False
        self.cloud_sampling = "NORMAL"
        self.local_safety = False
        self.below_orange_since = None
        self.sim_t = 0.0
        self.last_tel = -1e9
        self.last_hb = -1e9
        self.dead = False
        self.lock = threading.Lock()
        self.client = self._make_client()

    # ------------------------------------------------------------------ MQTT
    def _make_client(self):
        cid = f"sim-{self.code}-{self.rng.randint(1000, 9999)}"
        if hasattr(mqtt, "CallbackAPIVersion"):
            c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id=cid, clean_session=True)
        else:
            c = mqtt.Client(client_id=cid, clean_session=True)
        if self.args.username:
            c.username_pw_set(self.args.username, self.args.password)
        if self.args.tls:
            c.tls_set(ca_certs=self.args.cafile, cert_reqs=ssl.CERT_REQUIRED, tls_version=ssl.PROTOCOL_TLS_CLIENT)
            if self.args.insecure:
                c.tls_insecure_set(True)
        c.will_set(f"{ROOT}/{self.code}/status", "offline", qos=1, retain=True)
        c.on_connect = self._on_connect
        c.on_message = self._on_message
        c.on_disconnect = lambda *a: log(self.code, "déconnecté du broker")
        return c

    def start(self):
        self.client.connect_async(self.args.host, self.args.port, keepalive=20)
        self.client.loop_start()

    def stop(self, clean=True):
        if clean:
            self.client.publish(f"{ROOT}/{self.code}/status", "offline", qos=1, retain=True).wait_for_publish(2)
            self.client.disconnect()
        self.client.loop_stop()

    def _on_connect(self, client, userdata, flags, rc):
        if rc != 0:
            log(self.code, f"connexion refusée (rc={rc})")
            return
        log(self.code, "connecté au broker")
        client.subscribe([(f"{ROOT}/{self.code}/cmd", 1), (f"{ROOT}/{self.code}/config", 1)])
        client.publish(f"{ROOT}/{self.code}/status", "online", qos=1, retain=True)
        self.publish_state()

    def _on_message(self, client, userdata, msg):
        try:
            data = json.loads(msg.payload.decode("utf-8"))
        except ValueError:
            return
        with self.lock:
            if msg.topic.endswith("/config"):
                self.cfg.update({k: v for k, v in data.items() if k in self.cfg})
                log(self.code, f"configuration reçue : critique {self.cfg['criticalCm']} cm")
                return
            ok, detail = self.execute(data.get("actuator"), str(data.get("value", "")).upper())
        ack = {"id": data.get("id"), "ok": ok}
        if detail:
            ack["detail"] = detail
        client.publish(f"{ROOT}/{self.code}/ack", json.dumps(ack), qos=1)
        self.publish_state()

    # ------------------------------------------------------------------ actionneurs
    def execute(self, actuator, value):
        """Exécute une commande cloud. Verrou de sécurité : refus d'ouvrir au-dessus du seuil rouge."""
        if actuator == "barrier":
            if value == "OPEN" and self.pct() >= self.cfg["redPct"]:
                return False, "verrouillage sécurité : niveau au-dessus du seuil rouge"
            self.barrier = "CLOSED" if value in ("CLOSE", "CLOSED") else "OPEN"
            if self.barrier == "OPEN":
                self.local_safety = False
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
        log(self.code, f"commande {actuator}={value} exécutée")
        return True, None

    def pct(self):
        return 100.0 * self.level / self.cfg["criticalCm"]

    def effective_sampling(self):
        local_watch = self.rain >= self.cfg["rainThreshold"] or self.pct() >= self.cfg["yellowPct"]
        return "WATCH" if (local_watch or self.cloud_sampling == "WATCH") else "NORMAL"

    def local_safety_rule(self, now):
        """Fermeture autonome au seuil rouge (indépendante du Cloud) et réouverture temporisée."""
        changed = False
        pct = self.pct()
        if pct >= self.cfg["redPct"]:
            self.below_orange_since = None
            if self.barrier != "CLOSED" or not self.siren or self.light != "RED":
                self.barrier, self.light, self.siren = "CLOSED", "RED", True
                if not self.local_safety:
                    log(self.code, f"SÉCURITÉ LOCALE : niveau {pct:.0f} % -> barrière fermée")
                self.local_safety = True
                changed = True
        elif self.local_safety:
            if pct < self.cfg["orangePct"]:
                if self.below_orange_since is None:
                    self.below_orange_since = now
                elif now - self.below_orange_since >= self.cfg["reopenDelaySec"]:
                    self.local_safety = False
                    self.barrier, self.siren = "OPEN", False
                    self.light = "GREEN" if pct < self.cfg["yellowPct"] else "ORANGE"
                    log(self.code, "sécurité locale levée : réouverture")
                    changed = True
            else:
                self.below_orange_since = None
        return changed

    # ------------------------------------------------------------------ physique
    def step(self, dt_sim):
        """Modèle réservoir : dL/dt = a*pluie - b*L (cm/min)."""
        self.sim_t += dt_sim
        self.rain = rain_profile(self.args.scenario, self.sim_t)
        a, b = (10.0, 0.3) if self.args.scenario == "flash" else (8.0, 0.3)
        dmin = dt_sim / 60.0
        self.level += (a * self.rain - b * self.level) * dmin
        self.level = max(0.0, min(self.level, self.cfg["sensorHeightCm"] - 2))

    def measured_level(self):
        noise = self.rng.gauss(0, 0.15)
        if self.rng.random() < 0.03:  # écho parasite du HC-SR04
            noise += self.rng.choice([-1, 1]) * self.rng.uniform(3, 6)
        return max(0.0, self.level + noise)

    # ------------------------------------------------------------------ boucle
    def tick(self, now):
        if self.dead:
            return
        with self.lock:
            safety_changed = self.local_safety_rule(now)
            period = self.cfg["periodWatchSec"] if self.effective_sampling() == "WATCH" else self.cfg["periodNormalSec"]
            period /= self.args.speed
            telemetry = None
            if now - self.last_tel >= period:
                self.last_tel = now
                fault = self.args.scenario == "fault" and self.sim_t > 60
                telemetry = {"levelCm": round(self.measured_level(), 2) if not fault else 999.0,
                             "rain": round(self.rain, 2), "sensorOk": not fault,
                             "distanceCm": round(self.cfg["sensorHeightCm"] - self.level, 1),
                             "seq": int(now)}
        if safety_changed:
            self.publish_state()
        if telemetry:
            topic = f"fw/raw/{self.code}/telemetry" if self.args.raw else f"{ROOT}/{self.code}/telemetry"
            self.client.publish(topic, json.dumps(telemetry), qos=1)
            if self.args.verbose:
                log(self.code, f"niveau {telemetry['levelCm']:5.2f} cm ({self.pct():3.0f} %) pluie {self.rain:.2f} "
                               f"barrière {self.barrier} feu {self.light}")
        if now - self.last_hb >= self.cfg.get("heartbeatSec", HEARTBEAT_SEC):
            self.last_hb = now
            hb = {"uptime": int(self.sim_t), "rssi": -55 - self.rng.randint(0, 20), "fw": "sim-1.0.0",
                  "heap": 180000}
            self.client.publish(f"{ROOT}/{self.code}/heartbeat", json.dumps(hb), qos=0)

    def publish_state(self):
        with self.lock:
            state = {"barrier": self.barrier, "light": self.light, "siren": self.siren,
                     "sampling": self.effective_sampling(), "localSafety": self.local_safety}
        self.client.publish(f"{ROOT}/{self.code}/state", json.dumps(state), qos=1, retain=True)


def log(code, msg):
    print(f"{time.strftime('%H:%M:%S')} [{code}] {msg}", flush=True)


def main():
    p = argparse.ArgumentParser(description="Simulateur de stations FloodWatch")
    p.add_argument("--host", default="localhost")
    p.add_argument("--port", type=int, default=1883)
    p.add_argument("--username", default="")
    p.add_argument("--password", default="")
    p.add_argument("--tls", action="store_true", help="MQTT sur TLS (port 8883)")
    p.add_argument("--cafile", default=None, help="certificat de l'AC du broker")
    p.add_argument("--insecure", action="store_true", help="ne pas vérifier le nom d'hôte du certificat")
    p.add_argument("--stations", default="underpass-01,wadi-01")
    p.add_argument("--scenario", default="storm", choices=["storm", "flash", "drizzle", "calm", "fault"])
    p.add_argument("--speed", type=float, default=1.0, help="accélération du temps simulé")
    p.add_argument("--raw", action="store_true", help="publier la télémétrie brute vers la passerelle Node-RED (fw/raw/...)")
    p.add_argument("--offline-after", type=float, default=0, help="la 1re station se tait après N s (démo station muette)")
    p.add_argument("--duration", type=float, default=0, help="arrêt après N s (0 = infini)")
    p.add_argument("--verbose", "-v", action="store_true")
    args = p.parse_args()

    stations = [VirtualStation(code.strip(), args, i) for i, code in enumerate(args.stations.split(",")) if code.strip()]
    for s in stations:
        s.start()
    log("sim", f"{len(stations)} station(s), scénario « {args.scenario} », vitesse x{args.speed}")
    start = time.monotonic()
    last = start
    try:
        while True:
            time.sleep(0.25)
            now = time.monotonic()
            dt = now - last
            last = now
            for s in stations:
                if not s.dead:
                    s.step(dt * args.speed)
                    s.tick(now)
            if args.offline_after and now - start > args.offline_after and not stations[0].dead:
                log(stations[0].code, "SIMULATION DE PANNE : la station se tait (plus aucun message)")
                stations[0].dead = True
                stations[0].client.loop_stop()
                stations[0].client.socket().close() if stations[0].client.socket() else None
            if args.duration and now - start > args.duration:
                break
    except KeyboardInterrupt:
        pass
    for s in stations:
        if not s.dead:
            s.stop()
    log("sim", "arrêt")


if __name__ == "__main__":
    sys.exit(main())

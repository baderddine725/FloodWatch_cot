#!/usr/bin/env python3
# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – back-end & IoT
#  Fichier   : simulator/floodwatch_sim.py
#  Rôle      : point d'entrée du simulateur de stations (remplace les ESP32 pour les démos)
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Ksontini Amine
#  Créé le   : 2026-11-02          Modifié le : 2026-11-03
#  Version   : 1.1
# =============================================================================
"""Simulateur de stations FloodWatch.

Version 1.1 : code découpé en couches (paquet ``fwsim``), configuration validée au démarrage,
publication de la Thing Description W3C WoT (retenue) sur ``floodwatch/stations/{code}/td``,
journaux structurés, contrôle de santé HTTP. Les options de la version 1.0 sont inchangées.

Exemples :
  python floodwatch_sim.py --host localhost --port 8883 --tls --cafile ../deploy/certs/ca.crt \\
         --username gateway --scenario storm --speed 3 -v          (mot de passe : variable SIM_PASSWORD)
  python floodwatch_sim.py --host localhost --username "{code}" --raw    (broker local + Node-RED)
  python floodwatch_sim.py --scenario flash --speed 2 --offline-after 120 --stations wadi-01
"""
import logging
import sys
import time

from fwsim.config import ConfigError, load_config
from fwsim.health import start_health_server
from fwsim.logs import setup_logging
from fwsim.station import VirtualStation

log = logging.getLogger("fwsim")


def main(argv=None) -> int:
    """Charge la configuration, démarre les stations et fait tourner la boucle de simulation."""
    try:
        cfg = load_config(argv)
    except ConfigError as exc:
        print(f"[fwsim] {exc}", file=sys.stderr)
        return 2
    setup_logging(cfg.log_format, cfg.verbose)

    stations = [VirtualStation(info, cfg, seed=i) for i, info in enumerate(cfg.stations)]
    for s in stations:
        s.start()
    if cfg.health_port:
        def health():
            alive = [s for s in stations if not s.dead]
            up = all(s.mqtt.connected for s in alive)
            return {"status": "UP" if up else "DOWN", "broker": f"{cfg.host}:{cfg.port}",
                    "stations": {s.code: s.health() for s in stations}}
        start_health_server(cfg.health_port, health)
    log.info("%d station(s) [%s], scénario « %s », vitesse x%s, broker %s:%s%s", len(stations),
             ", ".join(s.code for s in stations), cfg.scenario, cfg.speed, cfg.host, cfg.port,
             " (TLS)" if cfg.tls else "", extra={"station": "sim", "event": "start"})

    start = last = time.monotonic()
    try:
        while True:
            time.sleep(0.25)
            now = time.monotonic()
            dt, last = now - last, now
            for s in stations:
                if not s.dead:
                    s.step(dt * cfg.speed)
                    s.tick(now)
            if cfg.offline_after and now - start > cfg.offline_after and not stations[0].dead:
                stations[0].kill()
            if cfg.duration and now - start > cfg.duration:
                break
    except KeyboardInterrupt:
        pass
    for s in stations:
        if not s.dead:
            s.stop()
    log.info("arrêt", extra={"station": "sim", "event": "stop"})
    return 0


if __name__ == "__main__":
    sys.exit(main())

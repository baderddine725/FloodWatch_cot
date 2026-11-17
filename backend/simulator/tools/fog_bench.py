#!/usr/bin/env python3
# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – banc d'essai du fog (passerelle)
#  Fichier   : backend/simulator/tools/fog_bench.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Guesmi Baderddine
#  Créé le   : 2026-11-17          Modifié le : 2026-11-17
#  Version   : 1.0
# =============================================================================
"""Évalue l'intelligence de la passerelle sur une zone simulée de trois stations couplées.

Les stations du registre (``backend/gateway/stations.json``) sont simulées avec leur couplage
hydrologique et une réponse propre à chaque site ; leur télémétrie brute est rejouée dans les VRAIES
fonctions Node-RED (``backend/gateway/node-red/tools/replay.mjs``). On mesure :

* **l'avance gagnée** : pour chaque montée de crue d'une station aval (niveau RÉEL franchissant
  l'orange), l'écart entre la pré-alerte de propagation et le moment où la station se serait mise
  d'elle-même en surveillance (son niveau mesuré franchissant le jaune) ;
* **les fausses pré-alertes** : pré-alertes non suivies d'une crue aval dans le temps de parcours
  + 20 min ;
* **la calibration** : coefficients ``a``, ``b``, ``g`` estimés par la passerelle contre les vrais.

Usage (depuis backend/simulator/) ::

    python tools/fog_bench.py --hours 24 --seed 1                      # orages sur toute la zone
    python tools/fog_bench.py --hours 24 --seed 1 --pattern upstream   # orages sur le bassin amont
"""
from __future__ import annotations

import argparse
import json
import random
import statistics
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from fwsim.config import DEFAULT_STATIONS_FILE, SimConfig, load_registry  # noqa: E402
from fwsim.sensor import FaultPlan  # noqa: E402
from fwsim.station import VirtualStation  # noqa: E402
from fwsim.topology import couple  # noqa: E402
from sensor_bench import CyclingScenario, _NoMqtt  # noqa: E402

REPLAY = HERE.parents[1] / "gateway" / "node-red" / "tools" / "replay.mjs"
STEP_S = 0.5
READ_S = 5.0
#: réponse propre à chaque site (a : cm/min par unité de pluie, b : vidange 1/min) — vérité terrain
SITES = {"upstream-01": (8.0, 0.30), "wadi-01": (6.0, 0.25), "underpass-01": (9.0, 0.40)}
#: répartition de la pluie entre les sites : orage sur toute la zone, ou orage sur le bassin amont
PATTERNS = {"zone": {"upstream-01": 1.0, "wadi-01": 1.0, "underpass-01": 1.0},
            "upstream": {"upstream-01": 1.0, "wadi-01": 0.3, "underpass-01": 0.15}}


class SiteScenario(CyclingScenario):
    """Pluie commune à la zone (mêmes orages), réponse hydrologique FIXE propre au site."""

    def __init__(self, seed: int, inflow: float, drain: float, rain_scale: float = 1.0):
        super().__init__(random.Random(seed))
        self.site = (inflow, drain)
        self.rain_scale = rain_scale

    def rain(self, t: float) -> float:
        r = super().rain(t)
        self.inflow, self.drain = self.site
        return r * self.rain_scale


def simulate(seed: int, hours: float, stations_file: Path = DEFAULT_STATIONS_FILE, pattern: str = "zone"):
    registry = load_registry(stations_file)
    infos = [registry[c] for c in SITES]
    cfg = SimConfig(stations=tuple(infos)).validate()
    stations = [VirtualStation(info, cfg, seed + i,
                               scenario=SiteScenario(seed, *SITES[info.code], PATTERNS[pattern][info.code]),
                               mqtt_service=_NoMqtt(), fault_plan=FaultPlan.none())
                for i, info in enumerate(infos)]
    links = couple(stations)
    messages, truth = [], {s.code: [] for s in stations}
    per_read = round(READ_S / STEP_S)
    for step in range(1, int(hours * 3600 / STEP_S) + 1):
        for s in stations:
            s.step(STEP_S)
        if step % per_read:
            continue
        for s in stations:
            r = s.read_sensor()
            t_ms = int(round(s.sim_t * 1000))
            truth[s.code].append((s.sim_t, s.level, s.pct()))
            messages.append({"t": t_ms, "code": s.code, "payload": {
                "levelCm": round(r.level_cm, 2) if r.sensor_ok else -1, "rain": round(s.rain, 2),
                "sensorOk": r.sensor_ok, "echoOk": r.echo_ok, "echoSpreadCm": round(r.echo_spread_cm, 2),
                "seq": step}})
    return stations, links, messages, truth


def replay(messages: list[dict]) -> list[dict]:
    text = "".join(json.dumps(m) + "\n" for m in messages)
    out = subprocess.run(["node", str(REPLAY)], input=text, capture_output=True, text=True, check=True).stdout
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def onsets(series, critical_cm=20.0, orange=60.0, yellow=30.0):
    """Instants où le niveau RÉEL franchit l'orange en montant (réarmement sous le jaune)."""
    out, armed = [], True
    for t, level, _ in series:
        pct = 100 * level / critical_cm
        if armed and pct >= orange:
            out.append(t)
            armed = False
        elif pct < yellow:
            armed = True
    return out


def in_force(alerts, ends, code, onset):
    """Instant de la pré-alerte EN VIGUEUR à l'arrivée de la crue (émise, pas encore levée), ou None.

    Seule la dernière pré-alerte émise avant la crue compte, et seulement si aucun « propagation_end »
    du même lien ne l'a levée entre-temps : une alerte d'un épisode précédent ne donne pas d'avance.
    """
    before = [a for a in alerts if a["payload"]["to"] == code and a["t"] / 1000 <= onset]
    if not before:
        return None
    last = max(before, key=lambda a: a["t"])
    a_t, src = last["t"] / 1000, last["payload"]["from"]
    lifted = any(e["payload"]["to"] == code and e["payload"]["from"] == src and a_t < e["t"] / 1000 <= onset
                 for e in ends)
    return None if lifted else a_t


def evaluate(stations, links, truth, events) -> dict:
    """Avance gagnée et fausses pré-alertes pour chaque station aval.

    * Avance « seule » : depuis le DÉBUT de la montée en cours (dernier franchissement du jaune par le
      niveau perçu avant la crue), moment où la station se met d'elle-même en surveillance.
    * Avance « avec fog » : depuis la plus précoce de ce moment et de la pré-alerte de propagation EN
      VIGUEUR à l'arrivée de la crue (voir :func:`in_force`).
    * Une pré-alerte est fondée si la station aval atteint l'orange (niveau RÉEL) dans le temps de
      parcours + 20 min, même si elle était déjà en crue.
    """
    alerts = [e for e in events if e["payload"].get("type") == "propagation_alert"]
    ends = [e for e in events if e["payload"].get("type") == "propagation_end"]
    targets = {link.downstream: link for link in links}
    result = {"links": [f"{l.upstream} -> {l.downstream} ({l.travel_s:.0f} s)" for l in links], "stations": {}}
    for code, link in targets.items():
        series = truth[code]
        times = [t for t, _, _ in series]
        lead_own, lead_fog, earlier = [], [], 0
        floods = onsets(series)
        for onset in floods:
            k = times.index(onset)
            j = k
            while j > 0 and series[j - 1][2] >= 30 and onset - series[j - 1][0] <= 3600:
                j -= 1
            own_t = series[j][0]
            fog_t = in_force(alerts, ends, code, onset)
            first = own_t if fog_t is None else min(own_t, fog_t)
            lead_own.append((onset - own_t) / 60)
            lead_fog.append((onset - first) / 60)
            earlier += fog_t is not None and fog_t < own_t
        mine = [a for a in alerts if a["payload"]["to"] == code]
        horizon = link.travel_s + 1200
        flooded = [t for t, level, _ in series if 100 * level / 20.0 >= 60]
        false = sum(1 for a in mine if not any(a["t"] / 1000 <= t <= a["t"] / 1000 + horizon for t in flooded))
        result["stations"][code] = {
            "floods": len(floods), "alerts": len(mine), "false_alerts": false, "fog_earlier": earlier,
            "lead_own_min": round(statistics.median(lead_own), 1) if lead_own else None,
            "lead_with_fog_min": round(statistics.median(lead_fog), 1) if lead_fog else None,
            "lead_gain_mean_min": round(statistics.mean(f - o for f, o in zip(lead_fog, lead_own)), 1) if lead_own else None,
        }
    calib = {}
    for e in events:
        p = e["payload"]
        if p.get("type") == "calibration":
            calib[p["station"]] = p
    true_g = {link.downstream: link.gain_per_min for link in links}
    result["calibration"] = {code: {"true": {"a": SITES[code][0], "b": SITES[code][1], "g": true_g.get(code)},
                                    "estimated": {k: calib[code].get(k) for k in ("a", "b", "g", "r2", "n")}}
                             for code in SITES if code in calib}
    return result


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Banc d'essai du fog : propagation et calibration de la passerelle")
    p.add_argument("--hours", type=float, default=12.0)
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--pattern", choices=sorted(PATTERNS), default="zone",
                   help="zone : orages sur toute la zone ; upstream : orages sur le bassin amont")
    p.add_argument("--json", action="store_true", help="résultat en JSON")
    a = p.parse_args(argv)
    stations, links, messages, truth = simulate(a.seed, a.hours, pattern=a.pattern)
    events = replay(messages)
    r = evaluate(stations, links, truth, events)
    if a.json:
        print(json.dumps(r, indent=2, ensure_ascii=False))
        return 0
    print("liens : " + " ; ".join(r["links"]))
    print(f"{'station aval':<14} {'crues':>6} {'pré-alertes':>12} {'infondées':>10} {'fog plus tôt':>13} "
          f"{'avance seule':>13} {'avance + fog':>13} {'gain moyen':>11}")
    for code, s in r["stations"].items():
        print(f"{code:<14} {s['floods']:>6} {s['alerts']:>12} {s['false_alerts']:>10} {s['fog_earlier']:>13} "
              f"{str(s['lead_own_min']) + ' min':>13} {str(s['lead_with_fog_min']) + ' min':>13} "
              f"{str(s['lead_gain_mean_min']) + ' min':>11}")
    print("\ncalibration (vrai -> estimé par la passerelle) :")
    for code, c in r["calibration"].items():
        t, e = c["true"], c["estimated"]
        g = f", g {t['g']} -> {e['g']}" if t["g"] is not None else ""
        print(f"  {code:<14} a {t['a']} -> {e['a']}, b {t['b']} -> {e['b']}{g}  (R² {e['r2']}, {e['n']} équations)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

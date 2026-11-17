#!/usr/bin/env python3
# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – banc de mesure du capteur
#  Fichier   : backend/simulator/tools/sensor_bench.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Guesmi Baderddine
#  Créé le   : 2026-11-17          Modifié le : 2026-11-17
#  Version   : 1.0
# =============================================================================
"""Banc de mesure simulé du capteur de niveau.

Fait tourner une station virtuelle (même physique, même capteur simulé que le simulateur en
service) pendant des heures de temps simulé, avec des épisodes de défaut aléatoires, et produit :

* un jeu de lectures **étiquetées** (CSV) : chaque ligne porte ce que la station a mesuré ET la
  vérité terrain (niveau réel, condition du capteur) ;
* le bilan d'une **règle simple** sur ces lectures : c'est la référence qu'un classifieur
  embarqué devra battre pour mériter sa place.

Étiquette ``quality`` de chaque lecture :

* ``REJECTED`` – le firmware l'écarte déjà de lui-même (moins de 3 échos, hors plage) ;
* ``BAD``      – retenue par le firmware mais fausse de plus de 2 cm : **le cas dangereux** ;
* ``DEGRADED`` – capteur perturbé, valeur encore juste ;
* ``GOOD``     – capteur sain, valeur juste.

Usage (depuis backend/simulator/) ::

    python tools/sensor_bench.py --hours 24 --seed 1                  # bilan seul
    python tools/sensor_bench.py --hours 24 --out ../../ml/datasets/sensor_bench.csv
    python tools/sensor_bench.py --hours 24 --profile shifted         # autres hypothèses de capteur

Tout est reproductible : même graine, mêmes lectures.
"""
from __future__ import annotations

import argparse
import csv
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from fwsim.config import BUILTIN_STATIONS, SimConfig  # noqa: E402
from fwsim.scenarios import RainScenario, scenario_for  # noqa: E402
from fwsim.sensor import BURST, Condition, FaultPlan, Reading, SensorPhysics  # noqa: E402
from fwsim.station import VirtualStation  # noqa: E402

#: écart au-delà duquel une lecture retenue est considérée comme fausse (10 % du niveau critique)
BAD_ERROR_CM = 2.0
#: pas du modèle physique et cadence de lecture (surveillance renforcée du firmware)
STEP_S = 0.5
READ_PERIOD_S = 5.0

COLUMNS = ("t_s", "station", "scenario", "rain", "true_level_cm", "condition", "quality", "sensor_ok",
           "level_cm", "error_cm", "echo_ok", "echo_spread_cm") + tuple(f"e{i}" for i in range(1, BURST + 1))


class _NoMqtt:
    """La station du banc ne publie rien : seules sa physique et ses lectures servent."""

    connected = True

    def publish(self, *args, **kwargs):
        return True


class CyclingScenario(RainScenario):
    """Enchaîne les scénarios de pluie ; la réponse hydrologique du site est retirée à chaque épisode.

    Faire varier l'apport (``inflow``) et la vidange (``drain``) évite qu'un modèle n'apprenne un
    site unique : c'est la randomisation de domaine, côté hydrologie.
    """

    name = "cycle"

    def __init__(self, rng: random.Random, period_s: float = 900.0,
                 names: tuple[str, ...] = ("storm", "flash", "drizzle", "calm")):
        self.rng, self.period_s, self.names = rng, period_s, names
        self._index = -1
        self._current: RainScenario = scenario_for("calm")
        self.current_name = "calm"

    def rain(self, t: float) -> float:
        index = int(t // self.period_s)
        if index != self._index:
            self._index = index
            self.current_name = self.rng.choice(self.names)
            self._current = scenario_for(self.current_name)
            self.inflow = self._current.inflow * self.rng.uniform(0.7, 1.3)
            self.drain = self._current.drain * self.rng.uniform(0.7, 1.3)
        return self._current.rain(t - index * self.period_s)


def quality_of(reading: Reading, true_level_cm: float) -> str:
    """Étiquette d'une lecture, d'après la vérité terrain (voir l'en-tête du module)."""
    if not reading.sensor_ok:
        return "REJECTED"
    if abs(reading.level_cm - true_level_cm) > BAD_ERROR_CM:
        return "BAD"
    return "GOOD" if reading.condition is Condition.NORMAL else "DEGRADED"


def generate(seed: int = 1, hours: float = 6.0, physics: SensorPhysics | None = None,
             station_code: str = "underpass-01") -> list[dict]:
    """Produit les lectures étiquetées d'une station pendant ``hours`` heures simulées."""
    info = BUILTIN_STATIONS[station_code]
    cfg = SimConfig(stations=(info,)).validate()
    scenario = CyclingScenario(random.Random(seed + 1))
    plan = FaultPlan.random(random.Random(seed + 2), mean_gap_s=420.0, mean_length_s=150.0)
    station = VirtualStation(info, cfg, seed, scenario=scenario, mqtt_service=_NoMqtt(), fault_plan=plan,
                             physics=physics)
    rows = []
    steps_per_read = round(READ_PERIOD_S / STEP_S)
    for step in range(1, int(hours * 3600 / STEP_S) + 1):
        station.step(STEP_S)
        if step % steps_per_read:
            continue
        reading = station.read_sensor()
        ok = reading.sensor_ok
        row = {
            "t_s": round(station.sim_t, 1), "station": station_code, "scenario": scenario.current_name,
            "rain": round(station.rain, 3), "true_level_cm": round(station.level, 3),
            "condition": reading.condition.value, "quality": quality_of(reading, station.level),
            "sensor_ok": int(ok), "level_cm": round(reading.level_cm, 3) if ok else "",
            "error_cm": round(reading.level_cm - station.level, 3) if ok else "",
            "echo_ok": reading.echo_ok, "echo_spread_cm": round(reading.echo_spread_cm, 3),
        }
        for i in range(BURST):   # échos reçus, triés ; vide si l'écho n'est pas revenu
            row[f"e{i + 1}"] = round(reading.echoes[i], 3) if i < len(reading.echoes) else ""
        rows.append(row)
    return rows


def rule_flags(row: dict, spread_threshold_cm: float) -> bool:
    """Règle de référence : salve incomplète ou trop dispersée → lecture suspecte."""
    return row["echo_ok"] < BURST or row["echo_spread_cm"] > spread_threshold_cm


def summarize_rows(rows: list[dict], spread_threshold_cm: float = 1.0) -> dict:
    """Bilan du jeu de lectures et de la règle de référence.

    :return: effectifs par étiquette et par condition ; pour la règle, sur les lectures RETENUES
             par le firmware : part des lectures fausses attrapées (``bad_recall``), part des
             lectures saines signalées à tort (``false_alarm``), et détail par condition.
    """
    accepted = [r for r in rows if r["sensor_ok"]]
    bad = [r for r in accepted if r["quality"] == "BAD"]
    good = [r for r in accepted if r["quality"] == "GOOD"]

    def rate(subset: list[dict]) -> float | None:
        return round(sum(rule_flags(r, spread_threshold_cm) for r in subset) / len(subset), 4) if subset else None

    by_condition = {}
    for condition in Condition:
        subset = [r for r in rows if r["condition"] == condition.value]
        subset_bad = [r for r in subset if r["quality"] == "BAD"]
        by_condition[condition.value] = {
            "readings": len(subset),
            "rejected": sum(r["quality"] == "REJECTED" for r in subset),
            "bad": len(subset_bad),
            "bad_caught_by_rule": rate(subset_bad),
        }
    return {
        "readings": len(rows),
        "quality": {q: sum(r["quality"] == q for r in rows) for q in ("GOOD", "DEGRADED", "BAD", "REJECTED")},
        "rule": {"spread_threshold_cm": spread_threshold_cm, "bad_recall": rate(bad), "false_alarm": rate(good)},
        "by_condition": by_condition,
    }


def write_csv(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def _print(summary: dict) -> None:
    q, rule = summary["quality"], summary["rule"]
    print(f"lectures : {summary['readings']}  |  " + "  ".join(f"{k} {v}" for k, v in q.items()))
    print(f"règle de référence (salve incomplète ou dispersion > {rule['spread_threshold_cm']} cm) :")
    print(f"  lectures fausses attrapées : {_pct(rule['bad_recall'])}   fausses alertes sur lectures saines : "
          f"{_pct(rule['false_alarm'])}")
    print(f"  {'condition':<11} {'lectures':>8} {'rejetées':>9} {'fausses':>8} {'attrapées par la règle':>24}")
    for name, c in summary["by_condition"].items():
        print(f"  {name:<11} {c['readings']:>8} {c['rejected']:>9} {c['bad']:>8} {_pct(c['bad_caught_by_rule']):>24}")


def _pct(value: float | None) -> str:
    return "—" if value is None else f"{100 * value:.1f} %"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Banc de mesure simulé du capteur de niveau")
    p.add_argument("--hours", type=float, default=6.0, help="durée simulée")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--profile", choices=["nominal", "shifted"], default="nominal",
                   help="hypothèses du capteur : nominal (par défaut) ou shifted (jeu différent, test de robustesse)")
    p.add_argument("--spread-threshold", type=float, default=1.0, help="seuil de dispersion de la règle (cm)")
    p.add_argument("--out", type=Path, help="fichier CSV des lectures étiquetées")
    a = p.parse_args(argv)
    physics = SensorPhysics.shifted() if a.profile == "shifted" else SensorPhysics()
    rows = generate(a.seed, a.hours, physics)
    if a.out:
        write_csv(rows, a.out)
        print(f"écrit : {a.out} ({len(rows)} lectures)")
    _print(summarize_rows(rows, a.spread_threshold))
    return 0


if __name__ == "__main__":
    sys.exit(main())

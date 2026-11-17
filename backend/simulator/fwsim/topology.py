# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – fog : couplage hydrologique des stations
#  Fichier   : backend/simulator/fwsim/topology.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Guesmi Baderddine
#  Créé le   : 2026-11-17          Modifié le : 2026-11-17
#  Version   : 1.0
# =============================================================================
"""Couplage hydrologique : l'eau d'une station amont rejoint ses stations aval après un temps de parcours.

Modèle réservoir de chaque station, étendu à ses apports amont ::

    dL/dt = a·pluie(t − retard_orage) − b·L + Σ_amont g·L_amont(t − τ)

``τ`` (``travelSec``), ``g`` (``gain``, 1/min) et le retard de l'orage (``rainLagSec``) viennent de
``backend/gateway/stations.json``, le même registre que lit la passerelle : la topologie simulée et
la topologie connue de la passerelle ne peuvent pas diverger.
"""
from __future__ import annotations

from bisect import bisect_right
from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True)
class Link:
    """Lien amont -> aval."""

    upstream: str
    downstream: str
    travel_s: float
    gain_per_min: float


class LevelHistory:
    """Historique borné du niveau réel d'une station, interrogeable à un instant passé."""

    def __init__(self, horizon_s: float = 3600.0):
        self.horizon_s = horizon_s
        self.times: deque[float] = deque()
        self.levels: deque[float] = deque()

    def add(self, t_s: float, level_cm: float) -> None:
        self.times.append(t_s)
        self.levels.append(level_cm)
        while self.times and self.times[0] < t_s - self.horizon_s:
            self.times.popleft()
            self.levels.popleft()

    def at(self, t_s: float) -> float:
        """Niveau à l'instant ``t_s`` (dernier connu avant) ; 0 avant le début de l'historique."""
        i = bisect_right(self.times, t_s)
        return self.levels[i - 1] if i > 0 else 0.0


def links_of(registry: dict) -> list[Link]:
    """Liens déclarés dans le registre (``StationInfo.downstream``)."""
    out = []
    for info in registry.values():
        for d in info.downstream:
            out.append(Link(info.code, d["code"], float(d.get("travelSec", 0)), float(d.get("gain", 0))))
    return out


def couple(stations: list) -> list[Link]:
    """Relie entre elles les stations virtuelles présentes selon leurs liens déclarés.

    Une station aval reçoit l'historique de chacune de ses stations amont ; un lien vers une station
    non simulée est ignoré.
    """
    by_code = {s.code: s for s in stations}
    links = [link for link in links_of({s.code: s.info for s in stations})
             if link.upstream in by_code and link.downstream in by_code]
    for link in links:
        by_code[link.downstream].inflows.append((by_code[link.upstream].history, link.travel_s, link.gain_per_min))
    return links


__all__ = ["LevelHistory", "Link", "couple", "links_of"]

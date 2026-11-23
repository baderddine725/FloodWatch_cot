# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : apprentissage automatique – cloud (prévision du niveau)
#  Fichier   : ml/forecast/features.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Guesmi Baderddine
#  Créé le   : 2026-11-23          Modifié le : 2026-11-23          Version : 1.0
# =============================================================================
"""Indicateurs du modèle de prévision, calculés à partir des MESURES ENREGISTRÉES (table ``measurements``).

Ce module est la spécification : ``LearnedFeatures.java`` (middleware) en est la traduction ligne à
ligne, et un test de parité compare les deux sur les mêmes mesures (``ml/export/forecast_parity.json``).
D'où le style : boucles explicites, sommes dans l'ordre, pas de numpy ici.

Lecture d'une série à l'instant ``x`` (secondes) :

* niveau ``g(x)`` : **médiane** des mesures de ``]x − 60 s, x]`` (les échos parasites acceptés par le
  middleware ne passent pas une médiane) ; à défaut la dernière mesure de moins de 180 s ; sinon
  inconnu ;
* pluie ``r(x)`` : dernière mesure de moins de 180 s, sinon inconnue.

Un indicateur inconnu rend l'exemple inutilisable (apprentissage) ou le modèle inapplicable
(service : la prévision retombe sur les autres méthodes).
"""
from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass, field

MEDIAN_WINDOW_S = 60.0
STALE_S = 180.0
GRID_S = 30.0
#: horizons appris (s) : ceux de l'historique des prédictions (1, 3, 5, 10 min) et du service (15, 30 min)
HORIZONS_S = (60, 180, 300, 600, 900, 1800)

FEATURES = (
    "level_cm",       # g(t)
    "level_pct",      # 100 g(t) / critique
    "d1_cm",          # g(t) − g(t − 1 min)
    "d2_cm",          # g(t) − g(t − 2 min)
    "d5_cm",          # g(t) − g(t − 5 min)
    "d10_cm",         # g(t) − g(t − 10 min)
    "rain",           # r(t), 0..1
    "rain_mean10",    # moyenne de r sur 10 min (20 points espacés de 30 s)
    "rain_mean30",    # moyenne de r sur 30 min (60 points)
    "up_level_cm",    # Σ g_amont(t)
    "up_d5_cm",       # Σ (g_amont(t) − g_amont(t − 5 min))
    "up_at_h_cm",     # Σ g_amont(min(t, t + h − parcours)) : l'eau amont déjà mesurée qui arrive à t + h
    "has_upstream",   # 1 si la station a des stations amont
    "critical_cm",    # taille du site
)


@dataclass
class Series:
    """Mesures d'une station, triées par instant (s)."""

    ts: list[float] = field(default_factory=list)
    level: list[float] = field(default_factory=list)
    rain: list[float] = field(default_factory=list)

    def level_at(self, x: float) -> float | None:
        hi = bisect_right(self.ts, x)
        lo = bisect_right(self.ts, x - MEDIAN_WINDOW_S)
        if hi > lo:
            return median(self.level[lo:hi])
        if hi > 0 and x - self.ts[hi - 1] <= STALE_S:
            return self.level[hi - 1]
        return None

    def rain_at(self, x: float) -> float | None:
        hi = bisect_right(self.ts, x)
        if hi > 0 and x - self.ts[hi - 1] <= STALE_S:
            return self.rain[hi - 1]
        return None


@dataclass(frozen=True)
class Site:
    """Ce que le modèle sait d'une station : taille et stations amont (code, temps de parcours en s)."""

    code: str
    critical_cm: float
    sensor_height_cm: float
    upstream: tuple[tuple[str, float], ...] = ()


def median(values: list[float]) -> float:
    s = sorted(values)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0


def _mean_rain(series: Series, t: float, points: int) -> float | None:
    total = 0.0
    for k in range(points):
        r = series.rain_at(t - k * GRID_S)
        if r is None:
            return None
        total += r
    return total / points


def features(site: Site, t: float, horizon_s: float, data: dict[str, Series]) -> list[float] | None:
    """Vecteur d'indicateurs de ``site`` à l'instant ``t`` pour l'horizon ``horizon_s`` (ou None)."""
    own = data.get(site.code)
    if own is None:
        return None
    g0 = own.level_at(t)
    if g0 is None:
        return None
    past = []
    for lag in (60.0, 120.0, 300.0, 600.0):
        g = own.level_at(t - lag)
        if g is None:
            return None
        past.append(g0 - g)
    rain = own.rain_at(t)
    mean10 = _mean_rain(own, t, 20)
    mean30 = _mean_rain(own, t, 60)
    if rain is None or mean10 is None or mean30 is None:
        return None
    up_level = up_d5 = up_at_h = 0.0
    for code, travel_s in site.upstream:
        up = data.get(code)
        if up is None:
            return None
        u0 = up.level_at(t)
        u5 = up.level_at(t - 300.0)
        x = t + horizon_s - travel_s
        uh = up.level_at(x if x < t else t)
        if u0 is None or u5 is None or uh is None:
            return None
        up_level += u0
        up_d5 += u0 - u5
        up_at_h += uh
    return [g0, 100.0 * g0 / site.critical_cm, past[0], past[1], past[2], past[3], rain, mean10, mean30,
            up_level, up_d5, up_at_h, 1.0 if site.upstream else 0.0, site.critical_cm]


def label(site: Site, t: float, horizon_s: float, data: dict[str, Series]) -> float | None:
    """Cible : variation du niveau (médiane) entre t et t + h."""
    own = data[site.code]
    g0, gh = own.level_at(t), own.level_at(t + horizon_s)
    return None if g0 is None or gh is None else gh - g0

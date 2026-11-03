# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – back-end & IoT
#  Fichier   : simulator/fwsim/scenarios.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Ksontini Amine
#  Créé le   : 2026-11-02          Modifié le : 2026-11-03
#  Version   : 1.1
# =============================================================================
"""Scénarios de pluie (patron Strategy) : chaque scénario fournit l'intensité de pluie à
l'instant t, les coefficients du modèle « réservoir » et l'éventuelle panne du capteur.
Les profils sont ceux de la version 1.0 du simulateur (fonction ``rain_profile``).
"""
from __future__ import annotations


class RainScenario:
    """Stratégie de base : temps sec, pas de panne. ``t`` = secondes simulées."""

    name = "calm"
    inflow = 8.0      # a : cm/min de montée par unité de pluie
    drain = 0.3       # b : vidange proportionnelle au niveau (1/min)

    def rain(self, t: float) -> float:
        """Intensité de pluie normalisée (0..1)."""
        return 0.0

    def sensor_fault(self, t: float) -> bool:
        """Vrai si le capteur de niveau est en panne (mesure aberrante)."""
        return False


class Storm(RainScenario):
    """Orage (défaut) : montée progressive, plateau, arrêt -> vert, jaune, orange, rouge, décrue."""

    name = "storm"

    def rain(self, t):
        if t < 30:
            return 0.0
        if t < 90:
            return 0.9 * (t - 30) / 60.0
        return 0.9 if t < 330 else 0.0


class Flash(RainScenario):
    """Orage soudain et violent : montée très rapide (prédiction de débordement)."""

    name = "flash"
    inflow = 10.0

    def rain(self, t):
        return 1.0 if 20 <= t < 240 else 0.0


class Drizzle(RainScenario):
    """Pluie faible : jaune seulement."""

    name = "drizzle"

    def rain(self, t):
        return 0.35 if t >= 20 else 0.0


class Fault(RainScenario):
    """Capteur de niveau en panne après 60 s (mesure 999 cm, sensorOk=false)."""

    name = "fault"

    def rain(self, t):
        return 0.3 if t >= 20 else 0.0

    def sensor_fault(self, t):
        return t > 60


#: registre des stratégies disponibles
SCENARIOS: dict[str, type[RainScenario]] = {cls.name: cls for cls in (Storm, Flash, Drizzle, RainScenario, Fault)}


def scenario_for(name: str) -> RainScenario:
    """Fabrique : instancie la stratégie demandée (KeyError si inconnue)."""
    return SCENARIOS[name]()

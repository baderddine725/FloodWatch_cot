# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – banc de mesure du capteur
#  Fichier   : backend/simulator/fwsim/sensor.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Guesmi Baderddine
#  Créé le   : 2026-11-17          Modifié le : 2026-11-17
#  Version   : 1.0
# =============================================================================
"""Banc de mesure simulé du capteur de niveau (HC-SR04).

Faute de matériel complet, le capteur est simulé **écho par écho** : chaque lecture est une salve
de 5 échos, résumée exactement comme le fait le firmware (``readDistanceCm()`` et ``measure()``
de ``firmware/src/main.cpp``) : médiane des échos reçus, rejet s'il en revient moins de 3,
contrôle de plage. Les deux diagnostics publiés par la station (``echoOk``, ``echoSpreadCm``)
sont donc calculés, pas tirés au hasard.

Huit conditions sont modélisées (la normale et sept défauts). La simulation connaît la **vérité terrain** (niveau réel et
condition du capteur), ce qu'aucun banc matériel ne donne sans instrumentation : on peut donc
mesurer exactement ce qu'un détecteur de défaut attrape et ce qu'il laisse passer.

ATTENTION – ce sont des HYPOTHÈSES. Les paramètres de :class:`SensorPhysics` décrivent un
comportement plausible du HC-SR04, pas un comportement mesuré. Un modèle entraîné ici apprend
ces hypothèses. Deux garde-fous : un second jeu de paramètres (:meth:`SensorPhysics.shifted`)
pour vérifier qu'un détecteur ne s'effondre pas quand les hypothèses changent, et un format de
données identique à celui d'un futur banc réel, qui pourra remplacer la simulation sans rien
réécrire en aval.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from enum import Enum

#: nombre d'échos par lecture, minimum pour l'accepter, marge de plage : valeurs du firmware
BURST = 5
MIN_ECHOES = 3
RANGE_MARGIN_CM = 5.0
#: distance minimale mesurable par un HC-SR04 (zone aveugle)
MIN_DISTANCE_CM = 2.0
#: résolution d'un écho : le firmware mesure la durée en microsecondes entières (pulseIn) et
#: calcule ``us * 0.0343 / 2`` ; deux échos d'une surface immobile peuvent donc être identiques
ECHO_STEP_CM = 0.0343 / 2


class Condition(str, Enum):
    """État réel du capteur au moment d'une lecture (vérité terrain, jamais publiée)."""

    NORMAL = "NORMAL"
    GLITCH = "GLITCH"          # écho parasite isolé : une seule lecture faussée (goutte, feuille)
    SPLASH = "SPLASH"          # éclaboussures et vaguelettes : une partie des échos revient trop tôt
    FOAM = "FOAM"              # mousse : surface absorbante, échos perdus, niveau surestimé
    OBSTRUCTED = "OBSTRUCTED"  # obstacle fixe dans le faisceau (débris, toile) : niveau faussement haut
    STUCK = "STUCK"            # capteur figé : la mesure ne suit plus le niveau (salve d'apparence normale)
    DRIFT = "DRIFT"            # dérive lente de la mesure
    DROPOUT = "DROPOUT"        # capteur aveugle : presque aucun écho


@dataclass(frozen=True)
class SensorPhysics:
    """Paramètres du modèle de capteur. Hypothèses à recaler sur un banc réel."""

    noise_cm: float = 0.15                  # bruit d'un écho normal (résolution ~3 mm)
    miss_prob: float = 0.02                 # écho perdu en conditions normales
    glitch_prob: float = 0.03               # lecture isolée faussée, hors de tout épisode
    glitch_cm: tuple[float, float] = (3.0, 6.0)      # avance de l'écho parasite
    splash_prob: float = 0.35               # part des échos déviés par une éclaboussure
    splash_cm: tuple[float, float] = (1.0, 8.0)      # avance d'un écho dévié
    foam_miss_prob: float = 0.45
    foam_noise_cm: float = 1.0
    foam_cm: tuple[float, float] = (1.0, 4.0)        # épaisseur de mousse au-dessus de l'eau
    obstruct_hit_prob: float = 0.85         # part des échos renvoyés par l'obstacle
    obstruct_noise_cm: float = 0.10
    dropout_miss_prob: float = 0.85
    drift_cm_per_min: tuple[float, float] = (0.05, 0.30)

    @classmethod
    def randomized(cls, rng: random.Random) -> "SensorPhysics":
        """Capteur tiré au hasard autour des valeurs nominales (randomisation de domaine).

        Entraîner sur des capteurs variés évite qu'un modèle n'apprenne UN capteur supposé. Les
        plages encadrent les valeurs nominales et EXCLUENT toutes celles de :meth:`shifted` :
        évaluer sur ce profil reste une vraie extrapolation, pas une interpolation déguisée.
        """
        u = rng.uniform
        glitch_low = u(2.0, 3.5)
        return cls(noise_cm=u(0.08, 0.22), miss_prob=u(0.01, 0.035),
                   glitch_prob=u(0.015, 0.04), glitch_cm=(glitch_low, glitch_low + u(2.5, 3.5)),
                   splash_prob=u(0.25, 0.45), splash_cm=(1.0, u(6.0, 9.0)),
                   foam_miss_prob=u(0.35, 0.55), foam_noise_cm=u(0.8, 1.3), foam_cm=(1.0, u(3.0, 5.0)),
                   obstruct_hit_prob=u(0.75, 0.90), obstruct_noise_cm=u(0.06, 0.14),
                   dropout_miss_prob=u(0.80, 0.92), drift_cm_per_min=(0.05, 0.30))

    @classmethod
    def shifted(cls) -> "SensorPhysics":
        """Second jeu d'hypothèses, volontairement différent, pour éprouver la robustesse.

        Un détecteur réglé sur les valeurs par défaut puis évalué ici montre ce qu'il vaut quand
        le capteur réel ne ressemble pas tout à fait au capteur supposé.
        """
        return cls(noise_cm=0.30, miss_prob=0.05, glitch_prob=0.05, glitch_cm=(1.5, 4.0),
                   splash_prob=0.20, splash_cm=(0.5, 5.0),
                   foam_miss_prob=0.30, foam_noise_cm=0.6, foam_cm=(0.5, 2.5),
                   obstruct_hit_prob=0.95, obstruct_noise_cm=0.20, dropout_miss_prob=0.70,
                   drift_cm_per_min=(0.02, 0.15))


@dataclass
class FaultEpisode:
    """Période pendant laquelle le capteur est dans une condition anormale."""

    condition: Condition
    start_s: float
    end_s: float = math.inf
    # État propre à l'épisode, tiré à la première lecture (voir UltrasonicSensor._prepare)
    obstacle_cm: float | None = None
    stuck_cm: float | None = None
    foam_cm: float = 0.0
    drift_rate: float = 0.0     # cm/min, signé

    def covers(self, t_s: float) -> bool:
        return self.start_s <= t_s < self.end_s


class FaultPlan:
    """Calendrier des épisodes de défaut d'un capteur."""

    #: conditions tirées par :meth:`random` : les défauts qui durent (ni NORMAL ni l'écho isolé)
    FAULTS = tuple(c for c in Condition if c not in (Condition.NORMAL, Condition.GLITCH))

    def __init__(self, episodes: list[FaultEpisode] | None = None):
        self.episodes = sorted(episodes or [], key=lambda e: e.start_s)
        self._draw = None       # tirage paresseux des épisodes suivants (plan aléatoire)
        self._horizon_s = 0.0

    @classmethod
    def none(cls) -> "FaultPlan":
        """Capteur toujours sain."""
        return cls()

    @classmethod
    def single(cls, condition: Condition, start_s: float = 0.0, end_s: float = math.inf) -> "FaultPlan":
        """Un seul épisode (tests et démonstrations)."""
        return cls([FaultEpisode(condition, start_s, end_s)])

    @classmethod
    def random(cls, rng: random.Random, mean_gap_s: float = 600.0, mean_length_s: float = 120.0,
               conditions: tuple[Condition, ...] | None = None) -> "FaultPlan":
        """Épisodes aléatoires sans fin : intervalles et durées exponentiels, condition uniforme.

        Les épisodes sont tirés à la demande, au fil du temps simulé : le plan convient à une
        simulation de durée indéterminée et reste reproductible pour une graine donnée.
        """
        plan = cls()
        pool = conditions or cls.FAULTS

        def draw(after_s: float) -> FaultEpisode:
            start = after_s + rng.expovariate(1.0 / mean_gap_s)
            return FaultEpisode(rng.choice(pool), start, start + max(10.0, rng.expovariate(1.0 / mean_length_s)))

        plan._draw = draw
        return plan

    def at(self, t_s: float) -> FaultEpisode | None:
        """Épisode en cours à l'instant ``t_s`` (ou ``None`` si le capteur est sain)."""
        while self._draw is not None and self._horizon_s <= t_s:
            episode = self._draw(self._horizon_s)
            # plan sans fin : on ne garde que les épisodes encore utiles
            self.episodes = [e for e in self.episodes if e.end_s > t_s] + [episode]
            self._horizon_s = episode.end_s
        return next((e for e in self.episodes if e.covers(t_s)), None)


@dataclass(frozen=True)
class Reading:
    """Résultat d'une lecture, tel que le firmware le calcule, plus la vérité terrain."""

    sensor_ok: bool                 # lecture retenue par le firmware
    level_cm: float | None          # niveau déduit ; None si la lecture est rejetée
    distance_cm: float | None       # médiane des échos ; None s'il en revient moins de 3
    echo_ok: int                    # échos reçus sur la salve
    echo_spread_cm: float           # écart max − min entre ces échos
    echoes: tuple[float, ...]       # distances des échos reçus, triées
    condition: Condition            # VÉRITÉ TERRAIN : connue du simulateur seul


class UltrasonicSensor:
    """Capteur HC-SR04 simulé : une salve d'échos par lecture."""

    def __init__(self, rng: random.Random, physics: SensorPhysics | None = None):
        self.rng = rng
        self.physics = physics or SensorPhysics()

    def read(self, true_level_cm: float, sensor_height_cm: float, t_s: float = 0.0,
             episode: FaultEpisode | None = None) -> Reading:
        """Effectue une lecture.

        :param true_level_cm: niveau d'eau réel
        :param sensor_height_cm: hauteur du capteur au-dessus du fond
        :param t_s: instant simulé (sert à la dérive)
        :param episode: épisode de défaut en cours, ou ``None`` si le capteur est sain
        """
        distance = max(MIN_DISTANCE_CM, sensor_height_cm - true_level_cm)
        if episode is None and self.rng.random() < self.physics.glitch_prob:
            # écho parasite isolé : un objet passe dans le faisceau le temps d'une lecture
            episode = FaultEpisode(Condition.GLITCH, t_s, t_s, obstacle_cm=max(
                MIN_DISTANCE_CM, distance - self.rng.uniform(*self.physics.glitch_cm)))
        condition = episode.condition if episode else Condition.NORMAL
        if episode:
            self._prepare(episode, distance)
        echoes = [self._echo(distance, condition, episode, t_s) for _ in range(BURST)]
        return summarize([e for e in echoes if e is not None], sensor_height_cm, condition)

    def _prepare(self, episode: FaultEpisode, distance: float) -> None:
        """Fixe, à la première lecture d'un épisode, ce qui restera constant pendant sa durée."""
        p = self.physics
        if episode.condition is Condition.OBSTRUCTED and episode.obstacle_cm is None:
            # l'obstacle est entre le capteur et l'eau : il fait lire un niveau trop haut
            episode.obstacle_cm = self.rng.uniform(MIN_DISTANCE_CM + 1, max(MIN_DISTANCE_CM + 1.5, distance - 3))
        elif episode.condition is Condition.STUCK and episode.stuck_cm is None:
            episode.stuck_cm = distance + self.rng.gauss(0, p.noise_cm)
        elif episode.condition is Condition.FOAM and episode.foam_cm == 0.0:
            episode.foam_cm = self.rng.uniform(*p.foam_cm)
        elif episode.condition is Condition.DRIFT and episode.drift_rate == 0.0:
            episode.drift_rate = self.rng.choice((-1, 1)) * self.rng.uniform(*p.drift_cm_per_min)

    def _echo(self, distance: float, condition: Condition, episode: FaultEpisode | None, t_s: float) -> float | None:
        """Distance d'un écho, ou ``None`` s'il ne revient pas, à la résolution du firmware."""
        raw = self._raw_echo(distance, condition, episode, t_s)
        return None if raw is None else max(MIN_DISTANCE_CM, round(raw / ECHO_STEP_CM) * ECHO_STEP_CM)

    def _raw_echo(self, distance: float, condition: Condition, episode: FaultEpisode | None, t_s: float) -> float | None:
        p, rng = self.physics, self.rng
        if condition is Condition.STUCK:
            # La valeur centrale est figée, mais chaque écho garde le bruit ordinaire : un capteur
            # figé ne se trahit PAS par une salve parfaite (une surface calme peut en donner une).
            if rng.random() < p.miss_prob:
                return None
            return episode.stuck_cm + rng.gauss(0, p.noise_cm)
        if condition is Condition.DROPOUT:
            miss, noise, offset = p.dropout_miss_prob, p.noise_cm, 0.0
        elif condition is Condition.FOAM:
            miss, noise, offset = p.foam_miss_prob, p.foam_noise_cm, -episode.foam_cm
        elif condition is Condition.DRIFT:
            miss, noise, offset = p.miss_prob, p.noise_cm, -episode.drift_rate * (t_s - episode.start_s) / 60.0
        else:
            miss, noise, offset = p.miss_prob, p.noise_cm, 0.0
        if rng.random() < miss:
            return None
        if condition in (Condition.OBSTRUCTED, Condition.GLITCH) and rng.random() < p.obstruct_hit_prob:
            return max(MIN_DISTANCE_CM, episode.obstacle_cm + rng.gauss(0, p.obstruct_noise_cm))
        if condition is Condition.SPLASH and rng.random() < p.splash_prob:
            offset = -rng.uniform(*p.splash_cm)
        return max(MIN_DISTANCE_CM, distance + offset + rng.gauss(0, noise))


def summarize(received: list[float], sensor_height_cm: float, condition: Condition = Condition.NORMAL) -> Reading:
    """Résume une salve comme le firmware : médiane, rejet sous 3 échos, contrôle de plage.

    Fonction pure, sans tirage : c'est elle qu'un banc réel appellera avec ses échos mesurés.
    """
    echoes = tuple(sorted(received))
    n = len(echoes)
    spread = echoes[-1] - echoes[0] if n >= 2 else 0.0
    if n < MIN_ECHOES:
        return Reading(False, None, None, n, spread, echoes, condition)
    distance = echoes[n // 2]
    ok = 0 < distance <= sensor_height_cm + RANGE_MARGIN_CM
    level = max(0.0, sensor_height_cm - distance) if ok else None
    return Reading(ok, level, distance, n, spread, echoes, condition)


__all__ = ["BURST", "MIN_ECHOES", "Condition", "FaultEpisode", "FaultPlan", "Reading", "SensorPhysics",
           "UltrasonicSensor", "summarize"]

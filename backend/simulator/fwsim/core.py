# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – edge, jumeau Python du firmware
#  Fichier   : backend/simulator/fwsim/core.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Guesmi Baderddine
#  Créé le   : 2026-11-17          Modifié le : 2026-11-17
#  Version   : 1.0
# =============================================================================
"""Règle de sécurité locale et politique de capteur dégradé : jumeau de ``SafetyController``
(``firmware/lib/floodwatch_core/src/fw_core.cpp``). Même logique ligne à ligne ; le test
``ml/tests/test_core_parity.py`` rejoue les mêmes lectures dans les deux et exige les mêmes sorties.

* Lecture valide >= rouge (suspecte ou non) : fermeture, feu rouge, sirène (``LOCAL_SAFETY``).
* Réouverture après ``reopenDelaySec`` de lectures valides ET non suspectes sous l'orange.
* Capteur aveugle : feu orange s'il était vert ; aveugle sous une pluie >= seuil pendant
  ``degradedCloseSec`` : fermeture de précaution, feu rouge, sans sirène (``DEGRADED``).
"""
from __future__ import annotations

from dataclasses import dataclass, field

NORMAL, LOCAL_SAFETY, DEGRADED = "NORMAL", "LOCAL_SAFETY", "DEGRADED"


@dataclass
class Outputs:
    barrier_closed: bool = False
    light: str = "GREEN"
    siren: bool = False

    def snapshot(self) -> tuple:
        return self.barrier_closed, self.light, self.siren


@dataclass
class SafetyController:
    thresholds: dict = field(default_factory=dict)
    mode: str = NORMAL
    believed: float = 0.0
    below_orange_since: float | None = None
    blind_since: float | None = None
    rain_blind_since: float | None = None
    warned_blind: bool = False

    def th(self, key: str, default: float) -> float:
        return float(self.thresholds.get(key, default))

    def pct(self, level_cm: float) -> float:
        return 100.0 * level_cm / self.th("criticalCm", 20)

    def release_by_command(self) -> None:
        """Ouverture commandée par le Cloud : les modes autonomes sont levés."""
        self.mode, self.below_orange_since = NORMAL, None

    def step(self, t_s: float, ok: bool, level_cm: float | None, rain: float, suspect: bool, out: Outputs) -> bool:
        """Applique une lecture ; vrai si les sorties ont changé."""
        before = out.snapshot()
        if not ok:
            if self.blind_since is None:
                self.blind_since = t_s
            self.below_orange_since = None
            if rain >= self.th("rainThreshold", 0.2):
                if self.rain_blind_since is None:
                    self.rain_blind_since = t_s
            else:
                self.rain_blind_since = None
            if (self.mode == NORMAL and self.rain_blind_since is not None
                    and t_s - self.rain_blind_since >= self.th("degradedCloseSec", 120)):
                self.mode = DEGRADED
                out.barrier_closed, out.light, out.siren = True, "RED", False
                self.warned_blind = False
            elif self.mode == NORMAL and out.light == "GREEN":
                out.light = "ORANGE"
                self.warned_blind = True
        else:
            self.blind_since = None
            self.rain_blind_since = None
            self.believed = level_cm
            if self.warned_blind and self.mode == NORMAL:
                if out.light == "ORANGE":
                    out.light = "GREEN"
                self.warned_blind = False
            p = self.pct(level_cm)
            if p >= self.th("redPct", 85):
                self.mode = LOCAL_SAFETY
                self.below_orange_since = None
                out.barrier_closed, out.light, out.siren = True, "RED", True
            elif self.mode != NORMAL:
                if p < self.th("orangePct", 60) and not suspect:
                    if self.below_orange_since is None:
                        self.below_orange_since = t_s
                    elif t_s - self.below_orange_since >= self.th("reopenDelaySec", 60):
                        self.mode = NORMAL
                        self.below_orange_since = None
                        out.barrier_closed, out.siren = False, False
                        out.light = "GREEN" if p < self.th("yellowPct", 30) else "ORANGE"
                elif p >= self.th("orangePct", 60):
                    self.below_orange_since = None
        return before != out.snapshot()


__all__ = ["DEGRADED", "LOCAL_SAFETY", "NORMAL", "Outputs", "SafetyController"]

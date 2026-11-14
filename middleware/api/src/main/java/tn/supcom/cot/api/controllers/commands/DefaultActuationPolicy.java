/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : DefaultActuationPolicy.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.commands;

import tn.supcom.cot.api.controllers.alerting.AlertLevel;
import tn.supcom.cot.api.entities.LightColor;
import tn.supcom.cot.api.entities.SamplingMode;

import java.util.List;

/**
 * Réactions automatiques de la Table 1 :
 * vert/jaune : feu vert, barrière ouverte, sirène coupée ;
 * orange : feu orange ; rouge : feu rouge, barrière fermée, sirène.
 * La surveillance renforcée (mesure toutes les 5 s) est activée dès le jaune.
 */
public class DefaultActuationPolicy implements ActuationPolicy {
    @Override
    public List<StationCommand> targetsFor(AlertLevel level) {
        var sampling = new SamplingCommand(level.isAtLeast(AlertLevel.YELLOW) ? SamplingMode.WATCH : SamplingMode.NORMAL);
        return switch (level) {
            case GREEN, YELLOW -> List.of(sampling, new LightCommand(LightColor.GREEN),
                    new SirenCommand(false), new BarrierCommand(false));
            case ORANGE -> List.of(sampling, new LightCommand(LightColor.ORANGE),
                    new SirenCommand(false), new BarrierCommand(false));
            case RED -> List.of(sampling, new BarrierCommand(true), new LightCommand(LightColor.RED),
                    new SirenCommand(true));
        };
    }
}

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : SamplingCommand.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.commands;

import tn.supcom.cot.api.entities.SamplingMode;
import tn.supcom.cot.api.entities.Station;

/** Période de mesure : NORMAL (30 s) ou WATCH (surveillance renforcée, 5 s). */
public record SamplingCommand(SamplingMode mode) implements StationCommand {
    public SamplingCommand {
        if (mode == null) throw new IllegalArgumentException("mode required");
    }

    @Override
    public String actuator() {
        return "sampling";
    }

    @Override
    public String value() {
        return mode.name();
    }

    @Override
    public boolean isSatisfiedBy(Station s) {
        return s.getSampling() == mode;
    }
}

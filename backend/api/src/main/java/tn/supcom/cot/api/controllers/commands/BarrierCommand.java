/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : BarrierCommand.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.commands;

import tn.supcom.cot.api.entities.BarrierState;
import tn.supcom.cot.api.entities.Station;

/** Ouverture / fermeture de la barrière (valeurs firmware : OPEN, CLOSE). */
public record BarrierCommand(boolean close) implements StationCommand {
    @Override
    public String actuator() {
        return "barrier";
    }

    @Override
    public String value() {
        return close ? "CLOSE" : "OPEN";
    }

    @Override
    public boolean isSatisfiedBy(Station s) {
        return s.getBarrier() == (close ? BarrierState.CLOSED : BarrierState.OPEN);
    }
}

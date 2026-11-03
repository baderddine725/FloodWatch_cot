/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : SirenCommand.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.commands;

import tn.supcom.cot.api.entities.Station;

/** Activation de la sirène (ON, OFF). */
public record SirenCommand(boolean on) implements StationCommand {
    @Override
    public String actuator() {
        return "siren";
    }

    @Override
    public String value() {
        return on ? "ON" : "OFF";
    }

    @Override
    public boolean isSatisfiedBy(Station s) {
        return s.isSiren() == on;
    }
}

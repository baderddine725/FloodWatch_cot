/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : LightCommand.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.commands;

import tn.supcom.cot.api.entities.LightColor;
import tn.supcom.cot.api.entities.Station;

/** Couleur du feu de signalisation (GREEN, ORANGE, RED, OFF). */
public record LightCommand(LightColor color) implements StationCommand {
    public LightCommand {
        if (color == null || color == LightColor.UNKNOWN) throw new IllegalArgumentException("invalid light color");
    }

    @Override
    public String actuator() {
        return "light";
    }

    @Override
    public String value() {
        return color.name();
    }

    @Override
    public boolean isSatisfiedBy(Station s) {
        return s.getLight() == color;
    }
}

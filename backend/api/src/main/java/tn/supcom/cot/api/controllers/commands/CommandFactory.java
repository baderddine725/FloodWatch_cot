/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : CommandFactory.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.commands;

import tn.supcom.cot.api.entities.LightColor;
import tn.supcom.cot.api.entities.SamplingMode;

import java.util.Locale;

/** Fabrique de commandes à partir de la représentation (actionneur, valeur) de l'API REST. */
public final class CommandFactory {
    private CommandFactory() {
    }

    /**
     * @throws IllegalArgumentException si l'actionneur ou la valeur est inconnu(e)
     */
    public static StationCommand parse(String actuator, String value) {
        if (actuator == null || value == null) throw new IllegalArgumentException("actuator and value are required");
        String v = value.trim().toUpperCase(Locale.ROOT);
        return switch (actuator.trim().toLowerCase(Locale.ROOT)) {
            case "barrier" -> switch (v) {
                case "CLOSE", "CLOSED" -> new BarrierCommand(true);
                case "OPEN" -> new BarrierCommand(false);
                default -> throw new IllegalArgumentException("barrier value must be OPEN or CLOSE");
            };
            case "light" -> new LightCommand(LightColor.valueOf(v));
            case "siren" -> switch (v) {
                case "ON", "TRUE" -> new SirenCommand(true);
                case "OFF", "FALSE" -> new SirenCommand(false);
                default -> throw new IllegalArgumentException("siren value must be ON or OFF");
            };
            case "sampling" -> new SamplingCommand(SamplingMode.valueOf(v));
            default -> throw new IllegalArgumentException("unknown actuator: " + actuator);
        };
    }
}

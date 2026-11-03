/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : StationCommand.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.commands;

import tn.supcom.cot.api.entities.Station;

/**
 * Commande adressée à un actionneur d'une station (patron Command).
 * Chaque commande sait se sérialiser pour le firmware et vérifier si l'état
 * rapporté par la station la satisfait déjà (idempotence de l'automatisme).
 */
public sealed interface StationCommand
        permits BarrierCommand, LightCommand, SirenCommand, SamplingCommand {

    /** @return le nom de l'actionneur (barrier, light, siren, sampling) */
    String actuator();

    /** @return la valeur cible envoyée au firmware */
    String value();

    /** @return vrai si l'état rapporté par la station correspond déjà à la cible */
    boolean isSatisfiedBy(Station station);
}

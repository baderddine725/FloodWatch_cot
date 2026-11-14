/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : ActuationPolicy.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.commands;

import tn.supcom.cot.api.controllers.alerting.AlertLevel;

import java.util.List;

/**
 * Stratégie de réaction automatique des actionneurs selon le niveau d'alerte (patron Strategy).
 */
public interface ActuationPolicy {

    /** @return les états cibles des actionneurs pour un niveau d'alerte */
    List<StationCommand> targetsFor(AlertLevel level);
}

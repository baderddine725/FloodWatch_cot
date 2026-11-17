/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : PredictionStatus.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-16          Modifié le : 2026-11-16
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.entities;

/** Cycle de vie d'une prédiction historisée. */
public enum PredictionStatus {
    /** L'échéance n'est pas encore atteinte. */
    PENDING,
    /** Comparée à la mesure réelle : l'erreur est connue. */
    SCORED,
    /** Aucune mesure exploitable à l'échéance (station muette ou capteur en défaut). */
    MISSED
}

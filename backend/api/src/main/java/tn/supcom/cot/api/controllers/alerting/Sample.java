/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : Sample.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.alerting;

import java.time.Instant;

/**
 * Mesure élémentaire de niveau d'eau utilisée par les prédicteurs.
 *
 * @param ts      horodatage de réception
 * @param levelCm hauteur d'eau en cm
 */
public record Sample(Instant ts, double levelCm) {
}

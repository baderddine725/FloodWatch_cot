/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : EvaluationContext.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.alerting;

import java.time.Instant;

/**
 * Données d'entrée de la chaîne d'évaluation d'alerte.
 *
 * @param thresholds       seuils de la station
 * @param levelCm          niveau d'eau courant (cm)
 * @param rain             intensité de pluie normalisée (0..1)
 * @param prediction       prédiction de débordement
 * @param previous         niveau d'alerte précédent
 * @param belowOrangeSince instant depuis lequel le niveau est repassé sous le seuil orange (ou null)
 * @param now              instant de l'évaluation
 */
public record EvaluationContext(Thresholds thresholds, double levelCm, double rain, Prediction prediction,
                                AlertLevel previous, Instant belowOrangeSince, Instant now) {

    /** @return le niveau en pourcentage du niveau critique */
    public double percent() {
        return thresholds.percent(levelCm);
    }
}

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : PredictionMetricsDto.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-16          Modifié le : 2026-11-16
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.dto;

/**
 * Qualité d'un modèle de prédiction à un horizon donné, mesurée sur des prédictions réelles.
 *
 * @param model            identifiant du modèle
 * @param horizonSec       horizon de prévision en secondes
 * @param scored           nombre de prédictions confrontées à une mesure
 * @param missed           nombre de prédictions sans mesure à l'échéance
 * @param maeCm            erreur absolue moyenne (cm)
 * @param biasCm           erreur signée moyenne, prévu − réel (cm) : positive = alarmiste, négative = en retard
 * @param rmseCm           racine de l'erreur quadratique moyenne (cm), sensible aux grosses erreurs
 * @param persistenceMaeCm erreur absolue moyenne de la référence « le niveau ne change pas » (cm)
 * @param skill            gain sur cette référence : 1 − MAE / MAE de référence (≤ 0 = le modèle n'apporte rien)
 */
public record PredictionMetricsDto(String model, int horizonSec, long scored, long missed, Double maeCm,
                                   Double biasCm, Double rmseCm, Double persistenceMaeCm, Double skill) {
}

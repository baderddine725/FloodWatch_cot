/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : prediction – back-end & IoT
 *  Fichier   : Prediction.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.prediction;

import java.util.Objects;
import java.util.OptionalDouble;

/**
 * Résultat d'une prédiction de débordement.
 *
 * @param riseSpeedCmPerMin vitesse de montée estimée (cm/min ; négative si l'eau baisse, 0 si inconnue)
 * @param minutesToOverflow temps restant avant d'atteindre le seuil critique (min) ; 0 si le seuil est
 *                          déjà atteint ; vide si l'eau ne monte pas
 * @param sampleCount       nombre de mesures utilisées (au plus {@link PredictorConfig#windowSize()})
 * @param currentLevelCm    niveau de la mesure la plus récente (cm)
 * @param fillRatio         niveau actuel / seuil critique (0,5 = 50 %)
 * @param decision          décision d'alerte, gardes comprises
 */
public record Prediction(double riseSpeedCmPerMin, OptionalDouble minutesToOverflow, int sampleCount,
                         double currentLevelCm, double fillRatio, AlertDecision decision) {

    /**
     * Vérifie que les champs obligatoires sont renseignés.
     */
    public Prediction {
        Objects.requireNonNull(minutesToOverflow, "minutesToOverflow");
        Objects.requireNonNull(decision, "decision");
    }

    /**
     * Alerte de prédiction : débordement prévu à brève échéance, gardes satisfaites.
     *
     * @return {@code true} si l'alerte doit être levée (niveau ROUGE côté API)
     */
    public boolean overflowAlert() {
        return decision.isAlert();
    }

    /**
     * Indique si un débordement est prévu, à n'importe quelle échéance.
     *
     * @return {@code true} si un temps restant a pu être calculé
     */
    public boolean overflowExpected() {
        return minutesToOverflow.isPresent();
    }
}

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : prediction – back-end & IoT
 *  Fichier   : AlertDecision.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.prediction;

/**
 * Pourquoi la prédiction lève, ou ne lève pas, une alerte de débordement.
 * Les gardes sont évaluées dans l'ordre des constantes.
 */
public enum AlertDecision {

    /** Garde : moins de {@link PredictorConfig#minSamplesForAlert()} mesures. */
    NOT_ENOUGH_SAMPLES,
    /** Garde : niveau inférieur ou égal à {@link PredictorConfig#minFillRatioForAlert()} du seuil. */
    LEVEL_TOO_LOW,
    /** L'eau ne monte pas (vitesse ≤ {@link PredictorConfig#minRiseCmPerMin()}). */
    NO_OVERFLOW_EXPECTED,
    /** Débordement prévu, mais pas avant {@link PredictorConfig#alertWindowMinutes()} minutes. */
    OUTSIDE_WINDOW,
    /** Alerte : débordement prévu dans moins de {@link PredictorConfig#alertWindowMinutes()} minutes. */
    ALERT;

    /**
     * Indique si cette décision correspond à une alerte.
     *
     * @return {@code true} pour {@link #ALERT}
     */
    public boolean isAlert() {
        return this == ALERT;
    }
}

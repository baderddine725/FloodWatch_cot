/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : prediction – back-end & IoT
 *  Fichier   : PredictorConfig.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.prediction;

/**
 * Paramètres du prédicteur.
 *
 * @param windowSize           nombre de mesures les plus récentes utilisées pour la régression (10)
 * @param minSamplesForSpeed   nombre minimal de mesures pour estimer une vitesse (3)
 * @param minSamplesForAlert   garde : nombre minimal de mesures pour lever une alerte de prédiction (5)
 * @param minFillRatioForAlert garde : taux de remplissage à DÉPASSER pour lever une alerte (0,5 = 50 %)
 * @param alertWindowMinutes   alerte si le débordement est prévu dans strictement moins de ce délai (10 min)
 * @param minRiseCmPerMin      en dessous de cette vitesse, l'eau est considérée comme stable (0,05 cm/min)
 */
public record PredictorConfig(int windowSize, int minSamplesForSpeed, int minSamplesForAlert,
                              double minFillRatioForAlert, double alertWindowMinutes, double minRiseCmPerMin) {

    /** Paramètres du cahier des charges FloodWatch. */
    public static final PredictorConfig DEFAULTS = new PredictorConfig(10, 3, 5, 0.50, 10.0, 0.05);

    /**
     * Vérifie la cohérence des paramètres.
     *
     * @throws IllegalArgumentException si un paramètre est hors de son domaine
     */
    public PredictorConfig {
        if (minSamplesForSpeed < 2) {
            throw new IllegalArgumentException("minSamplesForSpeed doit valoir au moins 2 : " + minSamplesForSpeed);
        }
        if (windowSize < minSamplesForSpeed) {
            throw new IllegalArgumentException("windowSize (" + windowSize + ") doit être ≥ minSamplesForSpeed ("
                    + minSamplesForSpeed + ")");
        }
        if (minSamplesForAlert < minSamplesForSpeed || minSamplesForAlert > windowSize) {
            throw new IllegalArgumentException("minSamplesForAlert doit être entre minSamplesForSpeed et windowSize : "
                    + minSamplesForAlert);
        }
        if (!Double.isFinite(minFillRatioForAlert) || minFillRatioForAlert < 0 || minFillRatioForAlert >= 1) {
            throw new IllegalArgumentException("minFillRatioForAlert doit être dans [0 ; 1[ : " + minFillRatioForAlert);
        }
        if (!Double.isFinite(alertWindowMinutes) || alertWindowMinutes <= 0) {
            throw new IllegalArgumentException("alertWindowMinutes doit être strictement positif : " + alertWindowMinutes);
        }
        if (!Double.isFinite(minRiseCmPerMin) || minRiseCmPerMin < 0) {
            throw new IllegalArgumentException("minRiseCmPerMin doit être positif ou nul : " + minRiseCmPerMin);
        }
    }

    /**
     * Copie avec une autre fenêtre d'alerte (seuil configurable par station).
     *
     * @param minutes nouvelle fenêtre d'alerte, en minutes
     * @return la configuration modifiée
     */
    public PredictorConfig withAlertWindowMinutes(double minutes) {
        return new PredictorConfig(windowSize, minSamplesForSpeed, minSamplesForAlert, minFillRatioForAlert,
                minutes, minRiseCmPerMin);
    }
}

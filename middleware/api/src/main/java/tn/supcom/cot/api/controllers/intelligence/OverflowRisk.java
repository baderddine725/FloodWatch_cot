/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware (intelligence Cloud)
 *  Fichier   : OverflowRisk.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-17          Modifié le : 2026-11-17
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.intelligence;

/**
 * Indice de risque de débordement à un horizon (classe pure).
 * <p>L'erreur des prévisions passées à cet horizon est MESURÉE par l'historique des prédictions
 * (RMSE). En supposant cette erreur gaussienne et centrée sur la prévision, l'indice vaut
 * {@code P(niveau >= critique) = 1 − Φ((critique − prévu) / σ)}. Tant qu'il n'a pas été confronté
 * à de vrais épisodes de crue, c'est un INDICE ordonné, pas une probabilité calibrée : le service
 * l'expose sous le nom {@code overflowRisk}, avec l'origine de σ.</p>
 */
public final class OverflowRisk {
    /** σ minimal (cm) : jamais de certitude absolue, même avec un historique parfait. */
    public static final double MIN_SIGMA_CM = 0.3;

    private OverflowRisk() {
    }

    /** σ par défaut sans historique : 0,5 cm + 0,2 cm par minute d'horizon. */
    public static double defaultSigma(double horizonMin) {
        return 0.5 + 0.2 * horizonMin;
    }

    /** σ mesuré à un horizon plus court, extrapolé à un horizon plus long (marche aléatoire : √h). */
    public static double extrapolateSigma(double sigma, double fromMin, double toMin) {
        return fromMin <= 0 ? sigma : sigma * Math.sqrt(Math.max(1.0, toMin / fromMin));
    }

    /** Indice de risque dans [0, 1]. */
    public static double risk(double predictedCm, double criticalCm, double sigmaCm) {
        double s = Math.max(MIN_SIGMA_CM, sigmaCm);
        return 1.0 - phi((criticalCm - predictedCm) / s);
    }

    /** Classe de risque : HIGH >= 0,5 ; MEDIUM >= 0,2 ; LOW sinon. */
    public static String label(double risk) {
        return risk >= 0.5 ? "HIGH" : risk >= 0.2 ? "MEDIUM" : "LOW";
    }

    /** Fonction de répartition de la loi normale centrée réduite (Abramowitz et Stegun 7.1.26). */
    public static double phi(double x) {
        double z = Math.abs(x) / Math.sqrt(2.0);
        double t = 1.0 / (1.0 + 0.3275911 * z);
        double erf = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t
                + 0.254829592) * t * Math.exp(-z * z);
        return x >= 0 ? 0.5 * (1.0 + erf) : 0.5 * (1.0 - erf);
    }
}

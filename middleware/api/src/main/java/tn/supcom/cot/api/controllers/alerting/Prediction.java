/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : Prediction.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.alerting;

/**
 * Résultat d'une prédiction de débordement.
 *
 * @param slopeCmPerMin     vitesse de montée estimée (cm/min, négative si décrue)
 * @param minutesToOverflow temps estimé avant d'atteindre le niveau critique, ou {@code null}
 *                          si le niveau ne monte pas (ou trop peu d'échantillons)
 * @param samples           nombre d'échantillons utilisés
 * @param levelCm           niveau courant estimé après filtrage (ou null si inconnu)
 */
public record Prediction(double slopeCmPerMin, Double minutesToOverflow, int samples, Double levelCm) {

    /**
     * Niveau extrapolé à un horizon, à pente constante (jamais négatif). C'est la prévision
     * que l'historique des prédictions compare ensuite au niveau réellement mesuré.
     *
     * @param minutes horizon en minutes (0 = niveau courant)
     * @return le niveau prévu en cm, ou {@code null} si le niveau courant est inconnu
     */
    public Double levelAt(double minutes) {
        return levelCm == null ? null : Math.max(0.0, levelCm + slopeCmPerMin * minutes);
    }

    /** Prédiction vide (pas assez de données) ; conserve le niveau courant filtré. */
    public static Prediction none(int samples, Double levelCm) {
        return new Prediction(0.0, null, samples, levelCm);
    }
}

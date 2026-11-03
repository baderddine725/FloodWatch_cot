/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : Thresholds.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.alerting;

/**
 * Seuils d'alerte d'une station (configurables par station).
 *
 * @param criticalCm          hauteur d'eau critique (débordement / route impraticable), en cm
 * @param yellowPct           seuil jaune en % du niveau critique (30 par défaut)
 * @param orangePct           seuil orange en % du niveau critique (60 par défaut)
 * @param redPct              seuil rouge en % du niveau critique (85 par défaut)
 * @param rainThreshold       intensité de pluie (0..1) au-delà de laquelle la pluie est « détectée »
 * @param rapidRiseCmPerMin   vitesse de montée considérée comme rapide (passage en orange)
 * @param forecastRedMinutes  débordement prévu en moins de X minutes => rouge (10 par défaut)
 * @param reopenDelaySec      temporisation sous le seuil orange avant de quitter le rouge
 */
public record Thresholds(double criticalCm, double yellowPct, double orangePct, double redPct,
                         double rainThreshold, double rapidRiseCmPerMin, double forecastRedMinutes,
                         int reopenDelaySec) {

    public Thresholds {
        if (criticalCm <= 0) throw new IllegalArgumentException("criticalCm must be > 0");
        if (!(yellowPct < orangePct && orangePct < redPct && redPct <= 100)) {
            throw new IllegalArgumentException("thresholds must satisfy yellow < orange < red <= 100");
        }
        if (rapidRiseCmPerMin <= 0) throw new IllegalArgumentException("rapidRiseCmPerMin must be > 0");
        if (reopenDelaySec < 0) throw new IllegalArgumentException("reopenDelaySec must be >= 0");
    }

    /** Seuils par défaut de la Table 1 pour une hauteur critique donnée. */
    public static Thresholds defaults(double criticalCm) {
        return new Thresholds(criticalCm, 30, 60, 85, 0.2, 3.0, 10, 60);
    }

    /** @return le pourcentage du niveau critique atteint par {@code levelCm} */
    public double percent(double levelCm) {
        return levelCm / criticalCm * 100.0;
    }
}

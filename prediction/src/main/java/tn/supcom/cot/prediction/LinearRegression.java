/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : prediction – back-end & IoT
 *  Fichier   : LinearRegression.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.prediction;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.OptionalDouble;

/**
 * Régression linéaire par la méthode des moindres carrés : niveau = a·t + b.
 */
public final class LinearRegression {

    private LinearRegression() {
    }

    /**
     * Pente de la droite des moindres carrés, en cm par seconde.
     * <p>
     * a = Σ(tᵢ − t̄)(yᵢ − ȳ) / Σ(tᵢ − t̄)², avec t en secondes depuis la première mesure.
     *
     * @param samples mesures (dans n'importe quel ordre)
     * @return la pente, ou vide s'il y a moins de deux mesures ou si elles sont toutes au même instant
     */
    public static OptionalDouble slopeCmPerSecond(List<LevelSample> samples) {
        int n = samples.size();
        if (n < 2) {
            return OptionalDouble.empty();
        }
        Instant origin = samples.getFirst().at();
        double sumT = 0;
        double sumY = 0;
        for (LevelSample s : samples) {
            sumT += secondsSince(origin, s);
            sumY += s.levelCm();
        }
        double meanT = sumT / n;
        double meanY = sumY / n;
        double covariance = 0;
        double variance = 0;
        for (LevelSample s : samples) {
            double dt = secondsSince(origin, s) - meanT;
            covariance += dt * (s.levelCm() - meanY);
            variance += dt * dt;
        }
        if (variance == 0) {
            return OptionalDouble.empty();
        }
        return OptionalDouble.of(covariance / variance);
    }

    private static double secondsSince(Instant origin, LevelSample sample) {
        return Duration.between(origin, sample.at()).toNanos() / 1e9;
    }
}

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : prediction – back-end & IoT
 *  Fichier   : LinearRegressionTest.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.prediction;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static tn.supcom.cot.prediction.Samples.T0;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Tests de la régression linéaire (méthode des moindres carrés).
 */
@DisplayName("LinearRegression")
class LinearRegressionTest {

    private static final double EPS = 1e-9;

    @Test
    @DisplayName("droite parfaite : (0 s ; 0) (1 s ; 1) (2 s ; 2) → 1 cm/s")
    void perfectLine() {
        assertEquals(1.0, LinearRegression.slopeCmPerSecond(Samples.linear(0, 1, 1, 3)).orElseThrow(), EPS);
    }

    @Test
    @DisplayName("l'ordonnée à l'origine n'influence pas la pente")
    void interceptDoesNotMatter() {
        double low = LinearRegression.slopeCmPerSecond(Samples.linear(0, 0.5, 2, 10)).orElseThrow();
        double high = LinearRegression.slopeCmPerSecond(Samples.linear(300, 0.5, 2, 10)).orElseThrow();
        assertEquals(low, high, EPS);
        assertEquals(0.25, low, EPS);
    }

    @Test
    @DisplayName("deux mesures suffisent pour une pente")
    void twoPoints() {
        List<LevelSample> samples = List.of(new LevelSample(T0, 10), new LevelSample(T0.plusSeconds(60), 13));
        assertEquals(0.05, LinearRegression.slopeCmPerSecond(samples).orElseThrow(), EPS);
    }

    @Test
    @DisplayName("valeur connue sur des points non alignés")
    void knownValueOnScatteredPoints() {
        // t = 0, 1, 2, 3 ; y = 1, 3, 2, 4 → pente = 0,8 (calcul à la main)
        List<LevelSample> samples = List.of(new LevelSample(T0, 1), new LevelSample(T0.plusSeconds(1), 3),
                new LevelSample(T0.plusSeconds(2), 2), new LevelSample(T0.plusSeconds(3), 4));
        assertEquals(0.8, LinearRegression.slopeCmPerSecond(samples).orElseThrow(), EPS);
    }

    @Test
    @DisplayName("prend en compte les millisecondes")
    void subSecondPrecision() {
        List<LevelSample> samples = List.of(new LevelSample(T0, 0), new LevelSample(T0.plusMillis(500), 1),
                new LevelSample(T0.plusMillis(1000), 2));
        assertEquals(2.0, LinearRegression.slopeCmPerSecond(samples).orElseThrow(), EPS);
    }

    @Test
    @DisplayName("pente indéterminée : moins de deux mesures ou instants identiques")
    void undefinedSlope() {
        assertTrue(LinearRegression.slopeCmPerSecond(List.of()).isEmpty());
        assertTrue(LinearRegression.slopeCmPerSecond(List.of(new LevelSample(T0, 5))).isEmpty());
        assertTrue(LinearRegression.slopeCmPerSecond(
                List.of(new LevelSample(T0, 5), new LevelSample(T0, 9), new LevelSample(T0, 12))).isEmpty());
    }
}

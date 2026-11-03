/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : prediction – back-end & IoT
 *  Fichier   : FloodPredictorTest.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.prediction;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static tn.supcom.cot.prediction.Samples.T0;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * Tests du prédicteur : vitesse, temps restant, fenêtre des 10 mesures et gardes de l'alerte.
 */
@DisplayName("FloodPredictor")
class FloodPredictorTest {

    private static final double EPS = 1e-9;
    private static final double CRITICAL = 100.0;

    private final FloodPredictor predictor = new FloodPredictor();

    @Nested
    @DisplayName("vitesse de montée et temps restant")
    class SpeedAndEta {

        @Test
        @DisplayName("montée régulière de 2 cm/min : vitesse et temps restant exacts")
        void steadyRise() {
            // 10 mesures, une par minute, de 20 à 38 cm.
            Prediction p = predictor.predict(Samples.linear(20, 2, 60, 10), CRITICAL);
            assertEquals(2.0, p.riseSpeedCmPerMin(), EPS);
            assertEquals((CRITICAL - 38) / 2.0, p.minutesToOverflow().orElseThrow(), EPS);
            assertEquals(38.0, p.currentLevelCm(), EPS);
            assertEquals(0.38, p.fillRatio(), EPS);
            assertEquals(10, p.sampleCount());
        }

        @Test
        @DisplayName("formule du cahier des charges : (seuil − niveau) / vitesse")
        void etaFormula() {
            // 6 cm/min (0,2 cm toutes les 2 s), dernier niveau 81,8 cm.
            Prediction p = predictor.predict(Samples.linear(80, 0.2, 2, 10), CRITICAL);
            assertEquals(6.0, p.riseSpeedCmPerMin(), 1e-6);
            assertEquals((CRITICAL - 81.8) / 6.0, p.minutesToOverflow().orElseThrow(), 1e-6);
        }

        @Test
        @DisplayName("seules les 10 mesures les plus récentes comptent")
        void onlyLastTenSamples() {
            // 20 mesures stables à 10 cm, puis 10 mesures en montée de 1 cm/min.
            List<LevelSample> samples = new ArrayList<>(Samples.linear(10, 0, 60, 20));
            for (int i = 0; i < 10; i++) {
                samples.add(new LevelSample(T0.plusSeconds(60L * (20 + i)), 10 + i));
            }
            Prediction p = predictor.predict(samples, CRITICAL);
            assertEquals(1.0, p.riseSpeedCmPerMin(), EPS);
            assertEquals(10, p.sampleCount());
        }

        @Test
        @DisplayName("l'ordre des mesures fournies n'a pas d'importance, la liste n'est pas modifiée")
        void orderDoesNotMatter() {
            List<LevelSample> shuffled = new ArrayList<>(Samples.linear(30, 1.5, 30, 10));
            Collections.shuffle(shuffled, new Random(42));
            List<LevelSample> copy = List.copyOf(shuffled);
            Prediction p = predictor.predict(shuffled, CRITICAL);
            assertEquals(3.0, p.riseSpeedCmPerMin(), EPS);
            assertEquals(43.5, p.currentLevelCm(), EPS);
            assertEquals(copy, shuffled);
        }

        @Test
        @DisplayName("eau en baisse : vitesse négative, pas de débordement prévu")
        void fallingWater() {
            Prediction p = predictor.predict(Samples.linear(90, -1, 60, 10), CRITICAL);
            assertEquals(-1.0, p.riseSpeedCmPerMin(), EPS);
            assertFalse(p.overflowExpected());
            assertEquals(AlertDecision.NO_OVERFLOW_EXPECTED, p.decision());
        }

        @Test
        @DisplayName("montée imperceptible (≤ 0,05 cm/min) : eau considérée comme stable")
        void negligibleRise() {
            assertFalse(predictor.predict(Samples.linear(60, 0.04, 60, 10), CRITICAL).overflowExpected());
            assertTrue(predictor.predict(Samples.linear(60, 0.06, 60, 10), CRITICAL).overflowExpected());
        }

        @Test
        @DisplayName("seuil déjà atteint : temps restant nul, même si l'eau baisse")
        void alreadyOverflowing() {
            Prediction p = predictor.predict(Samples.linear(110, -0.5, 60, 10), CRITICAL);
            assertEquals(0.0, p.minutesToOverflow().orElseThrow(), EPS);
            assertEquals(AlertDecision.ALERT, p.decision());
        }

        @Test
        @DisplayName("moins de 3 mesures : pas de vitesse estimée")
        void tooFewSamplesForSpeed() {
            Prediction p = predictor.predict(Samples.linear(70, 10, 60, 2), CRITICAL);
            assertEquals(0.0, p.riseSpeedCmPerMin(), EPS);
            assertFalse(p.overflowExpected());
        }

        @Test
        @DisplayName("mesures toutes au même instant : vitesse nulle")
        void identicalTimestamps() {
            List<LevelSample> samples = List.of(new LevelSample(T0, 60), new LevelSample(T0, 70), new LevelSample(T0, 80));
            assertEquals(0.0, predictor.predict(samples, CRITICAL).riseSpeedCmPerMin(), EPS);
        }

        @Test
        @DisplayName("résiste au bruit du capteur à ultrasons (± 0,15 cm)")
        void robustToNoise() {
            Random random = new Random(7);
            List<LevelSample> samples = new ArrayList<>();
            for (int i = 0; i < 10; i++) {
                double noise = (random.nextDouble() * 2 - 1) * 0.15;
                samples.add(new LevelSample(T0.plusSeconds(2L * i), 60 + i * (5.0 / 30) + noise));
            }
            assertEquals(5.0, predictor.predict(samples, CRITICAL).riseSpeedCmPerMin(), 1.0);
        }
    }

    @Nested
    @DisplayName("gardes de l'alerte de prédiction")
    class Guards {

        @Test
        @DisplayName("débordement imminent à 20 % du seuil : pas d'alerte (niveau trop bas)")
        void levelTooLowEvenIfImminent() {
            // 45 cm/min à 20 cm : débordement prévu dans moins de 2 min, mais 20 % ≤ 50 %.
            Prediction p = predictor.predict(Samples.endingAt(20, 45, 10), CRITICAL);
            assertTrue(p.minutesToOverflow().orElseThrow() < 2);
            assertFalse(p.overflowAlert());
            assertEquals(AlertDecision.LEVEL_TOO_LOW, p.decision());
        }

        @ParameterizedTest(name = "niveau {0} cm sur 100 → {1}")
        @CsvSource({
                "50.0,  LEVEL_TOO_LOW",
                "50.01, ALERT",
                "70.0,  ALERT"
        })
        @DisplayName("le niveau doit DÉPASSER 50 % du seuil")
        void fillRatioBoundary(double endCm, AlertDecision expected) {
            assertEquals(expected, predictor.predict(Samples.endingAt(endCm, 8, 10), CRITICAL).decision());
        }

        @ParameterizedTest(name = "{0} mesure(s) → {1}")
        @CsvSource({
                "3, NOT_ENOUGH_SAMPLES",
                "4, NOT_ENOUGH_SAMPLES",
                "5, ALERT",
                "10, ALERT"
        })
        @DisplayName("au moins 5 mesures sont nécessaires pour alerter")
        void sampleCountBoundary(int count, AlertDecision expected) {
            assertEquals(expected, predictor.predict(Samples.endingAt(80, 8, count), CRITICAL).decision());
        }

        @Test
        @DisplayName("la garde du nombre de mesures prime sur celle du niveau")
        void guardOrder() {
            assertEquals(AlertDecision.NOT_ENOUGH_SAMPLES,
                    predictor.predict(Samples.endingAt(20, 8, 4), CRITICAL).decision());
        }

        @ParameterizedTest(name = "débordement dans {0} min → {1}")
        @CsvSource({
                "9.99,  ALERT",
                "10.01, OUTSIDE_WINDOW",
                "12.0,  OUTSIDE_WINDOW"
        })
        @DisplayName("alerte en dessous de la fenêtre de 10 min, pas au-delà")
        void windowBoundary(double minutes, AlertDecision expected) {
            // Vitesse 4 cm/min ; niveau final (toujours > 50 cm) choisi pour obtenir l'échéance voulue.
            double end = CRITICAL - 4 * minutes;
            Prediction p = predictor.predict(Samples.endingAt(end, 4, 10), CRITICAL);
            assertEquals(minutes, p.minutesToOverflow().orElseThrow(), 1e-6);
            assertEquals(expected, p.decision());
        }

        @Test
        @DisplayName("fenêtre d'alerte configurable par station")
        void customWindow() {
            FloodPredictor strict = new FloodPredictor(PredictorConfig.DEFAULTS.withAlertWindowMinutes(5));
            List<LevelSample> eightMinutes = Samples.endingAt(CRITICAL - 4 * 8, 4, 10);
            assertEquals(AlertDecision.ALERT, predictor.predict(eightMinutes, CRITICAL).decision());
            assertEquals(AlertDecision.OUTSIDE_WINDOW, strict.predict(eightMinutes, CRITICAL).decision());
        }
    }

    @Nested
    @DisplayName("scénario de crue du simulateur")
    class FloodScenario {

        @Test
        @DisplayName("aucune alerte avant 50 % ; alerte dès que les gardes le permettent")
        void noFalseAlarmAtLowLevel() {
            // Phases du simulateur (une mesure toutes les 2 s) : sec, pluie, montée, crue.
            double[][] phases = {{10, 0.0}, {15, 0.1}, {30, 1.0}, {30, 2.0}};
            List<LevelSample> history = new ArrayList<>();
            double level = 12;
            int step = 0;
            Double firstAlertLevel = null;
            for (double[] phase : phases) {
                for (int i = 0; i < phase[0]; i++, step++) {
                    level += phase[1];
                    history.add(new LevelSample(T0.plusSeconds(2L * step), level));
                    Prediction p = predictor.predict(history, CRITICAL);
                    if (level <= 50) {
                        assertFalse(p.overflowAlert(), "fausse alerte à " + level + " cm");
                    }
                    if (p.overflowAlert() && firstAlertLevel == null) {
                        firstAlertLevel = level;
                    }
                }
            }
            assertTrue(firstAlertLevel != null && firstAlertLevel > 50 && firstAlertLevel < 60,
                    "première alerte attendue juste au-dessus de 50 cm : " + firstAlertLevel);
        }
    }

    @Nested
    @DisplayName("validation des entrées")
    class Validation {

        @Test
        @DisplayName("liste vide ou nulle refusée")
        void emptySamples() {
            assertThrows(IllegalArgumentException.class, () -> predictor.predict(List.of(), CRITICAL));
            assertThrows(NullPointerException.class, () -> predictor.predict(null, CRITICAL));
        }

        @ParameterizedTest
        @ValueSource(doubles = {0, -10, Double.NaN, Double.POSITIVE_INFINITY})
        @DisplayName("seuil critique invalide refusé")
        void invalidCriticalLevel(double critical) {
            List<LevelSample> samples = Samples.linear(10, 1, 60, 5);
            assertThrows(IllegalArgumentException.class, () -> predictor.predict(samples, critical));
        }

        @Test
        @DisplayName("mesure invalide refusée")
        void invalidSample() {
            assertThrows(IllegalArgumentException.class, () -> new LevelSample(T0, Double.NaN));
            assertThrows(NullPointerException.class, () -> new LevelSample(null, 10));
        }

        @Test
        @DisplayName("configuration incohérente refusée")
        void invalidConfig() {
            assertThrows(IllegalArgumentException.class, () -> new PredictorConfig(10, 1, 5, 0.5, 10, 0.05));
            assertThrows(IllegalArgumentException.class, () -> new PredictorConfig(2, 3, 3, 0.5, 10, 0.05));
            assertThrows(IllegalArgumentException.class, () -> new PredictorConfig(10, 3, 11, 0.5, 10, 0.05));
            assertThrows(IllegalArgumentException.class, () -> new PredictorConfig(10, 3, 5, 1.0, 10, 0.05));
            assertThrows(IllegalArgumentException.class, () -> new PredictorConfig(10, 3, 5, 0.5, 0, 0.05));
            assertThrows(IllegalArgumentException.class, () -> new PredictorConfig(10, 3, 5, 0.5, 10, -1));
        }

        @Test
        @DisplayName("configuration par défaut conforme au cahier des charges")
        void defaults() {
            PredictorConfig d = new FloodPredictor().config();
            assertSame(PredictorConfig.DEFAULTS, d);
            assertEquals(10, d.windowSize());
            assertEquals(5, d.minSamplesForAlert());
            assertEquals(0.5, d.minFillRatioForAlert(), EPS);
            assertEquals(10.0, d.alertWindowMinutes(), EPS);
        }
    }
}

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : AlertEngineTest.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.alerting;

import org.junit.jupiter.api.Test;
import tn.supcom.cot.api.controllers.alerting.*;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** Tests unitaires du moteur d'alerte (niveaux de la Table 1, prédiction, hystérésis). */
class AlertEngineTest {
    private static final Instant T0 = Instant.parse("2026-11-02T10:00:00Z");
    private final Thresholds t = Thresholds.defaults(20.0);   // maquette : 20 cm critiques
    private final AlertEngine engine = new AlertEngine();

    private static List<Sample> flat(double level) {
        return List.of(new Sample(T0, level));
    }

    /** Série régulière : un échantillon toutes les {@code stepSec} secondes. */
    private static List<Sample> ramp(double start, double cmPerMin, int count, int stepSec) {
        var list = new ArrayList<Sample>();
        for (int i = 0; i < count; i++) {
            list.add(new Sample(T0.plusSeconds((long) i * stepSec), start + cmPerMin * i * stepSec / 60.0));
        }
        return list;
    }

    private AlertEngine.Result eval(List<Sample> h, double rain, AlertLevel prev, Instant below) {
        return engine.evaluate(t, h, rain, prev, below, h.get(h.size() - 1).ts());
    }

    @Test
    void greenWhenLowAndDry() {
        assertEquals(AlertLevel.GREEN, eval(flat(2), 0, AlertLevel.GREEN, null).level());
    }

    @Test
    void yellowOnRainOrThirtyPercent() {
        assertEquals(AlertLevel.YELLOW, eval(flat(2), 0.5, AlertLevel.GREEN, null).level());
        assertEquals(AlertLevel.YELLOW, eval(flat(7), 0, AlertLevel.GREEN, null).level()); // 35 %
    }

    @Test
    void orangeAtSixtyPercent() {
        assertEquals(AlertLevel.ORANGE, eval(flat(13), 0, AlertLevel.GREEN, null).level()); // 65 %
    }

    @Test
    void redAboveEightyFivePercent() {
        var r = eval(flat(18), 0, AlertLevel.ORANGE, null); // 90 %
        assertEquals(AlertLevel.RED, r.level());
        assertTrue(r.reasons().stream().anyMatch(s -> s.contains("90")));
    }

    @Test
    void orangeOnRapidRiseEvenWhenLow() {
        // 4 cm/min à partir de 1 cm : niveau encore < 30 % mais montée rapide
        var h = ramp(1, 4, 5, 10);
        var r = eval(h, 0, AlertLevel.GREEN, null);
        assertTrue(r.level().isAtLeast(AlertLevel.ORANGE), r.toString());
        assertEquals(4.0, r.prediction().slopeCmPerMin(), 0.01);
    }

    @Test
    void forecastAccuracyAndRedWhenOverflowImminent() {
        // 1 cm/min depuis 6 cm, 13 échantillons espacés de 10 s => niveau final 8 cm
        var h = ramp(6, 1.0, 13, 10);
        var r = eval(h, 0, AlertLevel.YELLOW, null);
        // il reste 12 cm à 1 cm/min => 12 min (objectif : erreur < 20 %)
        assertEquals(12.0, r.prediction().minutesToOverflow(), 12.0 * 0.2);
        assertNotEquals(AlertLevel.RED, r.level());
        // 2 cm/min depuis 6 cm => niveau ~10 cm, reste ~10 cm => ~5 min < 10 min => rouge
        var fast = eval(ramp(6, 2.0, 13, 10), 0, AlertLevel.ORANGE, null);
        assertEquals(AlertLevel.RED, fast.level());
    }

    @Test
    void noPredictionWhenFallingOrStable() {
        var r = eval(ramp(10, -1.0, 10, 10), 0, AlertLevel.YELLOW, null);
        assertNull(r.prediction().minutesToOverflow());
    }

    @Test
    void medianFilterIgnoresSingleSpike() {
        var h = new ArrayList<>(ramp(5, 0, 10, 10));
        h.set(5, new Sample(h.get(5).ts(), 19.5)); // écho parasite
        var r = eval(h, 0, AlertLevel.GREEN, null);
        assertEquals(0.0, r.prediction().slopeCmPerMin(), 0.01);
        assertNull(r.prediction().minutesToOverflow());
    }

    @Test
    void spikeOnLatestSampleDoesNotTriggerForecast() {
        // régression observée en test de bout en bout : écho parasite sur la dernière mesure
        var h = new ArrayList<>(ramp(1.5, 0, 6, 5));
        h.add(new Sample(h.get(h.size() - 1).ts().plusSeconds(5), 7.5));
        var r = eval(h, 0, AlertLevel.GREEN, null);
        assertEquals(AlertLevel.GREEN, r.level());
        assertNull(r.prediction().minutesToOverflow());
    }

    @Test
    void noPredictionOnTooShortSpan() {
        var r = eval(ramp(2, 30, 5, 1), 0, AlertLevel.GREEN, null); // 5 échantillons sur 4 s
        assertNull(r.prediction().minutesToOverflow());
    }

    @Test
    void forecastIgnoredBelowYellow() {
        // montée de 2 cm/min mais niveau encore à 20 % : orange au plus, pas de fermeture
        var r = eval(ramp(1, 2.0, 13, 10), 0, AlertLevel.GREEN, null);
        assertTrue(r.level() != AlertLevel.RED, r.toString());
    }

    @Test
    void slopeFollowsRecentTrendAfterPeak() {
        // régression observée : 3 min de montée puis 1 min 30 de décrue -> la pente doit être négative
        var h = new ArrayList<>(ramp(4, 4.0, 19, 10));            // 4 -> 16 cm en 3 min
        var peak = h.get(h.size() - 1);
        for (int i = 1; i <= 9; i++) {
            h.add(new Sample(peak.ts().plusSeconds(10L * i), peak.levelCm() - 0.5 * i));
        }
        var r = eval(h, 0, AlertLevel.RED, null);
        assertTrue(r.prediction().slopeCmPerMin() < 0, r.toString());
        assertNull(r.prediction().minutesToOverflow());
    }

    @Test
    void redIsHeldUntilBelowOrangeForReopenDelay() {
        // 55 % (sous orange) mais vient de redescendre : on reste rouge
        var now = T0;
        var r1 = engine.evaluate(t, flat(11), 0, AlertLevel.RED, now, now);
        assertEquals(AlertLevel.RED, r1.level());
        // 70 % : toujours au-dessus du seuil orange => rouge maintenu
        var r2 = engine.evaluate(t, flat(14), 0, AlertLevel.RED, null, now);
        assertEquals(AlertLevel.RED, r2.level());
        // 55 % depuis 61 s (> 60 s) => sortie du rouge
        var r3 = engine.evaluate(t, flat(11), 0, AlertLevel.RED, now.minusSeconds(61), now);
        assertEquals(AlertLevel.YELLOW, r3.level());
    }

    @Test
    void riskIndexIsBounded() {
        var low = eval(flat(0), 0, AlertLevel.GREEN, null);
        var high = eval(ramp(10, 5, 13, 10), 1.0, AlertLevel.ORANGE, null);
        assertTrue(low.riskIndex() >= 0 && low.riskIndex() < 10);
        assertTrue(high.riskIndex() > 80 && high.riskIndex() <= 100);
    }

    @Test
    void invalidThresholdsRejected() {
        assertThrows(IllegalArgumentException.class, () -> new Thresholds(20, 60, 30, 85, 0.2, 3, 10, 60));
    }
}

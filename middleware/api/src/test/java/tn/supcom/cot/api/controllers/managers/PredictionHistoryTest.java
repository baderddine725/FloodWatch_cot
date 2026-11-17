/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware (tests)
 *  Fichier   : PredictionHistoryTest.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-16          Modifié le : 2026-11-16
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.managers;

import org.junit.jupiter.api.Test;
import tn.supcom.cot.api.controllers.alerting.AlertEngine;
import tn.supcom.cot.api.controllers.alerting.LinearRegressionPredictor;
import tn.supcom.cot.api.controllers.alerting.MedianFilterPredictor;
import tn.supcom.cot.api.controllers.alerting.Prediction;
import tn.supcom.cot.api.entities.PredictionRecord;
import tn.supcom.cot.api.entities.PredictionStatus;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Historique des prédictions : horizons, cadence d'enregistrement, extrapolation et évaluation. */
class PredictionHistoryTest {
    private static final Instant T0 = Instant.parse("2026-11-16T10:00:00Z");

    @Test
    void horizonsAreSortedDeduplicatedAndValidated() {
        assertArrayEquals(new int[]{60, 180, 300, 600}, PredictionHistory.parseHorizons("60,180,300,600"));
        assertArrayEquals(new int[]{60, 300}, PredictionHistory.parseHorizons(" 300, 60 ,300 "));
        assertThrows(IllegalArgumentException.class, () -> PredictionHistory.parseHorizons(""));
        assertThrows(IllegalArgumentException.class, () -> PredictionHistory.parseHorizons("0,60"));
        assertThrows(IllegalArgumentException.class, () -> PredictionHistory.parseHorizons("60,abc"));
    }

    @Test
    void oneSeriesPerIntervalAndPerStation() {
        var history = new PredictionHistory(); // intervalle par défaut : 30 s
        var a = UUID.randomUUID();
        var b = UUID.randomUUID();
        assertTrue(history.due(a, T0));
        assertFalse(history.due(a, T0.plusSeconds(5)), "mode surveillance : une mesure toutes les 5 s");
        assertFalse(history.due(a, T0.plusSeconds(29)));
        assertTrue(history.due(b, T0.plusSeconds(5)), "les stations sont indépendantes");
        assertTrue(history.due(a, T0.plusSeconds(30)));
        assertFalse(history.due(a, T0.plusSeconds(31)));
    }

    @Test
    void forecastExtrapolatesTheSlopeAndNeverGoesNegative() {
        var rising = new Prediction(1.5, 4.0, 8, 12.0);
        assertEquals(12.0, rising.levelAt(0), 1e-9);
        assertEquals(16.5, rising.levelAt(3), 1e-9);
        var falling = new Prediction(-2.0, null, 8, 3.0);
        assertEquals(0.0, falling.levelAt(5), 1e-9, "une décrue ne descend pas sous zéro");
        var flat = Prediction.none(2, 7.0);
        assertEquals(7.0, flat.levelAt(10), 1e-9, "sans pente : le niveau courant est reconduit");
        assertNull(Prediction.none(0, null).levelAt(1));
    }

    @Test
    void modelIdentityFollowsTheDecoratorChain() {
        assertEquals("median+linreg-120s", new AlertEngine().modelId());
        var custom = new MedianFilterPredictor(new LinearRegressionPredictor(Duration.ofMinutes(5), 4, Duration.ofSeconds(15), 0.05));
        assertEquals("median+linreg-300s", custom.modelId(), "changer la fenêtre change l'identité du modèle");
    }

    @Test
    void scoringKeepsTheSignedError() {
        var late = new PredictionRecord(null, T0, 180, "m", 10.0, 12.0);
        assertEquals(PredictionStatus.PENDING, late.getStatus());
        assertEquals(T0.plusSeconds(180), late.getTargetAt());
        late.score(15.0);
        assertEquals(PredictionStatus.SCORED, late.getStatus());
        assertEquals(-3.0, late.getErrorCm(), 1e-9, "prévu 12, réel 15 : le modèle était en retard");

        var alarmist = new PredictionRecord(null, T0, 60, "m", 10.0, 14.0);
        alarmist.score(11.0);
        assertEquals(3.0, alarmist.getErrorCm(), 1e-9);

        var unseen = new PredictionRecord(null, T0, 60, "m", 10.0, 14.0);
        unseen.miss();
        assertEquals(PredictionStatus.MISSED, unseen.getStatus());
        assertNull(unseen.getErrorCm());
    }
}

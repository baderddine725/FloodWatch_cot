/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware (tests)
 *  Fichier   : ForecastModelTest.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-17          Modifié le : 2026-11-17
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.intelligence;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** Modèle réservoir, indice de risque, incertitude et liens amont du service de prévision. */
class ForecastModelTest {

    @Test
    void reservoirConvergesToItsEquilibrium() {
        var m = new ReservoirModel(8.0, 0.3, 0.0);
        double eq = m.equilibrium(0.5, 0.0);                       // 8·0,5 / 0,3 = 13,3 cm
        assertEquals(13.333, eq, 1e-3);
        double[] l = m.forecast(0.0, 0.5, t -> 0.0, new double[]{300, 600, 3600}, 30.0);
        assertTrue(l[0] < l[1] && l[1] < l[2], "montée monotone vers l'équilibre");
        assertEquals(eq, l[2], 0.2, "après 1 h (≈ 18 constantes de temps) : équilibre atteint");
        // solution exacte au bout de 5 min : L(t) = eq·(1 − e^(−b·t)), Euler à 10 s : écart < 1 %
        assertEquals(eq * (1 - Math.exp(-0.3 * 5)), l[0], 0.01 * eq);
    }

    @Test
    void reservoirUsesTheUpstreamAlreadyMeasuredAndClampsToTheSensor() {
        var m = new ReservoirModel(0.0, 0.25, 0.25);
        // amont à 20 cm pendant 8 min (déjà mesuré), puis à 0 : l'apport cesse
        double[] l = m.forecast(0.0, 0.0, t -> t < 480 ? 20.0 : 0.0, new double[]{480, 1800}, 30.0);
        assertTrue(l[0] > 5.0, "l'eau amont fait monter l'aval");
        assertTrue(l[1] < l[0], "puis l'aval se vide");
        double[] capped = new ReservoirModel(50.0, 0.0, 0.0).forecast(0.0, 1.0, t -> 0.0, new double[]{3600}, 28.0);
        assertEquals(28.0, capped[0], 1e-9, "jamais au-delà de la hauteur du capteur");
    }

    @Test
    void riskIsAnOrderedIndexBoundedByTheMeasuredError() {
        assertEquals(0.5, OverflowRisk.risk(20.0, 20.0, 2.0), 1e-6, "prévu au niveau critique : 1 chance sur 2");
        assertTrue(OverflowRisk.risk(25.0, 20.0, 2.0) > 0.99);
        assertTrue(OverflowRisk.risk(10.0, 20.0, 2.0) < 1e-5);
        assertTrue(OverflowRisk.risk(18.0, 20.0, 4.0) > OverflowRisk.risk(18.0, 20.0, 1.0),
                "plus l'erreur mesurée est grande, plus un niveau sous le critique reste risqué");
        assertEquals(OverflowRisk.risk(19.9, 20, 0.3), OverflowRisk.risk(19.9, 20, 0.0), 1e-12, "σ plancher");
        assertEquals(0.975, OverflowRisk.phi(1.959964), 1e-6);
        assertEquals("HIGH", OverflowRisk.label(0.6));
        assertEquals("MEDIUM", OverflowRisk.label(0.25));
        assertEquals("LOW", OverflowRisk.label(0.05));
    }

    @Test
    void sigmaIsMeasuredExtrapolatedOrDefaultedAndSaysWhich() {
        var measured = Map.of(1, 0.4, 5, 0.9, 10, 1.6);
        assertEquals(new ForecastService.Sigma(0.9, "measured"), ForecastService.sigmaFor(measured, 5));
        var far = ForecastService.sigmaFor(measured, 40);
        assertEquals("extrapolated-from-10min", far.basis());
        assertEquals(1.6 * 2.0, far.value(), 1e-9, "√(40/10) = 2");
        var none = ForecastService.sigmaFor(Map.of(), 15);
        assertEquals("default", none.basis());
        assertEquals(0.5 + 0.2 * 15, none.value(), 1e-9);
    }

    @Test
    void upstreamLinksAreParsedRobustly() {
        var links = ForecastService.parseLinks("wadi-01:300, upstream-01:480 ,broken,:5,x:abc");
        assertEquals(2, links.size());
        assertEquals("wadi-01", links.get(0).code());
        assertEquals(480.0, links.get(1).travelSec());
        assertTrue(ForecastService.parseLinks(null).isEmpty());
    }
}

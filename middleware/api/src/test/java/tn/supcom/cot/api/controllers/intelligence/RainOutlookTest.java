/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware (tests)
 *  Fichier   : RainOutlookTest.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-23          Modifié le : 2026-11-23
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.intelligence;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;

/** Entrée météo de la prévision : lecture d'Open-Meteo, raccord à la mesure, effet sur le modèle. */
class RainOutlookTest {
    private static final Instant NOW = Instant.parse("2026-11-23T09:05:00Z");

    /** Réponse au format d'Open-Meteo (minutely_15, GMT) : averse de 5 mm/15 min puis plus rien. */
    private static final String BODY = """
            {"latitude":36.86,"longitude":10.19,"utc_offset_seconds":0,"timezone":"GMT",
             "minutely_15_units":{"time":"iso8601","precipitation":"mm"},
             "minutely_15":{"time":["2026-11-23T09:00","2026-11-23T09:15","2026-11-23T09:30","2026-11-23T09:45"],
                            "precipitation":[2.5,5.0,null,0.0]}}""";

    @Test
    void readsOpenMeteoAndAlignsEachStepOnItsStart() {
        var o = WeatherService.parseOpenMeteo(BODY, NOW, 20.0).orElseThrow();
        // la valeur de 09:15 est le cumul de 09:00 à 09:15 : 5 mm en 15 min = 20 mm/h = 1,0
        assertEquals(1.0, o.at(Instant.parse("2026-11-23T09:10:00Z")), 1e-9);
        assertEquals(0.5, o.at(Instant.parse("2026-11-23T08:50:00Z")), 1e-9, "2,5 mm/15 min = 10 mm/h");
        assertEquals(0.0, o.at(Instant.parse("2026-11-23T09:20:00Z")), 1e-9, "null lu comme pas de pluie");
        assertEquals(0.0, o.at(Instant.parse("2026-11-23T11:00:00Z")), 1e-9, "au-delà : dernière valeur");
        assertEquals(40, o.coverageMinutes(NOW), "jusqu'à 09:45");
        assertEquals("open-meteo", o.source());
    }

    @Test
    void malformedOrEmptyResponsesGiveNoOutlook() {
        assertTrue(WeatherService.parseOpenMeteo("{\"error\":true}", NOW, 20).isEmpty());
        assertTrue(WeatherService.parseOpenMeteo(null, NOW, 20).isEmpty());
        assertTrue(WeatherService.parseOpenMeteo(
                "{\"minutely_15\":{\"time\":[\"2026-11-23T09:00\"],\"precipitation\":[1,2]}}", NOW, 20).isEmpty(),
                "tableaux de tailles différentes");
    }

    @Test
    void measuredRainWinsNowForecastWinsLater() {
        var dry = new RainOutlook("test", NOW, NOW, 900, new double[]{0.0});
        var rain = dry.blended(NOW, 0.8);
        assertEquals(0.8, rain.applyAsDouble(0), 1e-9, "à l'instant présent : la mesure du site");
        assertEquals(0.8 * Math.exp(-1), rain.applyAsDouble(900), 1e-9);
        assertTrue(rain.applyAsDouble(3600) < 0.02, "après 1 h : la prévision");
    }

    @Test
    void normalizationIsBoundedAndIgnoresNoise() {
        assertEquals(0.25, RainOutlook.normalize(1.25, 900, 20), 1e-9, "5 mm/h");
        assertEquals(1.0, RainOutlook.normalize(50, 900, 20), 1e-9);
        assertEquals(0.0, RainOutlook.normalize(-1, 900, 20), 1e-9);
        assertEquals(0.0, RainOutlook.normalize(Double.NaN, 900, 20), 1e-9);
    }

    @Test
    void aForecastOfRainStoppingLowersTheProjectedPeak() {
        var m = new ReservoirModel(8.0, 0.3, 0.0);
        double[] h = {900, 1800};
        double[] persistence = m.forecast(10.0, 0.8, t -> 0.0, h, 30.0);
        var stops = new RainOutlook("test", NOW, NOW, 900, new double[]{0.8, 0.0});
        double[] withOutlook = m.forecast(10.0, stops.blended(NOW, 0.8), t -> 0.0, h, 30.0);
        assertTrue(persistence[1] > 20.0, "pluie supposée constante : débordement prévu à 30 min");
        assertTrue(withOutlook[1] < persistence[1] - 5.0, "l'orage annoncé fini : pic projeté nettement plus bas");
    }
}

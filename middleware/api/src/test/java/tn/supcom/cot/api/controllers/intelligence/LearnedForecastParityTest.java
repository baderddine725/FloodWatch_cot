/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware (tests)
 *  Fichier   : LearnedForecastParityTest.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-23          Modifié le : 2026-11-23
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.intelligence;

import jakarta.json.Json;
import jakarta.json.JsonArray;
import jakarta.json.JsonNumber;
import jakarta.json.JsonObject;
import jakarta.json.JsonValue;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.InputStreamReader;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Le middleware calcule les indicateurs et les prévisions EXACTEMENT comme l'apprentissage Python :
 * mêmes mesures, mêmes valeurs à l'octet ({@code forecast_parity.json}, produit par
 * {@code python -m forecast.pipeline fixture} et contrôlé côté Python par {@code ml/tests/test_forecast.py}).
 */
class LearnedForecastParityTest {
    private static JsonObject fixture;
    private static Map<String, LearnedFeatures.Site> sites;
    private static Map<String, LearnedFeatures.Series> data;
    private static LearnedModel model;

    @BeforeAll
    static void load() throws Exception {
        try (var in = LearnedForecastParityTest.class.getResourceAsStream("/forecast_parity.json");
             var r = Json.createReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            fixture = r.readObject();
        }
        sites = new HashMap<>();
        for (var e : fixture.getJsonObject("sites").entrySet()) {
            var v = e.getValue().asJsonObject();
            var ups = new ArrayList<LearnedFeatures.Upstream>();
            for (var u : v.getJsonArray("upstream").getValuesAs(JsonArray.class)) {
                ups.add(new LearnedFeatures.Upstream(u.getString(0), u.getJsonNumber(1).doubleValue()));
            }
            sites.put(e.getKey(), new LearnedFeatures.Site(e.getKey(), v.getJsonNumber("criticalCm").doubleValue(),
                    v.getJsonNumber("sensorHeightCm").doubleValue(), List.copyOf(ups)));
        }
        var rows = new HashMap<String, List<double[]>>();
        for (var m : fixture.getJsonArray("measurements").getValuesAs(JsonArray.class)) {
            rows.computeIfAbsent(m.getString(0), k -> new ArrayList<>()).add(new double[]{
                    m.getJsonNumber(1).doubleValue(), m.getJsonNumber(2).doubleValue(), m.getJsonNumber(3).doubleValue()});
        }
        data = new HashMap<>();
        rows.forEach((code, list) -> data.put(code, LearnedFeatures.series(list)));
        model = LearnedModel.read(new StringReader(fixture.getJsonObject("model").toString()));
    }

    @Test
    void featuresAndPredictionsAreIdenticalToPython() {
        int usable = 0;
        for (var c : fixture.getJsonArray("cases").getValuesAs(JsonObject.class)) {
            var site = sites.get(c.getString("code"));
            double t = c.getJsonNumber("t").doubleValue();
            int sec = c.getInt("sec");
            double[] f = LearnedFeatures.features(site, t, sec, data);
            String where = c.getString("code") + " t=" + t + " h=" + sec;
            if (c.get("features").getValueType() == JsonValue.ValueType.NULL) {
                assertNull(f, where);
                continue;
            }
            var expected = c.getJsonArray("features").getValuesAs(JsonNumber.class).stream()
                    .mapToDouble(JsonNumber::doubleValue).toArray();
            assertArrayEquals(expected, f, 0.0, where);
            assertEquals(c.getJsonNumber("delta").doubleValue(), model.delta(sec, f), 0.0, where);
            usable++;
        }
        assertTrue(usable >= 10, "trop peu de cas exploitables : " + usable);
    }

    @Test
    void unknownHorizonsAreInterpolatedAndOutOfRangeOnesRefused() {
        double[] x = new double[LearnedFeatures.FEATURES.size()];
        double d300 = model.delta(300, x);
        double d1800 = model.delta(1800, x);
        assertEquals(d300, model.deltaAt(300, h -> x), 0.0);
        assertEquals(d300 / 2, model.deltaAt(150, h -> x), 1e-12);                 // 0 s → 300 s
        assertEquals(d300 + (d1800 - d300) * 0.5, model.deltaAt(1050, h -> x), 1e-12);
        assertNull(model.deltaAt(1801, h -> x));
        assertNull(model.deltaAt(0, h -> x));
        assertNull(model.deltaAt(600, h -> null));                                 // historique insuffisant
    }

    @Test
    void incompatibleModelsAreRejected() {
        var wrongFeatures = fixture.getJsonObject("model").toString().replace("\"level_cm\"", "\"level_mm\"");
        assertThrows(IllegalArgumentException.class, () -> LearnedModel.read(new StringReader(wrongFeatures)));
        var wrongFormat = fixture.getJsonObject("model").toString().replace("floodwatch-gbt/1", "other/9");
        assertThrows(IllegalArgumentException.class, () -> LearnedModel.read(new StringReader(wrongFormat)));
    }

    @Test
    void championServesOnlyWhenItsMeasuredErrorIsLower() {
        assertFalse(ForecastService.beats(Map.of(), Map.of(1, 1.0)));                 // pas encore noté
        assertTrue(ForecastService.beats(Map.of(1, 0.5, 5, 2.0), Map.of()));           // en place non notée
        assertTrue(ForecastService.beats(Map.of(1, 0.5, 5, 2.0), Map.of(1, 0.6, 5, 2.1, 10, 9.0)));
        assertFalse(ForecastService.beats(Map.of(1, 0.5, 5, 2.5), Map.of(1, 0.6, 5, 2.1)));
        assertFalse(ForecastService.beats(Map.of(15, 1.0), Map.of(1, 2.0)));           // aucun horizon commun
    }
}

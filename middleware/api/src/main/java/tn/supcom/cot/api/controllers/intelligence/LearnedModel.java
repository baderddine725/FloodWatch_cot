/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware (intelligence Cloud)
 *  Fichier   : LearnedModel.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-23          Modifié le : 2026-11-23
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.intelligence;

import jakarta.json.Json;
import jakarta.json.JsonArray;
import jakarta.json.JsonObject;

import java.io.Reader;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Modèle de prévision appris (format {@code floodwatch-gbt/1}, produit par {@code ml/forecast/pipeline.py}) :
 * un ensemble d'arbres renforcés par gradient par horizon, qui prédit la VARIATION du niveau.
 * <p>Même règle que scikit-learn : indicateurs convertis en float32, {@code x <= seuil} à gauche,
 * {@code init + taux × Σ feuilles} sommé en double dans l'ordre des arbres.</p>
 */
public final class LearnedModel {
    public static final String FORMAT = "floodwatch-gbt/1";

    private record Tree(int[] feature, double[] threshold, int[] left, int[] right, double[] value) {
        double leaf(float[] x) {
            int i = 0;
            while (feature[i] >= 0) {
                i = x[feature[i]] <= threshold[i] ? left[i] : right[i];
            }
            return value[i];
        }
    }

    private record Ensemble(double init, double learningRate, List<Tree> trees) {
        double predict(double[] x) {
            float[] xf = new float[x.length];
            for (int i = 0; i < x.length; i++) xf[i] = (float) x[i];
            double out = init;
            for (Tree t : trees) out += learningRate * t.leaf(xf);
            return out;
        }
    }

    private final String modelId;
    private final String createdAt;
    private final String datasetId;
    private final TreeMap<Integer, Ensemble> horizons = new TreeMap<>();
    private final JsonObject metrics;

    private LearnedModel(JsonObject json) {
        if (!FORMAT.equals(json.getString("format", ""))) {
            throw new IllegalArgumentException("format de modèle inconnu : " + json.getString("format", "?"));
        }
        var names = json.getJsonArray("features").getValuesAs(jakarta.json.JsonString.class).stream()
                .map(jakarta.json.JsonString::getString).toList();
        if (!names.equals(LearnedFeatures.FEATURES)) {
            throw new IllegalArgumentException("indicateurs différents de ceux du middleware : " + names);
        }
        this.modelId = json.getString("modelId");
        this.createdAt = json.getString("createdAt", null);
        this.datasetId = json.containsKey("dataset") && !json.isNull("dataset")
                ? json.getJsonObject("dataset").getString("id", null) : null;
        this.metrics = json.containsKey("metrics") ? json.getJsonObject("metrics") : null;
        for (var h : json.getJsonArray("horizons").getValuesAs(JsonObject.class)) {
            var trees = new ArrayList<Tree>();
            for (var t : h.getJsonArray("trees").getValuesAs(JsonObject.class)) {
                trees.add(new Tree(ints(t.getJsonArray("f")), doubles(t.getJsonArray("t")), ints(t.getJsonArray("l")),
                        ints(t.getJsonArray("r")), doubles(t.getJsonArray("v"))));
            }
            horizons.put(h.getInt("sec"), new Ensemble(h.getJsonNumber("init").doubleValue(),
                    h.getJsonNumber("learningRate").doubleValue(), List.copyOf(trees)));
        }
        if (horizons.isEmpty()) throw new IllegalArgumentException("modèle sans horizon");
    }

    public static LearnedModel read(Reader reader) {
        try (var r = Json.createReader(reader)) {
            return new LearnedModel(r.readObject());
        }
    }

    private static int[] ints(JsonArray a) {
        int[] out = new int[a.size()];
        for (int i = 0; i < out.length; i++) out[i] = a.getInt(i);
        return out;
    }

    private static double[] doubles(JsonArray a) {
        double[] out = new double[a.size()];
        for (int i = 0; i < out.length; i++) out[i] = a.getJsonNumber(i).doubleValue();
        return out;
    }

    public String modelId() {
        return modelId;
    }

    public String createdAt() {
        return createdAt;
    }

    public String datasetId() {
        return datasetId;
    }

    public JsonObject metrics() {
        return metrics;
    }

    public int maxHorizonSec() {
        return horizons.lastKey();
    }

    public List<Integer> horizonsSec() {
        return List.copyOf(horizons.keySet());
    }

    /** Variation prévue (cm) à un horizon appris, à partir de ses indicateurs. */
    public double delta(int horizonSec, double[] x) {
        var e = horizons.get(horizonSec);
        if (e == null) throw new IllegalArgumentException("horizon non appris : " + horizonSec);
        return e.predict(x);
    }

    /**
     * Variation prévue à un horizon quelconque de ]0, horizon max] : horizon appris tel quel, sinon
     * interpolation linéaire entre les deux horizons appris voisins (variation nulle à 0 s).
     *
     * @param featuresAt indicateurs pour un horizon appris (ils dépendent de l'horizon), ou null
     * @return la variation, ou null si l'horizon dépasse le modèle ou si un indicateur manque
     */
    public Double deltaAt(int horizonSec, java.util.function.IntFunction<double[]> featuresAt) {
        if (horizonSec <= 0 || horizonSec > maxHorizonSec()) return null;
        Map.Entry<Integer, Ensemble> hi = horizons.ceilingEntry(horizonSec);
        double[] xh = featuresAt.apply(hi.getKey());
        if (xh == null) return null;
        double dHi = hi.getValue().predict(xh);
        if (hi.getKey() == horizonSec) return dHi;
        Map.Entry<Integer, Ensemble> lo = horizons.lowerEntry(horizonSec);
        int loSec = lo == null ? 0 : lo.getKey();
        double dLo = 0.0;
        if (lo != null) {
            double[] xl = featuresAt.apply(loSec);
            if (xl == null) return null;
            dLo = lo.getValue().predict(xl);
        }
        double w = (horizonSec - loSec) / (double) (hi.getKey() - loSec);
        return dLo + w * (dHi - dLo);
    }
}

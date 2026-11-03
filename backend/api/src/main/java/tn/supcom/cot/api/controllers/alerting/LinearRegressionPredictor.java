/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : LinearRegressionPredictor.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.alerting;

import java.time.Duration;
import java.util.List;

/**
 * Estimation par vitesse de montée : régression linéaire (moindres carrés) du niveau
 * en fonction du temps sur une fenêtre glissante, puis extrapolation jusqu'au niveau critique.
 */
public class LinearRegressionPredictor implements OverflowPredictor {
    private final Duration window;
    private final int minSamples;
    private final Duration minSpan;
    private final double minSlopeCmPerMin;

    /**
     * @param window           fenêtre d'observation (ex. 5 min)
     * @param minSamples       nombre minimal d'échantillons pour prédire
     * @param minSpan          durée minimale couverte par les échantillons (évite les pentes
     *                         calculées sur quelques secondes de bruit)
     * @param minSlopeCmPerMin pente minimale considérée comme une montée
     */
    public LinearRegressionPredictor(Duration window, int minSamples, Duration minSpan, double minSlopeCmPerMin) {
        this.window = window;
        this.minSamples = minSamples;
        this.minSpan = minSpan;
        this.minSlopeCmPerMin = minSlopeCmPerMin;
    }

    /** Paramètres par défaut : fenêtre 2 min (suit la tendance récente), 4 échantillons sur au moins 15 s, pente minimale 0,05 cm/min. */
    public LinearRegressionPredictor() {
        this(Duration.ofMinutes(2), 4, Duration.ofSeconds(15), 0.05);
    }

    @Override
    public Prediction predict(List<Sample> samples, double criticalCm) {
        if (samples.isEmpty()) return Prediction.none(0, null);
        var last = samples.get(samples.size() - 1);
        var from = last.ts().minus(window);
        var recent = samples.stream().filter(s -> !s.ts().isBefore(from)).toList();
        int n = recent.size();
        if (n < minSamples) return Prediction.none(n, last.levelCm());
        if (Duration.between(recent.get(0).ts(), last.ts()).compareTo(minSpan) < 0) return Prediction.none(n, last.levelCm());

        // x = temps en minutes relativement à la dernière mesure (x <= 0)
        double sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (var s : recent) {
            double x = (s.ts().toEpochMilli() - last.ts().toEpochMilli()) / 60000.0;
            double y = s.levelCm();
            sx += x;
            sy += y;
            sxx += x * x;
            sxy += x * y;
        }
        double denom = n * sxx - sx * sx;
        if (Math.abs(denom) < 1e-9) return Prediction.none(n, last.levelCm());
        double slope = (n * sxy - sx * sy) / denom;          // cm/min
        double intercept = (sy - slope * sx) / n;            // niveau ajusté à x = 0
        double current = Math.max(intercept, last.levelCm());

        Double ttf;
        if (current >= criticalCm) {
            ttf = 0.0;
        } else if (slope >= minSlopeCmPerMin) {
            ttf = (criticalCm - current) / slope;
        } else {
            ttf = null;
        }
        return new Prediction(slope, ttf, n, last.levelCm());
    }
}

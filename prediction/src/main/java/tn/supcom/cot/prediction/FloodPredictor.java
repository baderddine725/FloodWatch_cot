/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : prediction – back-end & IoT
 *  Fichier   : FloodPredictor.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.prediction;

import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.OptionalDouble;

/**
 * Prédit le débordement d'une station à partir de ses dernières mesures.
 * <ol>
 *   <li>garde les {@link PredictorConfig#windowSize()} mesures les plus récentes (10) ;</li>
 *   <li>vitesse de montée = pente de la régression linéaire sur ces mesures (au moins 3) ;</li>
 *   <li>temps restant = (seuil critique − niveau actuel) / vitesse, si l'eau monte ;</li>
 *   <li>alerte si ce temps est inférieur à {@link PredictorConfig#alertWindowMinutes()} (10 min),
 *       seulement si au moins 5 mesures sont disponibles ET que le niveau dépasse 50 % du seuil.</li>
 * </ol>
 * La classe est sans état et immuable : une instance peut être partagée entre threads.
 */
public final class FloodPredictor {

    private static final double SECONDS_PER_MINUTE = 60.0;

    private final PredictorConfig config;

    /**
     * Prédicteur avec les paramètres du cahier des charges ({@link PredictorConfig#DEFAULTS}).
     */
    public FloodPredictor() {
        this(PredictorConfig.DEFAULTS);
    }

    /**
     * Prédicteur avec des paramètres personnalisés.
     *
     * @param config paramètres
     */
    public FloodPredictor(PredictorConfig config) {
        this.config = Objects.requireNonNull(config, "config");
    }

    /**
     * Paramètres utilisés.
     *
     * @return la configuration
     */
    public PredictorConfig config() {
        return config;
    }

    /**
     * Calcule la prédiction pour une station.
     *
     * @param samples         mesures récentes de la station, dans n'importe quel ordre (la liste n'est pas modifiée)
     * @param criticalLevelCm seuil critique de la station (cm)
     * @return vitesse, temps restant et décision d'alerte
     * @throws IllegalArgumentException si la liste est vide ou si le seuil n'est pas strictement positif
     */
    public Prediction predict(List<LevelSample> samples, double criticalLevelCm) {
        Objects.requireNonNull(samples, "samples");
        if (samples.isEmpty()) {
            throw new IllegalArgumentException("Au moins une mesure est nécessaire");
        }
        if (!Double.isFinite(criticalLevelCm) || criticalLevelCm <= 0) {
            throw new IllegalArgumentException("Seuil critique invalide : " + criticalLevelCm);
        }

        List<LevelSample> window = mostRecent(samples);
        int count = window.size();
        double currentLevel = window.getLast().levelCm();
        double fillRatio = currentLevel / criticalLevelCm;

        double speed = 0.0;
        if (count >= config.minSamplesForSpeed()) {
            speed = LinearRegression.slopeCmPerSecond(window).orElse(0.0) * SECONDS_PER_MINUTE;
        }

        OptionalDouble minutesToOverflow;
        if (currentLevel >= criticalLevelCm) {
            minutesToOverflow = OptionalDouble.of(0.0);
        } else if (speed > config.minRiseCmPerMin()) {
            minutesToOverflow = OptionalDouble.of((criticalLevelCm - currentLevel) / speed);
        } else {
            minutesToOverflow = OptionalDouble.empty();
        }

        AlertDecision decision = decide(count, fillRatio, minutesToOverflow);
        return new Prediction(speed, minutesToOverflow, count, currentLevel, fillRatio, decision);
    }

    private AlertDecision decide(int count, double fillRatio, OptionalDouble minutesToOverflow) {
        if (count < config.minSamplesForAlert()) {
            return AlertDecision.NOT_ENOUGH_SAMPLES;
        }
        if (fillRatio <= config.minFillRatioForAlert()) {
            return AlertDecision.LEVEL_TOO_LOW;
        }
        if (minutesToOverflow.isEmpty()) {
            return AlertDecision.NO_OVERFLOW_EXPECTED;
        }
        if (minutesToOverflow.getAsDouble() >= config.alertWindowMinutes()) {
            return AlertDecision.OUTSIDE_WINDOW;
        }
        return AlertDecision.ALERT;
    }

    private List<LevelSample> mostRecent(List<LevelSample> samples) {
        List<LevelSample> sorted = samples.stream().sorted(Comparator.comparing(LevelSample::at)).toList();
        return sorted.subList(Math.max(0, sorted.size() - config.windowSize()), sorted.size());
    }
}

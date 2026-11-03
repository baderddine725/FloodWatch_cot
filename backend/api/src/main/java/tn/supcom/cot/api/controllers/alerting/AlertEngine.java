/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : AlertEngine.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.alerting;

import java.time.Instant;
import java.util.List;

/**
 * Façade du moteur d'alerte : prédiction (Strategy + Decorator) puis évaluation par la
 * chaîne de règles (Chain of Responsibility). Classe sans dépendance Jakarta EE,
 * entièrement testable unitairement.
 */
public class AlertEngine {
    private final OverflowPredictor predictor;
    private final AlertRuleHandler chain;

    /** Moteur par défaut : régression linéaire décorée d'un filtre médian. */
    public AlertEngine() {
        this(new MedianFilterPredictor(new LinearRegressionPredictor()));
    }

    public AlertEngine(OverflowPredictor predictor) {
        this.predictor = predictor;
        AlertRuleHandler head = new AlertRules.LevelThresholdRule();
        head.linkWith(new AlertRules.RainRule())
                .linkWith(new AlertRules.RapidRiseRule())
                .linkWith(new AlertRules.OverflowForecastRule())
                .linkWith(new AlertRules.RedHysteresisRule());
        this.chain = head;
    }

    /**
     * Résultat complet d'une évaluation.
     *
     * @param levelCm niveau courant retenu (filtré des échos parasites)
     */
    public record Result(AlertLevel level, List<String> reasons, Prediction prediction, int riskIndex, double levelCm) {
    }

    /**
     * Évalue le niveau d'alerte d'une station.
     *
     * @param thresholds       seuils de la station
     * @param history          historique récent trié (la dernière valeur est la mesure courante)
     * @param rain             intensité de pluie (0..1)
     * @param previous         niveau précédent
     * @param belowOrangeSince instant de passage sous le seuil orange (ou null)
     * @param now              instant courant
     */
    public Result evaluate(Thresholds thresholds, List<Sample> history, double rain,
                           AlertLevel previous, Instant belowOrangeSince, Instant now) {
        if (history.isEmpty()) throw new IllegalArgumentException("history must contain the current sample");
        var prediction = predictor.predict(history, thresholds.criticalCm());
        double raw = history.get(history.size() - 1).levelCm();
        double level = prediction.levelCm() != null ? prediction.levelCm() : raw;
        var ctx = new EvaluationContext(thresholds, level, rain, prediction,
                previous == null ? AlertLevel.GREEN : previous, belowOrangeSince, now);
        var eval = new Evaluation();
        chain.handle(ctx, eval);
        return new Result(eval.level(), eval.reasons(), prediction, RiskIndex.compute(ctx), level);
    }
}

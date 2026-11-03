/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : AlertRules.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.alerting;

import java.time.Duration;
import java.util.Locale;

/**
 * Règles concrètes de la chaîne d'évaluation (Table 1 du cahier des charges).
 */
public final class AlertRules {
    private AlertRules() {
    }

    /** Seuils de niveau : jaune 30 %, orange 60 %, rouge 85 % (configurables). */
    public static final class LevelThresholdRule extends AlertRuleHandler {
        @Override
        protected void apply(EvaluationContext ctx, Evaluation eval) {
            var t = ctx.thresholds();
            double pct = ctx.percent();
            String msg = String.format(Locale.ROOT, "niveau %.0f %% du seuil critique", pct);
            if (pct >= t.redPct()) eval.raise(AlertLevel.RED, msg);
            else if (pct >= t.orangePct()) eval.raise(AlertLevel.ORANGE, msg);
            else if (pct >= t.yellowPct()) eval.raise(AlertLevel.YELLOW, msg);
        }
    }

    /** Pluie détectée : surveillance renforcée (jaune). */
    public static final class RainRule extends AlertRuleHandler {
        @Override
        protected void apply(EvaluationContext ctx, Evaluation eval) {
            if (ctx.rain() >= ctx.thresholds().rainThreshold()) {
                eval.raise(AlertLevel.YELLOW, String.format(Locale.ROOT, "pluie détectée (%.0f %%)", ctx.rain() * 100));
            }
        }
    }

    /** Montée rapide : orange. */
    public static final class RapidRiseRule extends AlertRuleHandler {
        @Override
        protected void apply(EvaluationContext ctx, Evaluation eval) {
            double slope = ctx.prediction().slopeCmPerMin();
            if (slope >= ctx.thresholds().rapidRiseCmPerMin()) {
                eval.raise(AlertLevel.ORANGE, String.format(Locale.ROOT, "montée rapide (%.1f cm/min)", slope));
            }
        }
    }

    /**
     * Débordement prévu en moins de N minutes : rouge. La prévision n'est prise en compte
     * qu'au-delà du seuil jaune (présence d'eau significative), pour ne pas fermer une route
     * sur une simple fluctuation près du fond.
     */
    public static final class OverflowForecastRule extends AlertRuleHandler {
        @Override
        protected void apply(EvaluationContext ctx, Evaluation eval) {
            if (ctx.percent() < ctx.thresholds().yellowPct()) return;
            Double ttf = ctx.prediction().minutesToOverflow();
            if (ttf != null && ttf <= ctx.thresholds().forecastRedMinutes()) {
                eval.raise(AlertLevel.RED, String.format(Locale.ROOT, "débordement prévu dans %.1f min", ttf));
            }
        }
    }

    /**
     * Hystérésis de sortie du rouge : la réouverture n'a lieu qu'après un retour du niveau
     * sous le seuil orange pendant la temporisation configurée (§ 1.4).
     */
    public static final class RedHysteresisRule extends AlertRuleHandler {
        @Override
        protected void apply(EvaluationContext ctx, Evaluation eval) {
            if (ctx.previous() != AlertLevel.RED || eval.level() == AlertLevel.RED) return;
            var t = ctx.thresholds();
            if (ctx.percent() >= t.orangePct()) {
                eval.hold(AlertLevel.RED, "maintien rouge : niveau encore au-dessus du seuil orange");
                return;
            }
            var since = ctx.belowOrangeSince();
            long elapsed = since == null ? 0 : Duration.between(since, ctx.now()).toSeconds();
            if (elapsed < t.reopenDelaySec()) {
                eval.hold(AlertLevel.RED, "maintien rouge : temporisation de réouverture ("
                        + elapsed + "/" + t.reopenDelaySec() + " s)");
            }
        }
    }
}

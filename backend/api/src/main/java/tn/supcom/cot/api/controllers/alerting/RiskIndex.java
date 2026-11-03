/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : RiskIndex.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.alerting;

/**
 * Indice de risque à court terme (0..100) combinant le niveau, la vitesse de montée,
 * la pluie et le temps estimé avant débordement.
 */
public final class RiskIndex {
    private RiskIndex() {
    }

    /** Calcule l'indice de risque. */
    public static int compute(EvaluationContext ctx) {
        double pct = Math.max(0, Math.min(100, ctx.percent()));
        double score = 0.6 * pct;
        double slope = ctx.prediction().slopeCmPerMin();
        if (slope > 0) score += 25 * Math.min(1.0, slope / ctx.thresholds().rapidRiseCmPerMin());
        score += 15 * Math.max(0, Math.min(1.0, ctx.rain()));
        Double ttf = ctx.prediction().minutesToOverflow();
        if (ttf != null && ttf < 30) score += 20 * (30 - ttf) / 30.0;
        return (int) Math.round(Math.max(0, Math.min(100, score)));
    }
}

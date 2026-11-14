/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : AlertRuleHandler.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.alerting;

/**
 * Maillon de la chaîne d'évaluation des alertes (patron Chain of Responsibility).
 * Chaque règle enrichit l'évaluation puis passe la main au maillon suivant.
 */
public abstract class AlertRuleHandler {
    private AlertRuleHandler next;

    /** Chaîne un maillon et le retourne (écriture fluide). */
    public AlertRuleHandler linkWith(AlertRuleHandler next) {
        this.next = next;
        return next;
    }

    /** Applique la règle puis délègue au maillon suivant. */
    public final void handle(EvaluationContext ctx, Evaluation eval) {
        apply(ctx, eval);
        if (next != null) next.handle(ctx, eval);
    }

    /** Logique propre à la règle. */
    protected abstract void apply(EvaluationContext ctx, Evaluation eval);
}

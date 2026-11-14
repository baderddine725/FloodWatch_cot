/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : Evaluation.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.alerting;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Résultat (mutable pendant la traversée de la chaîne) de l'évaluation d'alerte.
 */
public final class Evaluation {
    private AlertLevel level = AlertLevel.GREEN;
    private final List<String> reasons = new ArrayList<>();

    /** Élève le niveau si {@code candidate} est plus grave, en mémorisant la raison. */
    public void raise(AlertLevel candidate, String reason) {
        if (candidate.ordinal() > level.ordinal()) {
            level = candidate;
        }
        if (candidate != AlertLevel.GREEN) reasons.add(reason);
    }

    /** Force un niveau (utilisé par la règle d'hystérésis). */
    public void hold(AlertLevel held, String reason) {
        level = held;
        reasons.add(reason);
    }

    public AlertLevel level() {
        return level;
    }

    public List<String> reasons() {
        return Collections.unmodifiableList(reasons);
    }
}

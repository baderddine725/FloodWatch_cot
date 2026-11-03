/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : AlertLevel.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.alerting;

/**
 * Niveaux d'alerte FloodWatch (Table 1 du cahier des charges), ordonnés par gravité.
 */
public enum AlertLevel {
    GREEN, YELLOW, ORANGE, RED;

    /** @return le plus grave des deux niveaux */
    public static AlertLevel max(AlertLevel a, AlertLevel b) {
        if (a == null) return b;
        if (b == null) return a;
        return a.ordinal() >= b.ordinal() ? a : b;
    }

    /** @return vrai si ce niveau est au moins aussi grave que {@code other} */
    public boolean isAtLeast(AlertLevel other) {
        return ordinal() >= other.ordinal();
    }

    /** @return le libellé français du niveau */
    public String label() {
        return switch (this) {
            case GREEN -> "Vert";
            case YELLOW -> "Jaune";
            case ORANGE -> "Orange";
            case RED -> "Rouge";
        };
    }
}

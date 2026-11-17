/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : SensorVerdict.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-16          Modifié le : 2026-11-16
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.entities;

/** Sort réservé à une lecture du capteur de niveau par la chaîne de filtrage. */
public enum SensorVerdict {
    /** Lecture retenue : elle a produit une mesure. */
    ACCEPTED,
    /** Écho parasite écarté par la passerelle (valeur plausible mais isolée). */
    OUTLIER,
    /** Capteur en défaut ou valeur physiquement impossible. */
    FAULT
}

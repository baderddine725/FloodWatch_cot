/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : AlertType.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.entities;

/** Nature d'une alerte. */
public enum AlertType {
    /** Niveau d'eau / prévision (orange ou rouge). */
    LEVEL,
    /** Station muette : 3 messages de vie manqués. */
    OFFLINE,
    /** Mesure incohérente ou capteur signalé défaillant. */
    SENSOR_FAULT,
    /** Fermeture autonome déclenchée par la règle de sécurité locale de la station. */
    LOCAL_SAFETY
}

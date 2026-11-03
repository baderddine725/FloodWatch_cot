/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : LiveMessage.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.dto;

/**
 * Événement de domaine diffusé en temps réel (patron Observer via les événements CDI).
 *
 * @param type         station | measurement | alert | command | gateway | ping
 * @param data         charge utile (DTO immuable)
 * @param operatorOnly vrai si réservé aux sessions authentifiées opérateur/admin
 */
public record LiveMessage(String type, Object data, boolean operatorOnly) {
}

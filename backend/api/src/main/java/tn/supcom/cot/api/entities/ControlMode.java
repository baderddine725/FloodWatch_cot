/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : ControlMode.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.entities;

/**
 * Mode de pilotage des actionneurs par le Cloud. En MANUAL, l'automatisme Cloud est suspendu
 * (l'opérateur a la main) ; la règle de sécurité locale de la station reste toujours active.
 */
public enum ControlMode { AUTO, MANUAL }

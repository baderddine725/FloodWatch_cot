/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : OverflowPredictor.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.alerting;

import java.util.List;

/**
 * Stratégie d'estimation du temps restant avant débordement (patron Strategy).
 * Plusieurs implémentations peuvent coexister (régression linéaire, API météo, ...).
 */
public interface OverflowPredictor {

    /**
     * @param samples    échantillons triés par date croissante (le dernier est la mesure courante)
     * @param criticalCm niveau critique en cm
     * @return la prédiction
     */
    Prediction predict(List<Sample> samples, double criticalCm);
}

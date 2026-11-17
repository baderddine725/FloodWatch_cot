/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : PredictionScorer.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-16          Modifié le : 2026-11-16
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.managers;

import jakarta.ejb.Schedule;
import jakarta.ejb.Singleton;
import jakarta.ejb.TransactionAttribute;
import jakarta.ejb.TransactionAttributeType;
import jakarta.inject.Inject;

import java.time.Instant;
import java.util.logging.Level;
import java.util.logging.Logger;

/** Tâche périodique (toutes les 30 s) : confronte les prédictions échues aux mesures réelles. */
@Singleton
@TransactionAttribute(TransactionAttributeType.NOT_SUPPORTED)
public class PredictionScorer {
    private static final Logger LOG = Logger.getLogger(PredictionScorer.class.getName());

    @Inject
    private PredictionHistory history;

    @Schedule(hour = "*", minute = "*", second = "*/30", persistent = false)
    public void tick() {
        try {
            int closed = history.score(Instant.now());
            if (closed > 0) LOG.fine(() -> closed + " prediction(s) scored");
        } catch (RuntimeException e) {
            LOG.log(Level.WARNING, "Prediction scoring failed", e);
        }
    }
}

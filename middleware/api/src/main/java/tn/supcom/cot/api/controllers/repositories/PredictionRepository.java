/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : PredictionRepository.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-16          Modifié le : 2026-11-16
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.repositories;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import tn.supcom.cot.api.entities.PredictionRecord;
import tn.supcom.cot.api.entities.PredictionStatus;
import tn.supcom.cot.api.entities.Station;
import tn.supcom.cot.core.controllers.repositories.AbstractRepository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Accès à l'historique des prédictions. */
@ApplicationScoped
public class PredictionRepository extends AbstractRepository<PredictionRecord, UUID> {
    @PersistenceContext(unitName = "floodwatch")
    private EntityManager em;

    public PredictionRepository() {
        super(PredictionRecord.class);
    }

    @Override
    protected EntityManager em() {
        return em;
    }

    /** Référence d'une station par son identifiant, sans la charger (clé étrangère seulement). */
    public Station stationRef(UUID stationId) {
        return em.getReference(Station.class, stationId);
    }

    /** Prédictions en attente dont l'échéance est antérieure à {@code before}, les plus anciennes d'abord. */
    public List<PredictionRecord> findDue(Instant before, int limit) {
        return em.createQuery("select p from PredictionRecord p join fetch p.station "
                        + "where p.status = :st and p.targetAt <= :before order by p.targetAt", PredictionRecord.class)
                .setParameter("st", PredictionStatus.PENDING).setParameter("before", before)
                .setMaxResults(limit).getResultList();
    }

    /**
     * Statistiques d'erreur par modèle et par horizon sur une période.
     *
     * @return lignes {@code [model, horizonSec, n, MAE, biais, RMSE, MAE de la référence « rien ne change »]}
     */
    public List<Object[]> errorStats(Instant from, Instant to) {
        return em.createQuery("select p.model, p.horizonSec, count(p), avg(abs(p.errorCm)), avg(p.errorCm), "
                        + "sqrt(avg(p.errorCm * p.errorCm)), avg(abs(p.baseLevelCm - p.actualLevelCm)) "
                        + "from PredictionRecord p where p.status = :st and p.generatedAt between :f and :t "
                        + "group by p.model, p.horizonSec order by p.model, p.horizonSec", Object[].class)
                .setParameter("st", PredictionStatus.SCORED).setParameter("f", from).setParameter("t", to)
                .getResultList();
    }

    /** Nombre de prédictions jamais évaluées, par modèle et horizon : {@code [model, horizonSec, n]}. */
    public List<Object[]> missedCounts(Instant from, Instant to) {
        return em.createQuery("select p.model, p.horizonSec, count(p) from PredictionRecord p "
                        + "where p.status = :st and p.generatedAt between :f and :t "
                        + "group by p.model, p.horizonSec", Object[].class)
                .setParameter("st", PredictionStatus.MISSED).setParameter("f", from).setParameter("t", to)
                .getResultList();
    }

    /** Supprime les prédictions d'une station. */
    public int deleteByStation(Station station) {
        return em.createQuery("delete from PredictionRecord p where p.station = :s").setParameter("s", station).executeUpdate();
    }
}

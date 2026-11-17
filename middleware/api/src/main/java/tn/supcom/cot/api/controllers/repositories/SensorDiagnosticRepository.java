/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : SensorDiagnosticRepository.java
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
import tn.supcom.cot.api.entities.SensorDiagnostic;
import tn.supcom.cot.api.entities.Station;
import tn.supcom.cot.core.controllers.repositories.AbstractRepository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Accès à l'historique de santé des capteurs. */
@ApplicationScoped
public class SensorDiagnosticRepository extends AbstractRepository<SensorDiagnostic, UUID> {
    @PersistenceContext(unitName = "floodwatch")
    private EntityManager em;

    public SensorDiagnosticRepository() {
        super(SensorDiagnostic.class);
    }

    @Override
    protected EntityManager em() {
        return em;
    }

    /**
     * Répartition des verdicts d'une station sur une période.
     *
     * @return lignes {@code [verdict, n, moyenne des échos valides, moyenne de la dispersion en cm,
     *         lectures jugées suspectes par le classifieur embarqué]}
     */
    public List<Object[]> verdictStats(Station station, Instant from, Instant to) {
        return em.createQuery("select d.verdict, count(d), avg(d.echoOk), avg(d.echoSpreadCm), "
                        + "sum(case when d.suspect = true then 1 else 0 end) from SensorDiagnostic d "
                        + "where d.station = :s and d.ts between :f and :t group by d.verdict", Object[].class)
                .setParameter("s", station).setParameter("f", from).setParameter("t", to).getResultList();
    }

    /** Supprime les diagnostics d'une station. */
    public int deleteByStation(Station station) {
        return em.createQuery("delete from SensorDiagnostic d where d.station = :s").setParameter("s", station).executeUpdate();
    }
}

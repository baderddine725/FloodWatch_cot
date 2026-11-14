/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : MeasurementRepository.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.repositories;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import tn.supcom.cot.core.controllers.repositories.AbstractRepository;
import tn.supcom.cot.api.entities.Measurement;
import tn.supcom.cot.api.entities.Station;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Accès aux mesures. */
@ApplicationScoped
public class MeasurementRepository extends AbstractRepository<Measurement, UUID> {
    @PersistenceContext(unitName = "floodwatch")
    private EntityManager em;

    public MeasurementRepository() {
        super(Measurement.class);
    }

    @Override
    protected EntityManager em() {
        return em;
    }

    /** Mesures d'une station sur un intervalle, triées par date croissante. */
    public List<Measurement> findRange(Station station, Instant from, Instant to, int limit) {
        return em.createQuery("select m from Measurement m where m.station = :s and m.ts >= :from and m.ts <= :to order by m.ts desc",
                        Measurement.class)
                .setParameter("s", station).setParameter("from", from).setParameter("to", to)
                .setMaxResults(limit).getResultList().reversed();
    }

    /** Mesures d'une station depuis {@code from}, triées par date croissante. */
    public List<Measurement> findSince(Station station, Instant from) {
        return em.createQuery("select m from Measurement m where m.station = :s and m.ts >= :from order by m.ts",
                        Measurement.class)
                .setParameter("s", station).setParameter("from", from).getResultList();
    }

    /** Nombre de mesures sur une période. */
    public long countBetween(Instant from, Instant to) {
        return em.createQuery("select count(m) from Measurement m where m.ts between :f and :t", Long.class)
                .setParameter("f", from).setParameter("t", to).getSingleResult();
    }

    /** Supprime les mesures d'une station. */
    public int deleteByStation(Station station) {
        return em.createQuery("delete from Measurement m where m.station = :s").setParameter("s", station).executeUpdate();
    }
}

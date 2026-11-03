/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : AlertRepository.java
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
import tn.supcom.cot.api.entities.Alert;
import tn.supcom.cot.api.entities.AlertType;
import tn.supcom.cot.api.entities.Station;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Accès aux alertes. */
@ApplicationScoped
public class AlertRepository extends AbstractRepository<Alert, UUID> {
    @PersistenceContext(unitName = "floodwatch")
    private EntityManager em;

    public AlertRepository() {
        super(Alert.class);
    }

    @Override
    protected EntityManager em() {
        return em;
    }

    /** Alerte active d'un type donné pour une station. */
    public Optional<Alert> findActive(Station station, AlertType type) {
        return first(em.createQuery("select a from Alert a where a.station = :s and a.type = :t and a.active = true order by a.raisedAt desc",
                        Alert.class)
                .setParameter("s", station).setParameter("t", type));
    }

    /** Dernière alerte de la station dont la barrière a été fermée sans être rouverte. */
    public Optional<Alert> findOpenClosure(Station station) {
        return first(em.createQuery("select a from Alert a where a.station = :s and a.barrierClosedAt is not null "
                                + "and a.barrierReopenedAt is null order by a.barrierClosedAt desc", Alert.class)
                .setParameter("s", station));
    }

    /** Recherche filtrée, plus récentes d'abord. */
    public List<Alert> search(Boolean active, Station station, int limit) {
        var jpql = new StringBuilder("select a from Alert a join fetch a.station where 1 = 1");
        if (active != null) jpql.append(" and a.active = :active");
        if (station != null) jpql.append(" and a.station = :s");
        jpql.append(" order by a.raisedAt desc");
        var q = em.createQuery(jpql.toString(), Alert.class);
        if (active != null) q.setParameter("active", active);
        if (station != null) q.setParameter("s", station);
        return q.setMaxResults(limit).getResultList();
    }

    /** Alertes ouvertes ou actives sur la période [from, to]. */
    public List<Alert> findOverlapping(Instant from, Instant to) {
        return em.createQuery("select a from Alert a join fetch a.station where a.raisedAt <= :to "
                        + "and (a.resolvedAt is null or a.resolvedAt >= :from)", Alert.class)
                .setParameter("from", from).setParameter("to", to).getResultList();
    }

    /** Supprime les alertes d'une station. */
    public int deleteByStation(Station station) {
        return em.createQuery("delete from Alert a where a.station = :s").setParameter("s", station).executeUpdate();
    }
}

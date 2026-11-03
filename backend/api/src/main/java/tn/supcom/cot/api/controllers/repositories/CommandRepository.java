/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : CommandRepository.java
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
import tn.supcom.cot.api.entities.ActuatorCommand;
import tn.supcom.cot.api.entities.CommandStatus;
import tn.supcom.cot.api.entities.Station;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Accès aux commandes d'actionneurs. */
@ApplicationScoped
public class CommandRepository extends AbstractRepository<ActuatorCommand, UUID> {
    @PersistenceContext(unitName = "floodwatch")
    private EntityManager em;

    public CommandRepository() {
        super(ActuatorCommand.class);
    }

    @Override
    protected EntityManager em() {
        return em;
    }

    /** Dernières commandes d'une station. */
    public List<ActuatorCommand> findByStation(Station station, int limit) {
        return em.createQuery("select c from ActuatorCommand c where c.station = :s order by c.issuedAt desc", ActuatorCommand.class)
                .setParameter("s", station).setMaxResults(limit).getResultList();
    }

    /** Commandes en attente émises avant {@code before} (expirées). */
    public List<ActuatorCommand> findPendingBefore(Instant before) {
        return em.createQuery("select c from ActuatorCommand c join fetch c.station where c.status = :p and c.issuedAt < :b",
                        ActuatorCommand.class)
                .setParameter("p", CommandStatus.PENDING).setParameter("b", before).getResultList();
    }

    /** Vrai si une commande identique est déjà en attente pour cette station. */
    public boolean hasPending(Station station, String actuator, String value) {
        return em.createQuery("select count(c) from ActuatorCommand c where c.station = :s and c.actuator = :a "
                        + "and c.value = :v and c.status = :p", Long.class)
                .setParameter("s", station).setParameter("a", actuator).setParameter("v", value)
                .setParameter("p", CommandStatus.PENDING).getSingleResult() > 0;
    }

    /** Commandes émises sur une période. */
    public List<ActuatorCommand> findBetween(Instant from, Instant to) {
        return em.createQuery("select c from ActuatorCommand c where c.issuedAt between :f and :t", ActuatorCommand.class)
                .setParameter("f", from).setParameter("t", to).getResultList();
    }

    /** Supprime les commandes d'une station. */
    public int deleteByStation(Station station) {
        return em.createQuery("delete from ActuatorCommand c where c.station = :s").setParameter("s", station).executeUpdate();
    }
}

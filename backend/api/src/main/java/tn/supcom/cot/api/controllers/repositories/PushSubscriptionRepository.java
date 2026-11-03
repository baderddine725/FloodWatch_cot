/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : PushSubscriptionRepository.java
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
import tn.supcom.cot.api.entities.PushSubscription;

import java.util.Optional;
import java.util.UUID;

/** Accès aux abonnements Web Push. */
@ApplicationScoped
public class PushSubscriptionRepository extends AbstractRepository<PushSubscription, UUID> {
    @PersistenceContext(unitName = "floodwatch")
    private EntityManager em;

    public PushSubscriptionRepository() {
        super(PushSubscription.class);
    }

    @Override
    protected EntityManager em() {
        return em;
    }

    /** Recherche par point de terminaison du service de push. */
    public Optional<PushSubscription> findByEndpoint(String endpoint) {
        return first(em.createQuery("select p from PushSubscription p where p.endpoint = :e", PushSubscription.class)
                .setParameter("e", endpoint));
    }
}

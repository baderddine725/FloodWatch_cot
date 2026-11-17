/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : TenantRepository.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-17          Modifié le : 2026-11-17
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.repositories;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import tn.supcom.cot.core.controllers.repositories.AbstractRepository;
import tn.supcom.cot.iam.entities.Tenant;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Accès aux clients d'API. */
@ApplicationScoped
public class TenantRepository extends AbstractRepository<Tenant, UUID> {
    @PersistenceContext(unitName = "floodwatch")
    private EntityManager em;

    public TenantRepository() {
        super(Tenant.class);
    }

    @Override
    protected EntityManager em() {
        return em;
    }

    public Optional<Tenant> findByName(String name) {
        return em.createQuery("select t from Tenant t where t.name = :n", Tenant.class).setParameter("n", name)
                .getResultStream().findFirst();
    }

    public List<Tenant> listOrdered() {
        return em.createQuery("select t from Tenant t order by t.name", Tenant.class).getResultList();
    }
}

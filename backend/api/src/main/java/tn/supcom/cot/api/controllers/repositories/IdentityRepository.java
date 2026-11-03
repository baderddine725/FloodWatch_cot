/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : IdentityRepository.java
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
import tn.supcom.cot.iam.entities.Identity;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Accès aux identités (comptes utilisateurs). */
@ApplicationScoped
public class IdentityRepository extends AbstractRepository<Identity, UUID> {
    @PersistenceContext(unitName = "floodwatch")
    private EntityManager em;

    public IdentityRepository() {
        super(Identity.class);
    }

    @Override
    protected EntityManager em() {
        return em;
    }

    /** Recherche par nom d'utilisateur. */
    public Optional<Identity> findByUsername(String username) {
        return first(em.createQuery("select i from Identity i where i.username = :u", Identity.class)
                .setParameter("u", username));
    }

    /** @return les identités triées par nom d'utilisateur */
    public List<Identity> listOrdered() {
        return em.createQuery("select i from Identity i order by i.username", Identity.class).getResultList();
    }
}

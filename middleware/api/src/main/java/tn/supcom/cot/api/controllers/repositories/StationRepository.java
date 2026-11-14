/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : StationRepository.java
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
import tn.supcom.cot.api.entities.Station;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Accès aux stations. */
@ApplicationScoped
public class StationRepository extends AbstractRepository<Station, UUID> {
    @PersistenceContext(unitName = "floodwatch")
    private EntityManager em;

    public StationRepository() {
        super(Station.class);
    }

    @Override
    protected EntityManager em() {
        return em;
    }

    /** Recherche par code MQTT. */
    public Optional<Station> findByCode(String code) {
        return first(em.createQuery("select s from Station s where s.code = :code", Station.class)
                .setParameter("code", code));
    }

    /** Recherche par UUID ou, à défaut, par code. */
    public Optional<Station> findByIdOrCode(String idOrCode) {
        try {
            return findById(UUID.fromString(idOrCode));
        } catch (IllegalArgumentException notUuid) {
            return findByCode(idOrCode);
        }
    }

    /** @return les stations triées par nom */
    public List<Station> listOrdered() {
        return em.createQuery("select s from Station s order by s.name", Station.class).getResultList();
    }

    /** @return les stations en ligne dont le dernier message est antérieur à {@code before} */
    public List<Station> findSilentSince(Instant before) {
        return em.createQuery("select s from Station s where s.online = true and s.lastSeenAt < :before", Station.class)
                .setParameter("before", before).getResultList();
    }
}

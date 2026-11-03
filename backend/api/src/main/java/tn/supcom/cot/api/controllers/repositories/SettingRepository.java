/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : SettingRepository.java
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
import tn.supcom.cot.api.entities.AppSetting;

/** Accès aux paramètres applicatifs persistants. */
@ApplicationScoped
public class SettingRepository extends AbstractRepository<AppSetting, String> {
    @PersistenceContext(unitName = "floodwatch")
    private EntityManager em;

    public SettingRepository() {
        super(AppSetting.class);
    }

    @Override
    protected EntityManager em() {
        return em;
    }
}

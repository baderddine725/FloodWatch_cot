/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : SeedManager.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.managers;

import jakarta.annotation.PostConstruct;
import jakarta.ejb.Singleton;
import jakarta.ejb.Startup;
import jakarta.inject.Inject;
import tn.supcom.cot.api.controllers.repositories.IdentityRepository;
import tn.supcom.cot.api.controllers.repositories.StationRepository;
import tn.supcom.cot.api.entities.Station;
import tn.supcom.cot.api.entities.StationType;
import tn.supcom.cot.iam.entities.Identity;
import tn.supcom.cot.iam.security.PasswordHasher;
import tn.supcom.cot.iam.security.Role;

import java.util.EnumSet;
import java.util.logging.Logger;

/**
 * Données initiales au premier démarrage : comptes administrateur et opérateur
 * (identifiants configurables par variables d'environnement) et les deux stations
 * de démonstration de la maquette (passage souterrain, oued).
 */
@Singleton
@Startup
public class SeedManager {
    private static final Logger LOG = Logger.getLogger(SeedManager.class.getName());

    @Inject
    private IdentityRepository identities;
    @Inject
    private StationRepository stations;

    @PostConstruct
    public void seed() {
        if (identities.count() == 0) {
            createUser(AppConfig.get("admin.username", "admin"), AppConfig.get("admin.password", "admin123!"),
                    "Administrateur", EnumSet.of(Role.ADMIN, Role.OPERATOR));
            createUser(AppConfig.get("operator.username", "operator"), AppConfig.get("operator.password", "operator123!"),
                    "Opérateur municipal", EnumSet.of(Role.OPERATOR));
            LOG.info("Seeded default admin and operator accounts – change their passwords!");
        }
        if (AppConfig.getBool("seed.demo.stations", true) && stations.count() == 0) {
            createStation("underpass-01", "Passage souterrain Ariana", StationType.UNDERPASS, 36.8625, 10.1956,
                    "Trémie, avenue principale, Ariana", "Passage souterrain sous la voie ferrée (maquette bac n°1).");
            createStation("wadi-01", "Gué de l'oued Ariana", StationType.WADI, 36.8792, 10.1637,
                    "Route du gué, Ariana", "Route basse traversant l'oued (maquette bac n°2).");
            LOG.info("Seeded demo stations underpass-01 and wadi-01");
        }
    }

    private void createUser(String username, String password, String fullName, EnumSet<Role> roles) {
        var id = new Identity();
        id.setUsername(username);
        id.setPassword(PasswordHasher.hash(password));
        id.setFullName(fullName);
        id.setRoles(Role.toMask(roles));
        id.setProvidedScopes("");
        identities.persist(id);
    }

    private void createStation(String code, String name, StationType type, double lat, double lon,
                               String address, String description) {
        var s = new Station();
        s.setCode(code);
        s.setName(name);
        s.setType(type);
        s.setLatitude(lat);
        s.setLongitude(lon);
        s.setAddress(address);
        s.setDescription(description);
        stations.persist(s);
    }
}

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
    /** Zone des stations de démonstration (= zone de backend/gateway/stations.json). */
    private static final String DEMO_ZONE = "ariana";

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
        // Stations de démonstration, créées une à une si absentes : une base existante reçoit aussi la
        // station amont ajoutée avec la topologie hydrologique (backend/gateway/stations.json v1.1).
        if (AppConfig.getBool("seed.demo.stations", true)) {
            createStationIfMissing("upstream-01", "Oued Ariana amont", StationType.WADI, 36.9050, 10.1500,
                    "Lit de l'oued, en amont du gué", "Station amont (démonstration) : annonce la crue au gué et au passage souterrain.");
            createStationIfMissing("wadi-01", "Gué de l'oued Ariana", StationType.WADI, 36.8792, 10.1637,
                    "Route du gué, Ariana", "Route basse traversant l'oued (maquette bac n°2).");
            createStationIfMissing("underpass-01", "Passage souterrain Ariana", StationType.UNDERPASS, 36.8625, 10.1956,
                    "Trémie, avenue principale, Ariana", "Passage souterrain sous la voie ferrée (maquette bac n°1).");
        }
    }

    private void createStationIfMissing(String code, String name, StationType type, double lat, double lon,
                                        String address, String description) {
        var existing = stations.findByCode(code);
        if (existing.isPresent()) {
            if (existing.get().getZone() == null) existing.get().setZone(DEMO_ZONE);   // base antérieure à la v2
            return;
        }
        createStation(code, name, type, lat, lon, address, description);
        LOG.info(() -> "Seeded demo station " + code);
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
        s.setZone(DEMO_ZONE);
        stations.persist(s);
    }
}

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : StationManager.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.managers;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Event;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import tn.supcom.cot.api.controllers.repositories.AlertRepository;
import tn.supcom.cot.api.controllers.repositories.CommandRepository;
import tn.supcom.cot.api.controllers.repositories.MeasurementRepository;
import tn.supcom.cot.api.controllers.repositories.StationRepository;
import tn.supcom.cot.api.dto.LiveMessage;
import tn.supcom.cot.api.dto.StationDto;
import tn.supcom.cot.api.dto.StationRequest;
import tn.supcom.cot.api.entities.ControlMode;
import tn.supcom.cot.api.entities.Station;
import tn.supcom.cot.api.entities.StationType;

import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/** Gestion (CRUD) des stations et de leur mode de pilotage. */
@ApplicationScoped
@Transactional
public class StationManager {
    private static final Pattern CODE = Pattern.compile("[a-z0-9][a-z0-9-]{1,62}");

    @Inject
    private StationRepository stations;
    @Inject
    private MeasurementRepository measurements;
    @Inject
    private AlertRepository alerts;
    @Inject
    private CommandRepository commands;
    @Inject
    private CommandManager commandManager;
    @Inject
    private AutomationManager automation;
    @Inject
    private Event<LiveMessage> live;

    /** Crée une station et publie sa configuration. */
    public Station create(StationRequest req) {
        if (req.code() == null || !CODE.matcher(req.code()).matches()) {
            throw new IllegalArgumentException("code must match " + CODE.pattern());
        }
        if (stations.findByCode(req.code()).isPresent()) {
            throw new IllegalArgumentException("station code already exists: " + req.code());
        }
        var s = new Station();
        s.setCode(req.code());
        apply(s, req);
        stations.persist(s);
        commandManager.publishConfig(s);
        live.fire(new LiveMessage("station", StationDto.of(s), false));
        return s;
    }

    /** Met à jour métadonnées et seuils, puis republie la configuration. */
    public Station update(String idOrCode, StationRequest req, Long expectedVersion) {
        var s = find(idOrCode);
        if (expectedVersion != null && expectedVersion.longValue() != s.getVersion()) {
            throw new jakarta.persistence.OptimisticLockException("station was modified concurrently");
        }
        apply(s, req);
        commandManager.publishConfig(s);
        live.fire(new LiveMessage("station", StationDto.of(s), false));
        return s;
    }

    /** Supprime une station et son historique. */
    public void delete(String idOrCode) {
        var s = find(idOrCode);
        measurements.deleteByStation(s);
        alerts.deleteByStation(s);
        commands.deleteByStation(s);
        stations.delete(s);
        live.fire(new LiveMessage("stationDeleted", Map.of("code", s.getCode()), false));
    }

    /** Change le mode de pilotage ; le retour en AUTO réaligne immédiatement les actionneurs. */
    public Station setMode(String idOrCode, ControlMode mode) {
        var s = find(idOrCode);
        s.setControlMode(mode);
        if (mode == ControlMode.AUTO) automation.apply(s);
        live.fire(new LiveMessage("station", StationDto.of(s), false));
        return s;
    }

    /** Commande manuelle d'un opérateur. */
    public tn.supcom.cot.api.dto.CommandDto command(String idOrCode,
            tn.supcom.cot.api.controllers.commands.StationCommand cmd, String username) {
        var s = find(idOrCode);
        var c = commandManager.issueManual(s, cmd, username);
        live.fire(new LiveMessage("station", StationDto.of(s), false));
        return tn.supcom.cot.api.dto.CommandDto.of(c);
    }

    /** @return toutes les stations (DTO) triées par nom */
    public java.util.List<StationDto> listDtos() {
        return stations.listOrdered().stream().map(StationDto::of).toList();
    }

    /** Republie la configuration retenue d'une station. */
    public boolean republishConfig(String idOrCode) {
        return commandManager.publishConfig(find(idOrCode));
    }

    /** @throws jakarta.persistence.EntityNotFoundException si la station n'existe pas */
    public Station find(String idOrCode) {
        return stations.findByIdOrCode(idOrCode)
                .orElseThrow(() -> new jakarta.persistence.EntityNotFoundException("station not found: " + idOrCode));
    }

    private static void apply(Station s, StationRequest req) {
        if (req.name() != null) {
            if (req.name().isBlank()) throw new IllegalArgumentException("name required");
            s.setName(req.name().trim());
        } else if (s.getName() == null) {
            throw new IllegalArgumentException("name required");
        }
        if (req.description() != null) s.setDescription(req.description());
        if (req.type() != null) s.setType(StationType.valueOf(req.type().toUpperCase(Locale.ROOT)));
        if (req.latitude() != null) {
            if (Math.abs(req.latitude()) > 90) throw new IllegalArgumentException("invalid latitude");
            s.setLatitude(req.latitude());
        }
        if (req.longitude() != null) {
            if (Math.abs(req.longitude()) > 180) throw new IllegalArgumentException("invalid longitude");
            s.setLongitude(req.longitude());
        }
        if (req.address() != null) s.setAddress(req.address());
        if (req.thresholds() != null) req.thresholds().applyTo(s.getThresholds());
    }
}

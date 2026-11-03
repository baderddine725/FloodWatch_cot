/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : CommandManager.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.managers;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Event;
import jakarta.inject.Inject;
import jakarta.json.Json;
import jakarta.json.JsonObject;
import jakarta.transaction.Transactional;
import tn.supcom.cot.api.controllers.commands.SamplingCommand;
import tn.supcom.cot.api.controllers.commands.StationCommand;
import tn.supcom.cot.api.controllers.repositories.CommandRepository;
import tn.supcom.cot.api.dto.CommandDto;
import tn.supcom.cot.api.dto.LiveMessage;
import tn.supcom.cot.api.entities.*;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.logging.Logger;

/**
 * Invocateur des commandes (patron Command) : persiste, publie en MQTT (QoS 1) et suit
 * l'acquittement de chaque commande. Publie aussi la configuration retenue des stations.
 */
@ApplicationScoped
@Transactional
public class CommandManager {
    private static final Logger LOG = Logger.getLogger(CommandManager.class.getName());

    @Inject
    private MqttManager mqtt;
    @Inject
    private CommandRepository commands;
    @Inject
    private Event<LiveMessage> live;

    /** Émet une commande vers une station. */
    public ActuatorCommand issue(Station station, StationCommand cmd, String issuedBy, CommandOrigin origin) {
        var now = Instant.now();
        var entity = commands.persist(new ActuatorCommand(station, cmd.actuator(), cmd.value(), origin, issuedBy, now));
        var payload = Json.createObjectBuilder()
                .add("id", entity.getId().toString())
                .add("actuator", cmd.actuator())
                .add("value", cmd.value())
                .add("ts", now.toEpochMilli())
                .build().toString().getBytes(StandardCharsets.UTF_8);
        if (!mqtt.publish(Topics.cmd(station.getCode()), payload, 1, false)) {
            entity.setStatus(CommandStatus.FAILED);
            entity.setDetail("broker MQTT indisponible");
        }
        LOG.info(() -> "Command " + cmd.actuator() + "=" + cmd.value() + " -> " + station.getCode() + " by " + issuedBy);
        live.fire(new LiveMessage("command", CommandDto.of(entity), true));
        return entity;
    }

    /** Commande manuelle d'un opérateur : la station passe en mode MANUAL (sauf échantillonnage). */
    public ActuatorCommand issueManual(Station station, StationCommand cmd, String username) {
        if (!(cmd instanceof SamplingCommand)) station.setControlMode(ControlMode.MANUAL);
        return issue(station, cmd, username, CommandOrigin.MANUAL);
    }

    /** Traite un acquittement {"id": "...", "ok": true, "detail": "..."} */
    public void onAck(Station station, JsonObject ack) {
        UUID id;
        try {
            id = UUID.fromString(ack.getString("id"));
        } catch (RuntimeException e) {
            LOG.warning(() -> "Invalid ack from " + station.getCode() + ": " + ack);
            return;
        }
        commands.findById(id).filter(c -> c.getStation().equals(station)).ifPresent(c -> {
            boolean ok = ack.getBoolean("ok", true);
            c.setStatus(ok ? CommandStatus.ACKED : CommandStatus.FAILED);
            c.setAckedAt(Instant.now());
            if (ack.containsKey("detail")) c.setDetail(ack.getString("detail", null));
            live.fire(new LiveMessage("command", CommandDto.of(c), true));
        });
    }

    /** Marque en échec les commandes non acquittées dans le délai. */
    public int expirePending(Instant now, Duration timeout) {
        var expired = commands.findPendingBefore(now.minus(timeout));
        for (var c : expired) {
            c.setStatus(CommandStatus.FAILED);
            c.setDetail("délai d'acquittement dépassé");
            live.fire(new LiveMessage("command", CommandDto.of(c), true));
        }
        return expired.size();
    }

    /** Publie la configuration (seuils, périodes) retenue pour le firmware de la station. */
    public boolean publishConfig(Station station) {
        var t = station.getThresholds();
        var payload = Json.createObjectBuilder()
                .add("criticalCm", t.getCriticalCm())
                .add("yellowPct", t.getYellowPct())
                .add("orangePct", t.getOrangePct())
                .add("redPct", t.getRedPct())
                .add("rainThreshold", t.getRainThreshold())
                .add("reopenDelaySec", t.getReopenDelaySec())
                .add("sensorHeightCm", t.getSensorHeightCm())
                .add("periodNormalSec", t.getPeriodNormalSec())
                .add("periodWatchSec", t.getPeriodWatchSec())
                .add("heartbeatSec", 15)
                .build().toString().getBytes(StandardCharsets.UTF_8);
        return mqtt.publish(Topics.config(station.getCode()), payload, 1, true);
    }
}

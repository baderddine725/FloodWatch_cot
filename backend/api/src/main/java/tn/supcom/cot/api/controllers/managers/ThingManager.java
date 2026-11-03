/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : ThingManager.java
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
import jakarta.json.JsonNumber;
import jakarta.json.JsonObject;
import jakarta.json.JsonValue;
import jakarta.transaction.Transactional;
import tn.supcom.cot.api.controllers.alerting.AlertEngine;
import tn.supcom.cot.api.controllers.alerting.AlertLevel;
import tn.supcom.cot.api.controllers.alerting.Sample;
import tn.supcom.cot.api.controllers.repositories.MeasurementRepository;
import tn.supcom.cot.api.controllers.repositories.StationRepository;
import tn.supcom.cot.api.dto.LiveMessage;
import tn.supcom.cot.api.dto.MeasurementDto;
import tn.supcom.cot.api.dto.StationDto;
import tn.supcom.cot.api.entities.*;

import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.logging.Logger;

/**
 * Jumeau numérique des stations (Thing) : ingestion des mesures, messages de vie, états des
 * actionneurs, statut de connexion ; calcul du niveau d'alerte et déclenchement des réactions.
 */
@ApplicationScoped
public class ThingManager {
    private static final Logger LOG = Logger.getLogger(ThingManager.class.getName());
    /** Fenêtre d'historique transmise au prédicteur. */
    private static final Duration HISTORY = Duration.ofMinutes(5);

    @Inject
    private StationRepository stations;
    @Inject
    private MeasurementRepository measurements;
    @Inject
    private AlertManager alertManager;
    @Inject
    private AutomationManager automation;
    @Inject
    private CommandManager commandManager;
    @Inject
    private Event<LiveMessage> live;

    private final AlertEngine engine = new AlertEngine();

    /** Traite une mesure : persistance, prédiction, niveau d'alerte, alertes et automatisme. */
    @Transactional
    public void onTelemetry(String code, JsonObject msg) {
        var station = stations.findByCode(code).orElse(null);
        if (station == null) {
            LOG.warning(() -> "Telemetry from unknown station " + code);
            return;
        }
        var now = Instant.now();
        touch(station, now);
        var t = station.getThresholds();
        double rain = clamp(number(msg, "rain", 0.0), 0, 1);
        Double level = msg.containsKey("levelCm") && msg.get("levelCm").getValueType() == JsonValue.ValueType.NUMBER
                ? msg.getJsonNumber("levelCm").doubleValue() : null;
        boolean sensorOk = !msg.containsKey("sensorOk") || msg.getBoolean("sensorOk", true);

        // Détection de capteur défaillant (Chain of Responsibility en amont du moteur)
        if (level == null || !sensorOk || level < -2 || level > t.getSensorHeightCm() + 2) {
            if (!station.isSensorFault()) {
                station.setSensorFault(true);
                alertManager.raise(station, AlertType.SENSOR_FAULT, AlertLevel.ORANGE,
                        "Capteur de niveau défaillant ou mesure incohérente (" + level + " cm)", now);
            }
            station.setRain(rain);
            broadcastStation(station);
            return;
        }
        if (station.isSensorFault()) {
            station.setSensorFault(false);
            alertManager.resolve(station, AlertType.SENSOR_FAULT, now);
        }
        level = Math.max(0, level);
        double pct = t.toEngine().percent(level);
        var measurement = measurements.persist(new Measurement(station, now, level, pct, rain));

        var history = measurements.findSince(station, now.minus(HISTORY)).stream()
                .map(m -> new Sample(m.getTs(), m.getLevelCm())).toList();
        var previous = station.getAlertLevel();
        // Temporisation de réouverture : instant de passage sous le seuil orange (niveau filtré)
        var below = station.getBelowOrangeSince();
        var result = engine.evaluate(t.toEngine(), history, rain, previous, below, now);
        double filteredPct = t.toEngine().percent(result.levelCm());
        if (filteredPct < t.getOrangePct()) {
            if (below == null) {
                station.setBelowOrangeSince(now);
            }
        } else {
            station.setBelowOrangeSince(null);
        }

        station.setLevelCm(round(result.levelCm()));
        station.setLevelPct(round(filteredPct));
        station.setRain(round(rain));
        station.setSlopeCmPerMin(round(result.prediction().slopeCmPerMin()));
        station.setMinutesToOverflow(result.prediction().minutesToOverflow() == null ? null
                : round(result.prediction().minutesToOverflow()));
        station.setRiskIndex(result.riskIndex());
        station.setAlertReasons(String.join(" ; ", result.reasons()));
        station.setLastMeasurementAt(now);
        station.setAlertLevel(result.level());
        measurement.setAlertLevel(result.level());

        if (result.level() != previous) {
            LOG.info(() -> String.format(Locale.ROOT, "Station %s: %s -> %s (%s)", code, previous,
                    result.level(), station.getAlertReasons()));
            alertManager.onLevelChange(station, previous, result.level(), station.getAlertReasons(), now);
        }
        automation.apply(station);
        live.fire(new LiveMessage("measurement", Map.of("stationCode", code, "measurement",
                MeasurementDto.of(measurement)), false));
        broadcastStation(station);
    }

    /** Message de vie : met à jour la présence et les informations de diagnostic. */
    @Transactional
    public void onHeartbeat(String code, JsonObject msg) {
        stations.findByCode(code).ifPresent(station -> {
            touch(station, Instant.now());
            if (msg.containsKey("rssi")) station.setRssi((int) number(msg, "rssi", 0));
            if (msg.containsKey("uptime")) station.setUptimeSec((long) number(msg, "uptime", 0));
            if (msg.containsKey("fw")) station.setFirmware(msg.getString("fw", null));
            broadcastStation(station);
        });
    }

    /** État des actionneurs rapporté par la station (y compris après une fermeture autonome). */
    @Transactional
    public void onState(String code, JsonObject msg) {
        stations.findByCode(code).ifPresent(station -> {
            var now = Instant.now();
            touch(station, now);
            var oldBarrier = station.getBarrier();
            if (msg.containsKey("barrier")) station.setBarrier(enumOf(BarrierState.class, msg.getString("barrier"), BarrierState.UNKNOWN));
            if (msg.containsKey("light")) station.setLight(enumOf(LightColor.class, msg.getString("light"), LightColor.UNKNOWN));
            if (msg.containsKey("siren")) station.setSiren(bool(msg, "siren"));
            if (msg.containsKey("sampling")) station.setSampling(enumOf(SamplingMode.class, msg.getString("sampling"), SamplingMode.NORMAL));
            boolean wasLocal = station.isLocalSafety();
            if (msg.containsKey("localSafety")) station.setLocalSafety(bool(msg, "localSafety"));
            if (station.isLocalSafety() && !wasLocal) {
                alertManager.raise(station, AlertType.LOCAL_SAFETY, AlertLevel.RED,
                        "Fermeture autonome par la règle de sécurité locale de la station", now);
            } else if (!station.isLocalSafety() && wasLocal) {
                alertManager.resolve(station, AlertType.LOCAL_SAFETY, now);
            }
            if (oldBarrier != station.getBarrier()) {
                alertManager.onBarrierChange(station, station.getBarrier(), now);
            }
            broadcastStation(station);
        });
    }

    /** Statut de connexion (LWT MQTT retenu : online / offline). */
    @Transactional
    public void onStatus(String code, String status) {
        stations.findByCode(code).ifPresent(station -> {
            var now = Instant.now();
            if ("online".equalsIgnoreCase(status)) {
                touch(station, now);
                commandManager.publishConfig(station);
            } else if ("offline".equalsIgnoreCase(status) && station.isOnline()) {
                markOffline(station, now, "Station déconnectée (message de dernière volonté MQTT)");
            }
            broadcastStation(station);
        });
    }

    /** Acquittement de commande. */
    @Transactional
    public void onAck(String code, JsonObject msg) {
        stations.findByCode(code).ifPresent(station -> {
            touch(station, Instant.now());
            commandManager.onAck(station, msg);
        });
    }

    /** Événement remonté par une passerelle Node-RED (station muette, passerelle démarrée...). */
    public void onGatewayEvent(String gatewayId, JsonObject msg) {
        LOG.info(() -> "Gateway " + gatewayId + " event: " + msg);
        live.fire(new LiveMessage("gateway", Map.of("gateway", gatewayId, "event", msg.toString()), true));
    }

    /**
     * Détection des stations muettes : aucun message depuis {@code silence} (3 messages de vie
     * manqués à 15 s = 45 s).
     *
     * @return le nombre de stations passées hors ligne
     */
    @Transactional
    public int checkSilentStations(Instant now, Duration silence) {
        var silent = stations.findSilentSince(now.minus(silence));
        for (var s : silent) {
            markOffline(s, now, "Station muette : aucun message de vie depuis " + silence.toSeconds() + " s");
            broadcastStation(s);
        }
        return silent.size();
    }

    private void markOffline(Station station, Instant now, String reason) {
        station.setOnline(false);
        LOG.warning(() -> "Station " + station.getCode() + " offline: " + reason);
        alertManager.raise(station, AlertType.OFFLINE, AlertLevel.ORANGE, reason, now);
    }

    /** Présence : la station a parlé ; si elle était hors ligne, l'alerte est résolue. */
    private void touch(Station station, Instant now) {
        station.setLastSeenAt(now);
        if (!station.isOnline()) {
            station.setOnline(true);
            alertManager.resolve(station, AlertType.OFFLINE, now);
        }
    }

    private void broadcastStation(Station station) {
        live.fire(new LiveMessage("station", StationDto.of(station), false));
    }

    private static double number(JsonObject o, String key, double def) {
        var v = o.get(key);
        return v instanceof JsonNumber n ? n.doubleValue() : def;
    }

    private static boolean bool(JsonObject o, String key) {
        var v = o.get(key);
        if (v == JsonValue.TRUE) return true;
        if (v == JsonValue.FALSE) return false;
        if (v instanceof jakarta.json.JsonString s) return "ON".equalsIgnoreCase(s.getString()) || "true".equalsIgnoreCase(s.getString());
        return v instanceof JsonNumber n && n.intValue() != 0;
    }

    private static <E extends Enum<E>> E enumOf(Class<E> type, String v, E def) {
        try {
            return Enum.valueOf(type, v.trim().toUpperCase(Locale.ROOT));
        } catch (RuntimeException e) {
            return def;
        }
    }

    private static double clamp(double v, double min, double max) {
        return Math.max(min, Math.min(max, v));
    }

    private static double round(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}

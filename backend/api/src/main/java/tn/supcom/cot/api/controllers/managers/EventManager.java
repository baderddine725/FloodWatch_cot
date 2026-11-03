/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : EventManager.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.managers;

import jakarta.annotation.Resource;
import jakarta.enterprise.concurrent.ManagedExecutorService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.json.Json;
import jakarta.json.JsonObject;
import jakarta.json.JsonValue;
import jakarta.json.stream.JsonParsingException;

import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Bus d'événements entrants : reçoit les messages MQTT, les décode et les route vers
 * {@link ThingManager}. Les messages d'une même station sont traités <b>dans l'ordre</b>
 * (une « file » par station sur l'exécuteur géré), en parallèle entre stations.
 *
 * <p>Correction : le code de départ cumulait {@code @Singleton} EJB et {@code @ApplicationScoped}
 * (annotations incompatibles) ; c'est désormais un bean CDI.</p>
 */
@ApplicationScoped
public class EventManager {
    private static final Logger LOG = Logger.getLogger(EventManager.class.getName());
    private static final int MAX_ATTEMPTS = 5;

    @Resource
    private ManagedExecutorService executor;

    @Inject
    private ThingManager thingManager;

    private final ConcurrentHashMap<String, CompletableFuture<Void>> lanes = new ConcurrentHashMap<>();

    /** Point d'entrée appelé par le client MQTT. */
    public void publishFromMqtt(String topic, byte[] payload) {
        var parsed = Topics.parse(topic);
        if (parsed.isEmpty()) {
            LOG.fine(() -> "Ignoring topic " + topic);
            return;
        }
        var key = parsed.get().scope() + "/" + parsed.get().id();
        lanes.compute(key, (k, previous) ->
                (previous == null ? CompletableFuture.<Void>completedFuture(null) : previous)
                        .thenRunAsync(() -> route(parsed.get(), payload), executor)
                        .exceptionally(t -> {
                            LOG.log(Level.SEVERE, "Unhandled error for " + topic, t);
                            return null;
                        }));
    }

    private void route(Topics.Parsed t, byte[] payload) {
        String text = new String(payload, StandardCharsets.UTF_8).trim();
        for (int attempt = 1; ; attempt++) {
            try {
                if ("gateways".equals(t.scope())) {
                    thingManager.onGatewayEvent(t.id(), parseOrWrap(text));
                    return;
                }
                if (!"stations".equals(t.scope())) return;
                switch (t.kind()) {
                    case "telemetry" -> thingManager.onTelemetry(t.id(), parse(text));
                    case "heartbeat" -> thingManager.onHeartbeat(t.id(), parse(text));
                    case "state" -> thingManager.onState(t.id(), parse(text));
                    case "ack" -> thingManager.onAck(t.id(), parse(text));
                    case "status" -> thingManager.onStatus(t.id(), statusOf(text));
                    default -> LOG.fine(() -> "Ignoring kind " + t.kind());
                }
                return;
            } catch (JsonParsingException | ClassCastException | NullPointerException e) {
                LOG.warning(() -> "Malformed payload on " + t + ": " + e.getMessage());
                return;
            } catch (Exception e) { // inclut RollbackException (contrôlée) levée à la validation
                if (Retry.isOptimisticLock(e) && attempt < MAX_ATTEMPTS) {
                    continue; // conflit de version concurrent : on rejoue
                }
                LOG.log(Level.SEVERE, "Processing failed for " + t, e);
                return;
            }
        }
    }

    private static JsonObject parse(String text) {
        if (text.isEmpty()) return JsonValue.EMPTY_JSON_OBJECT;
        return Json.createReader(new StringReader(text)).readObject();
    }

    private static JsonObject parseOrWrap(String text) {
        try {
            return parse(text);
        } catch (JsonParsingException e) {
            return Json.createObjectBuilder().add("message", text).build();
        }
    }

    /** Le statut peut être du texte brut ("online") ou du JSON ({"status":"online"}). */
    private static String statusOf(String text) {
        if (text.startsWith("{")) return parse(text).getString("status", "unknown");
        return text.replace("\"", "");
    }
}

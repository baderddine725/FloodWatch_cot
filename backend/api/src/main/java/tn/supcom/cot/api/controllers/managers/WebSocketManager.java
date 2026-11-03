/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : WebSocketManager.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.managers;

import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.enterprise.event.TransactionPhase;
import jakarta.json.bind.Jsonb;
import jakarta.json.bind.JsonbBuilder;
import jakarta.websocket.Session;
import tn.supcom.cot.api.dto.LiveMessage;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

/**
 * Registre des sessions WebSocket et diffusion temps réel des événements de domaine
 * (Observer : événements CDI après validation de la transaction).
 */
@ApplicationScoped
public class WebSocketManager {
    private static final Logger LOG = Logger.getLogger(WebSocketManager.class.getName());
    private final Set<Session> sessions = ConcurrentHashMap.newKeySet();
    private final Jsonb jsonb = JsonbBuilder.create();

    /** Enregistre une session ; {@code operator} = jeton opérateur/admin valide. */
    public void register(Session session, boolean operator) {
        session.getUserProperties().put("operator", operator);
        sessions.add(session);
    }

    public void unregister(Session session) {
        sessions.remove(session);
    }

    /** @return le nombre de clients connectés */
    public int count() {
        return sessions.size();
    }

    /** Sérialise un message temps réel. */
    public String toJson(String type, Object data) {
        return jsonb.toJson(Map.of("type", type, "data", data));
    }

    /** Diffuse un événement de domaine aux sessions concernées. */
    public void onLive(@Observes(during = TransactionPhase.AFTER_SUCCESS) LiveMessage message) {
        if (sessions.isEmpty()) return;
        String json;
        try {
            json = toJson(message.type(), message.data());
        } catch (RuntimeException e) {
            LOG.warning(() -> "Cannot serialise live message " + message.type() + ": " + e.getMessage());
            return;
        }
        for (var s : sessions) {
            if (!s.isOpen()) {
                sessions.remove(s);
                continue;
            }
            if (message.operatorOnly() && !Boolean.TRUE.equals(s.getUserProperties().get("operator"))) continue;
            s.getAsyncRemote().sendText(json, result -> {
                if (!result.isOK()) sessions.remove(s);
            });
        }
    }

    @PreDestroy
    void close() {
        try {
            jsonb.close();
        } catch (Exception ignore) {
            // arrêt
        }
    }
}

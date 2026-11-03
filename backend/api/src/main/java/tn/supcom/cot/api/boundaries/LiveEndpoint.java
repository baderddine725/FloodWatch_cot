/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : LiveEndpoint.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.boundaries;

import jakarta.enterprise.inject.spi.CDI;
import jakarta.websocket.*;
import jakarta.websocket.server.ServerEndpoint;
import tn.supcom.cot.api.boundaries.security.SecurityService;
import tn.supcom.cot.api.controllers.managers.StationManager;
import tn.supcom.cot.api.controllers.managers.WebSocketManager;

import java.util.List;
import java.util.Set;
import java.util.logging.Logger;

/**
 * Flux temps réel {@code /ws/live}. À l'ouverture, envoie un instantané des stations puis
 * diffuse les événements. Avec {@code ?token=<jwt opérateur>}, la session reçoit aussi les
 * alertes et les commandes.
 */
@ServerEndpoint("/ws/live")
public class LiveEndpoint {
    private static final Logger LOG = Logger.getLogger(LiveEndpoint.class.getName());

    @OnOpen
    public void open(Session session) {
        var cdi = CDI.current();
        var manager = cdi.select(WebSocketManager.class).get();
        boolean operator = false;
        List<String> token = session.getRequestParameterMap().get("token");
        if (token != null && !token.isEmpty()) {
            operator = cdi.select(SecurityService.class).get().tokens().verify(token.get(0))
                    .map(c -> c.hasAnyRole(Set.of("OPERATOR", "ADMIN"))).orElse(false);
        }
        session.setMaxIdleTimeout(0);
        manager.register(session, operator);
        var snapshot = cdi.select(StationManager.class).get().listDtos();
        session.getAsyncRemote().sendText(manager.toJson("snapshot", snapshot));
        boolean op = operator;
        LOG.fine(() -> "WebSocket opened (operator=" + op + ")");
    }

    @OnMessage
    public void message(Session session, String text) {
        if ("ping".equalsIgnoreCase(text.trim())) session.getAsyncRemote().sendText("{\"type\":\"pong\"}");
    }

    @OnClose
    public void close(Session session) {
        CDI.current().select(WebSocketManager.class).get().unregister(session);
    }

    @OnError
    public void error(Session session, Throwable t) {
        CDI.current().select(WebSocketManager.class).get().unregister(session);
    }
}

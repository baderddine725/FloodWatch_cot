/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : Topics.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.managers;

import java.util.Optional;

/**
 * Contrat des topics MQTT FloodWatch (voir docs/mqtt-topics.md).
 * <pre>
 * floodwatch/stations/{code}/telemetry   station -> cloud  mesures
 * floodwatch/stations/{code}/heartbeat   station -> cloud  message de vie (15 s)
 * floodwatch/stations/{code}/state       station -> cloud  état des actionneurs (retenu)
 * floodwatch/stations/{code}/status      station -> cloud  online/offline (LWT, retenu)
 * floodwatch/stations/{code}/ack         station -> cloud  acquittement de commande
 * floodwatch/stations/{code}/cmd         cloud -> station  commande d'actionneur
 * floodwatch/stations/{code}/config      cloud -> station  seuils (retenu)
 * floodwatch/gateways/{gw}/events        passerelle -> cloud  événements (station muette...)
 * </pre>
 */
public final class Topics {
    public static final String ROOT = "floodwatch/stations";
    public static final String GATEWAYS = "floodwatch/gateways";

    /** Abonnements du middleware. */
    public static final String[] SUBSCRIPTIONS = {
            ROOT + "/+/telemetry", ROOT + "/+/heartbeat", ROOT + "/+/state",
            ROOT + "/+/status", ROOT + "/+/ack", GATEWAYS + "/+/events"
    };

    private Topics() {
    }

    public static String cmd(String code) {
        return ROOT + "/" + code + "/cmd";
    }

    public static String config(String code) {
        return ROOT + "/" + code + "/config";
    }

    /**
     * Topic décomposé.
     *
     * @param scope « stations » ou « gateways »
     * @param id    code de la station ou de la passerelle
     * @param kind  dernier segment (telemetry, heartbeat, ...)
     */
    public record Parsed(String scope, String id, String kind) {
    }

    /** Décompose un topic {@code floodwatch/<scope>/<id>/<kind>}. */
    public static Optional<Parsed> parse(String topic) {
        if (topic == null) return Optional.empty();
        String[] p = topic.split("/");
        if (p.length != 4 || !"floodwatch".equals(p[0]) || p[2].isBlank()) return Optional.empty();
        return Optional.of(new Parsed(p[1], p[2], p[3]));
    }
}

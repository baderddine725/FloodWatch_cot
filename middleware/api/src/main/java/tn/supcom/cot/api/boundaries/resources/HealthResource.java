/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : HealthResource.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.boundaries.resources;

import jakarta.annotation.security.PermitAll;
import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import tn.supcom.cot.api.controllers.managers.MqttManager;
import tn.supcom.cot.api.controllers.managers.WebSocketManager;

import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.util.LinkedHashMap;

/** Santé du service et documentation OpenAPI. */
@Path("")
@RequestScoped
@PermitAll
public class HealthResource {
    @Inject
    private MqttManager mqtt;
    @Inject
    private WebSocketManager ws;
    @PersistenceContext(unitName = "floodwatch")
    private EntityManager em;

    /** GET /api/health */
    @GET
    @Path("health")
    @Produces(MediaType.APPLICATION_JSON)
    public Response health() {
        var m = new LinkedHashMap<String, Object>();
        boolean db;
        try {
            em.createNativeQuery("select 1").getSingleResult();
            db = true;
        } catch (RuntimeException e) {
            db = false;
        }
        boolean broker = mqtt.isConnected();
        m.put("status", db ? (broker ? "UP" : "DEGRADED") : "DOWN");
        m.put("database", db);
        m.put("mqtt", broker);
        m.put("mqttBroker", mqtt.brokerUrl());
        m.put("websocketClients", ws.count());
        m.put("time", Instant.now().toString());
        m.put("version", "1.0");
        return Response.status(db ? 200 : 503).entity(m).build();
    }

    /** GET /api/openapi : spécification OpenAPI 3 (YAML). */
    @GET
    @Path("openapi")
    @Produces("application/yaml")
    public Response openapi() throws IOException {
        try (InputStream in = getClass().getResourceAsStream("/META-INF/openapi.yaml")) {
            if (in == null) return Response.status(404).build();
            return Response.ok(new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)).build();
        }
    }
}

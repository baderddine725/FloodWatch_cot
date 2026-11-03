/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : PushResource.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.boundaries.resources;

import jakarta.annotation.security.PermitAll;
import jakarta.annotation.security.RolesAllowed;
import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.SecurityContext;
import tn.supcom.cot.api.controllers.push.PushManager;
import tn.supcom.cot.api.controllers.push.PushStore;
import tn.supcom.cot.api.dto.Requests;
import tn.supcom.cot.api.entities.PushAudience;

import java.util.Map;

/**
 * Abonnements Web Push. Un abonnement envoyé avec un jeton opérateur reçoit toutes les alertes ;
 * un abonnement citoyen reçoit les alertes orange/rouge des stations situées dans son rayon.
 */
@Path("push")
@RequestScoped
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class PushResource {
    @Inject
    private PushManager pushManager;
    @Inject
    private PushStore store;

    /** Clé publique VAPID (applicationServerKey). */
    @GET
    @Path("public-key")
    @PermitAll
    public Map<String, String> publicKey() {
        return Map.of("publicKey", pushManager.sender().publicKey());
    }

    @POST
    @Path("subscriptions")
    @PermitAll
    public Response subscribe(Requests.PushSubscribe req, @Context SecurityContext sc) {
        if (req == null || req.subscription() == null || req.subscription().endpoint() == null
                || req.subscription().keys() == null) throw new BadRequestException("subscription required");
        var endpoint = req.subscription().endpoint();
        if (!endpoint.startsWith("https://")) throw new BadRequestException("endpoint must be https");
        boolean operator = sc.getUserPrincipal() != null && (sc.isUserInRole("OPERATOR") || sc.isUserInRole("ADMIN"));
        var sub = store.upsert(endpoint, req.subscription().keys().p256dh(), req.subscription().keys().auth(),
                operator ? PushAudience.OPERATOR : PushAudience.CITIZEN, req.latitude(), req.longitude(),
                req.radiusKm(), operator ? sc.getUserPrincipal().getName() : null);
        return Response.status(201).entity(Map.of("id", sub.getId().toString(), "audience", sub.getAudience().name(),
                "radiusKm", sub.getRadiusKm())).build();
    }

    @DELETE
    @Path("subscriptions")
    @PermitAll
    public Map<String, Object> unsubscribe(@QueryParam("endpoint") String endpoint) {
        if (endpoint == null) throw new BadRequestException("endpoint required");
        return Map.of("removed", store.remove(endpoint));
    }

    /** Notification de test vers tous les abonnés (démonstration). */
    @POST
    @Path("test")
    @RolesAllowed({"OPERATOR", "ADMIN"})
    public Map<String, Object> test(Requests.PushTest req) {
        String title = req == null || req.title() == null ? "FloodWatch – test" : req.title();
        String body = req == null || req.body() == null ? "Notification de test de la plateforme FloodWatch." : req.body();
        return Map.of("sent", pushManager.broadcastTest(title, body));
    }
}

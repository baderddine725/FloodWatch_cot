/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : AlertResource.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.boundaries.resources;

import jakarta.annotation.security.RolesAllowed;
import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.SecurityContext;
import tn.supcom.cot.api.controllers.managers.AlertManager;
import tn.supcom.cot.api.controllers.managers.StationManager;
import tn.supcom.cot.api.controllers.repositories.AlertRepository;
import tn.supcom.cot.api.dto.AlertDto;

import java.util.List;
import java.util.UUID;

/** Alertes : consultation et acquittement (opérateurs). */
@Path("alerts")
@RequestScoped
@Transactional
@RolesAllowed({"OPERATOR", "ADMIN"})
@Produces(MediaType.APPLICATION_JSON)
public class AlertResource {
    @Inject
    private AlertRepository alerts;
    @Inject
    private AlertManager alertManager;
    @Inject
    private StationManager stationManager;

    /** GET /api/alerts?active=true&station=underpass-01&limit=100 */
    @GET
    public List<AlertDto> list(@QueryParam("active") Boolean active, @QueryParam("station") String station,
                               @QueryParam("limit") @DefaultValue("100") int limit) {
        var s = station == null || station.isBlank() ? null : stationManager.find(station);
        return alerts.search(active, s, Math.min(Math.max(limit, 1), 1000)).stream().map(AlertDto::of).toList();
    }

    /** POST /api/alerts/{id}/ack */
    @POST
    @Path("{id}/ack")
    public AlertDto acknowledge(@PathParam("id") UUID id, @Context SecurityContext sc) {
        return alertManager.acknowledge(id, sc.getUserPrincipal().getName());
    }
}

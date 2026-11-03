/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : KpiResource.java
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
import jakarta.ws.rs.core.MediaType;
import tn.supcom.cot.api.controllers.managers.KpiManager;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;

/** Indicateurs de performance. GET /api/kpi?days=7 ou ?from=...&to=... (ISO-8601). */
@Path("kpi")
@RequestScoped
@Transactional
@RolesAllowed({"OPERATOR", "ADMIN"})
@Produces(MediaType.APPLICATION_JSON)
public class KpiResource {
    @Inject
    private KpiManager kpi;

    @GET
    public Map<String, Object> get(@QueryParam("from") String from, @QueryParam("to") String to,
                                   @QueryParam("days") @DefaultValue("7") int days) {
        var end = to == null ? Instant.now() : Instant.parse(to);
        var start = from == null ? end.minus(Duration.ofDays(Math.max(1, Math.min(days, 366)))) : Instant.parse(from);
        if (!start.isBefore(end)) throw new BadRequestException("from must be before to");
        return kpi.compute(start, end);
    }
}

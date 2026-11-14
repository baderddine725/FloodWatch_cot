/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : StationResource.java
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
import jakarta.json.JsonObject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;
import tn.supcom.cot.api.boundaries.ThingDescriptions;
import tn.supcom.cot.api.controllers.commands.CommandFactory;
import tn.supcom.cot.api.controllers.managers.Retry;
import tn.supcom.cot.api.controllers.managers.StationManager;
import tn.supcom.cot.api.controllers.repositories.CommandRepository;
import tn.supcom.cot.api.controllers.repositories.MeasurementRepository;
import tn.supcom.cot.api.dto.*;
import tn.supcom.cot.api.entities.ControlMode;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Stations (Things) : consultation publique, administration, historique, prédiction,
 * Thing Description W3C WoT et commande des actionneurs.
 * {@code {id}} accepte l'UUID ou le code de la station (ex. {@code underpass-01}).
 */
@Path("stations")
@RequestScoped
@Transactional
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class StationResource {
    @Inject
    private StationManager stationManager;
    @Inject
    private MeasurementRepository measurements;
    @Inject
    private CommandRepository commands;

    @GET
    @PermitAll
    public List<StationDto> list() {
        return stationManager.listDtos();
    }

    @GET
    @Path("{id}")
    @PermitAll
    public Response get(@PathParam("id") String id, @Context Request request) {
        var dto = StationDto.of(stationManager.find(id));
        var etag = new EntityTag(dto.etag());
        var notModified = request.evaluatePreconditions(etag);
        if (notModified != null) return notModified.build();
        return Response.ok(dto).tag(etag).build();
    }

    @POST
    @RolesAllowed("ADMIN")
    @Transactional(Transactional.TxType.NOT_SUPPORTED) // chaque tentative dans sa propre transaction
    public Response create(StationRequest req, @Context UriInfo uri) {
        if (req == null) throw new BadRequestException("body required");
        var dto = StationDto.of(Retry.onConflict(() -> stationManager.create(req)));
        return Response.created(uri.getAbsolutePathBuilder().path(dto.code()).build()).entity(dto)
                .tag(dto.etag()).build();
    }

    /** Mise à jour ; en-tête If-Match optionnel (contrôle de concurrence optimiste par ETag). */
    @PUT
    @Path("{id}")
    @RolesAllowed("ADMIN")
    @Transactional(Transactional.TxType.NOT_SUPPORTED) // chaque tentative dans sa propre transaction
    public Response update(@PathParam("id") String id, StationRequest req, @Context Request request) {
        if (req == null) throw new BadRequestException("body required");
        var current = stationManager.find(id);
        var failed = request.evaluatePreconditions(new EntityTag(current.tag()));
        if (failed != null) return failed.build();
        var dto = StationDto.of(Retry.onConflict(() -> stationManager.update(id, req, null)));
        return Response.ok(dto).tag(dto.etag()).build();
    }

    @DELETE
    @Path("{id}")
    @RolesAllowed("ADMIN")
    @Transactional(Transactional.TxType.NOT_SUPPORTED) // chaque tentative dans sa propre transaction
    public Response delete(@PathParam("id") String id) {
        Retry.onConflict(() -> { stationManager.delete(id); return null; });
        return Response.noContent().build();
    }

    /** Historique des mesures. Paramètres : from/to (ISO-8601) ou minutes (défaut 60), limit (défaut 2000). */
    @GET
    @Path("{id}/measurements")
    @PermitAll
    public List<MeasurementDto> measurements(@PathParam("id") String id, @QueryParam("from") String from,
                                             @QueryParam("to") String to, @QueryParam("minutes") @DefaultValue("60") int minutes,
                                             @QueryParam("limit") @DefaultValue("2000") int limit) {
        var station = stationManager.find(id);
        var end = to == null ? Instant.now() : Instant.parse(to);
        var start = from == null ? end.minus(Duration.ofMinutes(Math.max(1, minutes))) : Instant.parse(from);
        return measurements.findRange(station, start, end, Math.min(Math.max(limit, 1), 10_000)).stream()
                .map(MeasurementDto::of).toList();
    }

    /** Prédiction courante : temps avant débordement, vitesse de montée, indice de risque. */
    @GET
    @Path("{id}/prediction")
    @PermitAll
    public Map<String, Object> prediction(@PathParam("id") String id) {
        var s = stationManager.find(id);
        var m = new LinkedHashMap<String, Object>();
        m.put("station", s.getCode());
        m.put("alertLevel", s.getAlertLevel().name());
        m.put("levelCm", s.getLevelCm());
        m.put("levelPct", s.getLevelPct());
        m.put("slopeCmPerMin", s.getSlopeCmPerMin());
        m.put("minutesToOverflow", s.getMinutesToOverflow());
        m.put("riskIndex", s.getRiskIndex());
        m.put("reasons", s.getAlertReasons());
        m.put("computedAt", s.getLastMeasurementAt() == null ? null : s.getLastMeasurementAt().toString());
        return m;
    }

    /** Thing Description W3C WoT 1.1 de la station. */
    @GET
    @Path("{id}/td")
    @PermitAll
    @Produces({"application/td+json", MediaType.APPLICATION_JSON})
    public JsonObject thingDescription(@PathParam("id") String id, @Context UriInfo uri) {
        return ThingDescriptions.of(stationManager.find(id), uri.getBaseUri().toString());
    }

    @GET
    @Path("{id}/commands")
    @RolesAllowed({"OPERATOR", "ADMIN"})
    public List<CommandDto> commands(@PathParam("id") String id, @QueryParam("limit") @DefaultValue("50") int limit) {
        return commands.findByStation(stationManager.find(id), Math.min(Math.max(limit, 1), 500)).stream()
                .map(CommandDto::of).toList();
    }

    /** Commande manuelle : {"actuator": "barrier|light|siren|sampling", "value": "..."} */
    @POST
    @Path("{id}/commands")
    @RolesAllowed({"OPERATOR", "ADMIN"})
    @Transactional(Transactional.TxType.NOT_SUPPORTED) // chaque tentative dans sa propre transaction
    public Response command(@PathParam("id") String id, Requests.Command req, @Context SecurityContext sc) {
        if (req == null) throw new BadRequestException("body required");
        var cmd = CommandFactory.parse(req.actuator(), req.value());
        String user = sc.getUserPrincipal().getName();
        return Response.accepted(Retry.onConflict(() -> stationManager.command(id, cmd, user))).build();
    }

    /** Mode de pilotage : {"mode": "AUTO" | "MANUAL"} */
    @PUT
    @Path("{id}/mode")
    @RolesAllowed({"OPERATOR", "ADMIN"})
    @Transactional(Transactional.TxType.NOT_SUPPORTED) // chaque tentative dans sa propre transaction
    public StationDto mode(@PathParam("id") String id, Requests.Mode req) {
        if (req == null || req.mode() == null) throw new BadRequestException("mode required");
        var mode = ControlMode.valueOf(req.mode().toUpperCase(Locale.ROOT));
        return StationDto.of(Retry.onConflict(() -> stationManager.setMode(id, mode)));
    }

    /** Republie la configuration retenue (seuils) vers la station. */
    @POST
    @Path("{id}/config/publish")
    @RolesAllowed("ADMIN")
    public Map<String, Object> publishConfig(@PathParam("id") String id) {
        return Map.of("published", stationManager.republishConfig(id));
    }
}

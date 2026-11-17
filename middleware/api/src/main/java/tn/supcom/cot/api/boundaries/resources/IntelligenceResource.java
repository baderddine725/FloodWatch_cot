/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware (intelligence Cloud)
 *  Fichier   : IntelligenceResource.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-17          Modifié le : 2026-11-17
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.boundaries.resources;

import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.servlet.http.HttpServletRequest;
import tn.supcom.cot.api.boundaries.security.AuthenticationFilter;
import tn.supcom.cot.api.boundaries.security.RequiresScope;
import tn.supcom.cot.api.controllers.intelligence.ForecastService;
import tn.supcom.cot.api.controllers.intelligence.OverflowRisk;
import tn.supcom.cot.api.controllers.repositories.AlertRepository;
import tn.supcom.cot.api.controllers.repositories.StationRepository;
import tn.supcom.cot.api.entities.AlertType;
import tn.supcom.cot.api.entities.Station;
import tn.supcom.cot.iam.security.TokenService;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Services d'intelligence ouverts aux CLIENTS D'API (portée {@code forecast:read}) et aux opérateurs.
 * <ul>
 *   <li>GET /api/intelligence/stations : stations accessibles au client (ses zones) ;</li>
 *   <li>GET /api/intelligence/stations/{code}/forecast?horizons=5,10,15,30 : prévision multi-horizon ;</li>
 *   <li>GET /api/intelligence/zones/{zone}/risk : risque de la zone et propagations en cours.</li>
 * </ul>
 * Une station hors des zones du client répond 404 : le client n'apprend même pas qu'elle existe.
 */
@Path("intelligence")
@RequestScoped
@Transactional
@RequiresScope("forecast:read")
@Produces(MediaType.APPLICATION_JSON)
public class IntelligenceResource {
    private static final int MAX_HORIZON_MIN = 120;

    @Inject
    private StationRepository stations;
    @Inject
    private AlertRepository alerts;
    @Inject
    private ForecastService forecasts;
    @Context
    private HttpServletRequest request;

    @GET
    @Path("stations")
    public List<Map<String, Object>> list() {
        var now = Instant.now();
        var out = new ArrayList<Map<String, Object>>();
        for (Station s : stations.listOrdered()) {
            if (!visible(s)) continue;
            var m = new LinkedHashMap<String, Object>();
            m.put("station", s.getCode());
            m.put("name", s.getName());
            m.put("zone", s.getZone());
            m.put("latitude", s.getLatitude());
            m.put("longitude", s.getLongitude());
            m.put("alertLevel", s.getAlertLevel().name());
            m.put("levelPct", s.getLevelPct());
            m.put("online", s.isOnline());
            m.put("calibrated", forecasts.calibrated(s, now));
            out.add(m);
        }
        return out;
    }

    @GET
    @Path("stations/{code}/forecast")
    public ForecastService.Forecast forecast(@PathParam("code") String code,
                                             @QueryParam("horizons") @DefaultValue("5,10,15,30") String horizons) {
        var s = stations.findByCode(code).filter(this::visible)
                .orElseThrow(() -> new NotFoundException("station not found: " + code));
        return forecasts.forecast(s, parseHorizons(horizons), Instant.now());
    }

    @GET
    @Path("zones/{zone}/risk")
    public Map<String, Object> zoneRisk(@PathParam("zone") String zone) {
        if (!claimsAllow(zone)) throw new NotFoundException("zone not found: " + zone);
        var now = Instant.now();
        var members = new ArrayList<Map<String, Object>>();
        var propagation = new ArrayList<Map<String, Object>>();
        double worst = 0.0;
        for (Station s : stations.listOrdered()) {
            if (!zone.equals(s.getZone())) continue;
            var f = forecasts.forecast(s, new int[]{15, 30}, now);
            double risk = f.horizons().stream().mapToDouble(ForecastService.Horizon::overflowRisk).max().orElse(0.0);
            worst = Math.max(worst, risk);
            var m = new LinkedHashMap<String, Object>();
            m.put("station", s.getCode());
            m.put("alertLevel", s.getAlertLevel().name());
            m.put("overflowRisk30min", risk);
            m.put("risk", OverflowRisk.label(risk));
            m.put("method", f.method());
            members.add(m);
            alerts.search(true, s, 20).stream().filter(a -> a.getType() == AlertType.PROPAGATION).forEach(a -> {
                var p = new LinkedHashMap<String, Object>();
                p.put("station", s.getCode());
                p.put("raisedAt", a.getRaisedAt());
                p.put("message", a.getMessage());
                propagation.add(p);
            });
        }
        if (members.isEmpty()) throw new NotFoundException("zone not found: " + zone);
        var body = new LinkedHashMap<String, Object>();
        body.put("zone", zone);
        body.put("generatedAt", now);
        body.put("risk", OverflowRisk.label(worst));
        body.put("stations", members);
        body.put("activePropagation", propagation);
        return body;
    }

    static int[] parseHorizons(String csv) {
        try {
            int[] h = Arrays.stream(csv.split(",")).map(String::trim).filter(x -> !x.isEmpty())
                    .mapToInt(Integer::parseInt).distinct().sorted().toArray();
            if (h.length == 0 || h.length > 12 || h[0] <= 0 || h[h.length - 1] > MAX_HORIZON_MIN) {
                throw new BadRequestException("horizons: 1 to 12 values in minutes, between 1 and " + MAX_HORIZON_MIN);
            }
            return h;
        } catch (NumberFormatException e) {
            throw new BadRequestException("horizons: comma-separated minutes, e.g. 5,10,15,30");
        }
    }

    private boolean visible(Station s) {
        return claimsAllow(s.getZone());
    }

    /**
     * Zones autorisées par le jeton vérifié par {@link AuthenticationFilter}. Fermé par défaut :
     * sans jeton vérifié (ne devrait pas arriver derrière {@code @RequiresScope}), rien n'est visible.
     */
    private boolean claimsAllow(String zone) {
        Object claims = request == null ? null : request.getAttribute(AuthenticationFilter.CLAIMS_PROPERTY);
        return claims instanceof TokenService.Claims c && c.allowsZone(zone);
    }
}

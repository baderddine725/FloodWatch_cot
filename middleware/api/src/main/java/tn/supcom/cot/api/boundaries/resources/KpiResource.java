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
import tn.supcom.cot.api.controllers.managers.PredictionHistory;
import tn.supcom.cot.api.controllers.managers.StationManager;
import tn.supcom.cot.api.controllers.repositories.SensorDiagnosticRepository;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Indicateurs de performance.
 * <ul>
 *   <li>GET /api/kpi?days=7 ou ?from=...&amp;to=... (ISO-8601) : indicateurs d'exploitation ;</li>
 *   <li>GET /api/kpi/predictions?hours=24 : erreur des modèles de prédiction, par horizon ;</li>
 *   <li>GET /api/kpi/sensors/{code}?hours=24 : santé du capteur de niveau d'une station.</li>
 * </ul>
 */
@Path("kpi")
@RequestScoped
@Transactional
@RolesAllowed({"OPERATOR", "ADMIN"})
@Produces(MediaType.APPLICATION_JSON)
public class KpiResource {
    @Inject
    private KpiManager kpi;
    @Inject
    private PredictionHistory predictionHistory;
    @Inject
    private StationManager stationManager;
    @Inject
    private SensorDiagnosticRepository diagnostics;

    @GET
    public Map<String, Object> get(@QueryParam("from") String from, @QueryParam("to") String to,
                                   @QueryParam("days") @DefaultValue("7") int days) {
        var end = to == null ? Instant.now() : Instant.parse(to);
        var start = from == null ? end.minus(Duration.ofDays(Math.max(1, Math.min(days, 366)))) : Instant.parse(from);
        if (!start.isBefore(end)) throw new BadRequestException("from must be before to");
        return kpi.compute(start, end);
    }

    /**
     * Qualité des prédictions, mesurée sur des prédictions réellement émises puis confrontées
     * au niveau observé à l'échéance. Chaque ligne donne un modèle à un horizon.
     */
    @GET
    @Path("predictions")
    public Map<String, Object> predictions(@QueryParam("hours") @DefaultValue("24") int hours) {
        var end = Instant.now();
        var start = end.minus(Duration.ofHours(Math.max(1, Math.min(hours, 24 * 90))));
        var body = new LinkedHashMap<String, Object>();
        body.put("from", start.toString());
        body.put("to", end.toString());
        body.put("horizons", predictionHistory.metrics(start, end));
        return body;
    }

    /**
     * Santé du capteur de niveau d'une station : répartition des lectures retenues, écartées
     * (échos parasites) et en défaut, avec la qualité moyenne des échos pour chaque cas.
     */
    @GET
    @Path("sensors/{code}")
    public Map<String, Object> sensor(@PathParam("code") String code, @QueryParam("hours") @DefaultValue("24") int hours) {
        var station = stationManager.find(code);
        var end = Instant.now();
        var start = end.minus(Duration.ofHours(Math.max(1, Math.min(hours, 24 * 90))));
        long total = 0;
        var verdicts = new LinkedHashMap<String, Object>();
        for (Object[] row : diagnostics.verdictStats(station, start, end)) {
            var entry = new LinkedHashMap<String, Object>();
            entry.put("count", row[1]);
            entry.put("avgEchoOk", round(row[2]));
            entry.put("avgEchoSpreadCm", round(row[3]));
            verdicts.put(String.valueOf(row[0]), entry);
            total += (Long) row[1];
        }
        var body = new LinkedHashMap<String, Object>();
        body.put("station", station.getCode());
        body.put("from", start.toString());
        body.put("to", end.toString());
        body.put("readings", total);
        body.put("verdicts", verdicts);
        return body;
    }

    private static Double round(Object value) {
        return value == null ? null : Math.round(((Number) value).doubleValue() * 100.0) / 100.0;
    }
}

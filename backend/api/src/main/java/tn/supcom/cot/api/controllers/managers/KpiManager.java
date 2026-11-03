/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : KpiManager.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.managers;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import tn.supcom.cot.api.controllers.repositories.AlertRepository;
import tn.supcom.cot.api.controllers.repositories.CommandRepository;
import tn.supcom.cot.api.controllers.repositories.MeasurementRepository;
import tn.supcom.cot.api.controllers.repositories.StationRepository;
import tn.supcom.cot.api.entities.Alert;
import tn.supcom.cot.api.entities.AlertType;
import tn.supcom.cot.api.entities.CommandStatus;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * Indicateurs de performance (KPI) : disponibilité des stations, alertes par niveau,
 * délai détection→fermeture, durée de fermeture, fréquence des inondations par station,
 * taux de succès des commandes.
 */
@ApplicationScoped
public class KpiManager {
    @Inject
    private StationRepository stations;
    @Inject
    private AlertRepository alerts;
    @Inject
    private MeasurementRepository measurements;
    @Inject
    private CommandRepository commands;

    /** Calcule les KPI sur la période [from, to]. */
    public Map<String, Object> compute(Instant from, Instant to) {
        var result = new LinkedHashMap<String, Object>();
        result.put("from", from.toString());
        result.put("to", to.toString());
        var all = stations.listOrdered();
        result.put("stationsTotal", all.size());
        result.put("stationsOnline", all.stream().filter(s -> s.isOnline()).count());

        List<Alert> period = alerts.findOverlapping(from, to);
        var raisedInPeriod = period.stream().filter(a -> !a.getRaisedAt().isBefore(from)).toList();
        var byLevel = new TreeMap<String, Long>();
        var byType = new TreeMap<String, Long>();
        for (var a : raisedInPeriod) {
            byLevel.merge(a.getLevel().name(), 1L, Long::sum);
            byType.merge(a.getType().name(), 1L, Long::sum);
        }
        result.put("alertsTotal", raisedInPeriod.size());
        result.put("alertsByLevel", byLevel);
        result.put("alertsByType", byType);
        result.put("alertsActive", period.stream().filter(Alert::isActive).count());

        // Délai détection -> fermeture de la barrière, durée de fermeture
        var delays = raisedInPeriod.stream().filter(a -> a.getBarrierClosedAt() != null)
                .mapToDouble(a -> Duration.between(a.getRaisedAt(), a.getBarrierClosedAt()).toMillis() / 1000.0)
                .map(d -> Math.max(0, d)).toArray();
        result.put("closureDelaySecAvg", round(Arrays.stream(delays).average().orElse(Double.NaN)));
        result.put("closureDelaySecMax", round(Arrays.stream(delays).max().orElse(Double.NaN)));
        result.put("closures", delays.length);
        var durations = period.stream().filter(a -> a.getBarrierClosedAt() != null && a.getBarrierReopenedAt() != null)
                .mapToDouble(a -> Duration.between(a.getBarrierClosedAt(), a.getBarrierReopenedAt()).toSeconds() / 60.0)
                .toArray();
        result.put("closureDurationMinAvg", round(Arrays.stream(durations).average().orElse(Double.NaN)));

        // Disponibilité : 1 - durée hors ligne / durée de la période
        double periodSec = Math.max(1, Duration.between(from, to).toSeconds());
        var availability = new LinkedHashMap<String, Double>();
        var floods = new LinkedHashMap<String, Long>();
        for (var s : all) {
            double offline = period.stream()
                    .filter(a -> a.getType() == AlertType.OFFLINE && a.getStation().equals(s))
                    .mapToDouble(a -> {
                        var start = a.getRaisedAt().isBefore(from) ? from : a.getRaisedAt();
                        var end = a.getResolvedAt() == null || a.getResolvedAt().isAfter(to) ? to : a.getResolvedAt();
                        return Math.max(0, Duration.between(start, end).toSeconds());
                    }).sum();
            availability.put(s.getCode(), round(100.0 * (1 - offline / periodSec)));
            floods.put(s.getCode(), raisedInPeriod.stream().filter(a -> a.getStation().equals(s)
                    && a.getType() == AlertType.LEVEL && "RED".equals(a.getLevel().name())).count());
        }
        result.put("availabilityPct", availability);
        result.put("availabilityPctAvg", round(availability.values().stream().mapToDouble(d -> d).average().orElse(Double.NaN)));
        result.put("floodsByStation", floods);

        var cmds = commands.findBetween(from, to);
        long acked = cmds.stream().filter(c -> c.getStatus() == CommandStatus.ACKED).count();
        result.put("commandsTotal", cmds.size());
        result.put("commandsAckedPct", cmds.isEmpty() ? null : round(100.0 * acked / cmds.size()));
        result.put("measurements", measurements.countBetween(from, to));
        return result;
    }

    private static Double round(double v) {
        return Double.isNaN(v) ? null : Math.round(v * 100.0) / 100.0;
    }
}

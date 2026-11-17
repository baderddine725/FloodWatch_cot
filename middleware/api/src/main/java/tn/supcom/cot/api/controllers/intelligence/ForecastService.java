/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware (intelligence Cloud)
 *  Fichier   : ForecastService.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-17          Modifié le : 2026-11-17
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.intelligence;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import tn.supcom.cot.api.controllers.alerting.AlertEngine;
import tn.supcom.cot.api.controllers.managers.AppConfig;
import tn.supcom.cot.api.controllers.repositories.MeasurementRepository;
import tn.supcom.cot.api.controllers.repositories.PredictionRepository;
import tn.supcom.cot.api.controllers.repositories.StationRepository;
import tn.supcom.cot.api.entities.Measurement;
import tn.supcom.cot.api.entities.Station;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Service de prévision multi-horizon, exposé aux opérateurs et aux clients d'API.
 * <ul>
 *   <li><b>Méthode</b> : modèle réservoir CALIBRÉ par la passerelle (fog) quand la calibration est
 *       récente et explique suffisamment les mesures (R²) ; sinon régression linéaire du moteur
 *       d'alerte (la référence).</li>
 *   <li><b>Incertitude</b> : erreur MESURÉE de la même méthode au même horizon, sur 7 jours, par
 *       l'historique des prédictions ; extrapolée en √h au-delà du plus long horizon mesuré ; valeur
 *       par défaut prudente sans historique. L'origine est toujours indiquée.</li>
 *   <li><b>Hypothèses</b> : pluie constante sur l'horizon (pas de prévision météo), niveau amont
 *       constant au-delà de ce qui est déjà mesuré. Elles figurent dans la réponse.</li>
 * </ul>
 */
@ApplicationScoped
public class ForecastService {
    /** Identifiant du modèle réservoir dans l'historique des prédictions. */
    public static final String RESERVOIR = "reservoir-calibrated";
    /** Identifiant de la méthode de référence (même chaîne que le moteur d'alerte). */
    public static final String LINEAR = new AlertEngine().modelId();
    private static final Duration RAIN_WINDOW = Duration.ofMinutes(10);
    private static final int MIN_SCORED = 30;

    private final double minR2 = Double.parseDouble(AppConfig.get("forecast.calibration.min.r2", "0.5"));
    private final Duration maxAge = Duration.ofHours(AppConfig.getLong("forecast.calibration.max.age.hours", 24));

    @Inject
    private StationRepository stations;
    @Inject
    private MeasurementRepository measurements;
    @Inject
    private PredictionRepository predictions;

    public record Horizon(int minutes, double levelCm, double levelPct, double overflowRisk, double sigmaCm,
                          String sigmaBasis) {
    }

    public record Forecast(String station, String zone, Instant generatedAt, String method, String modelVersion,
                           Double levelCm, double criticalCm, String risk, List<Horizon> horizons,
                           Map<String, Object> assumptions, Map<String, Object> calibration) {
    }

    /** La calibration du site est-elle utilisable (présente, récente, R² suffisant) ? */
    public boolean calibrated(Station s, Instant now) {
        return s.getResponseA() != null && s.getResponseB() != null && s.getCalibratedAt() != null
                && s.getCalibrationR2() != null && s.getCalibrationR2() >= minR2
                && !s.getCalibratedAt().isBefore(now.minus(maxAge));
    }

    /** Niveaux prévus par le modèle réservoir aux horizons donnés (s), si le site est calibré. */
    public Optional<double[]> reservoirLevels(Station s, double[] horizonsS, Instant now) {
        if (!calibrated(s, now) || s.getLevelCm() == null) return Optional.empty();
        var model = new ReservoirModel(s.getResponseA(), s.getResponseB(),
                s.getResponseG() == null ? 0.0 : s.getResponseG());
        var upstream = upstreamInput(s, now);
        return Optional.of(model.forecast(s.getLevelCm(), recentRain(s, now), upstream::at, horizonsS,
                s.getThresholds().getSensorHeightCm()));
    }

    /** Prévision complète d'une station. */
    public Forecast forecast(Station s, int[] horizonsMin, Instant now) {
        double critical = s.getThresholds().getCriticalCm();
        double height = s.getThresholds().getSensorHeightCm();
        double[] horizonsS = new double[horizonsMin.length];
        for (int i = 0; i < horizonsMin.length; i++) horizonsS[i] = horizonsMin[i] * 60.0;

        var reservoir = reservoirLevels(s, horizonsS, now);
        String method = reservoir.isPresent() ? RESERVOIR : LINEAR;
        double level0 = s.getLevelCm() == null ? 0.0 : s.getLevelCm();
        double slope = s.getSlopeCmPerMin() == null ? 0.0 : s.getSlopeCmPerMin();
        double[] levels = reservoir.orElseGet(() -> {
            double[] l = new double[horizonsMin.length];
            for (int i = 0; i < l.length; i++) l[i] = Math.max(0.0, Math.min(height, level0 + slope * horizonsMin[i]));
            return l;
        });

        var errors = measuredRmse(method, now);
        var out = new ArrayList<Horizon>();
        double worst = 0.0;
        for (int i = 0; i < horizonsMin.length; i++) {
            var sigma = sigmaFor(errors, horizonsMin[i]);
            double risk = OverflowRisk.risk(levels[i], critical, sigma.value());
            worst = Math.max(worst, risk);
            out.add(new Horizon(horizonsMin[i], round(levels[i]), round(100.0 * levels[i] / critical), round(risk),
                    round(sigma.value()), sigma.basis()));
        }
        var assumptions = new LinkedHashMap<String, Object>();
        assumptions.put("rain", "constante sur l'horizon (persistance de la pluie des 10 dernières minutes)");
        assumptions.put("rainNow", round(recentRain(s, now)));
        if (RESERVOIR.equals(method) && s.getUpstreamLinks() != null && !s.getUpstreamLinks().isBlank()) {
            assumptions.put("upstream", "niveaux amont mesurés pendant le temps de parcours, constants au-delà");
        }
        assumptions.put("overflowRisk", "indice ordonné P(niveau >= critique) sous erreur gaussienne mesurée, "
                + "non calibré sur des épisodes réels");
        Map<String, Object> calibration = null;
        if (s.getResponseA() != null) {
            calibration = new LinkedHashMap<>();
            calibration.put("a", s.getResponseA());
            calibration.put("b", s.getResponseB());
            calibration.put("g", s.getResponseG());
            calibration.put("r2", s.getCalibrationR2());
            calibration.put("samples", s.getCalibrationSamples());
            calibration.put("calibratedAt", s.getCalibratedAt());
            calibration.put("used", RESERVOIR.equals(method));
        }
        return new Forecast(s.getCode(), s.getZone(), now, method, method, s.getLevelCm(), critical,
                OverflowRisk.label(worst), out, assumptions, calibration);
    }

    // ------------------------------------------------------------------------------------------ données
    private double recentRain(Station s, Instant now) {
        var recent = measurements.findSince(s, now.minus(RAIN_WINDOW));
        if (recent.isEmpty()) return s.getRain() == null ? 0.0 : s.getRain();
        double sum = 0.0;
        for (Measurement m : recent) sum += m.getRain();
        return sum / recent.size();
    }

    /** Apport amont Σ L_amont(t − τ) en fonction du décalage depuis maintenant. */
    private UpstreamInput upstreamInput(Station s, Instant now) {
        var series = new ArrayList<UpstreamSeries>();
        for (var link : parseLinks(s.getUpstreamLinks())) {
            stations.findByCode(link.code()).ifPresent(up -> {
                var history = measurements.findSince(up, now.minusSeconds((long) link.travelSec() + 120));
                double latest = up.getLevelCm() == null ? 0.0 : up.getLevelCm();
                series.add(new UpstreamSeries(link.travelSec(), history, latest, now));
            });
        }
        return new UpstreamInput(series);
    }

    record Link(String code, double travelSec) {
    }

    /** Liens amont stockés sous la forme « code:temps_s,code2:temps_s ». */
    static List<Link> parseLinks(String text) {
        var out = new ArrayList<Link>();
        if (text == null || text.isBlank()) return out;
        for (String part : text.split(",")) {
            String[] kv = part.trim().split(":");
            if (kv.length == 2 && !kv[0].isBlank()) {
                try {
                    out.add(new Link(kv[0].trim(), Double.parseDouble(kv[1].trim())));
                } catch (NumberFormatException ignored) {
                    // lien mal formé : ignoré
                }
            }
        }
        return out;
    }

    record UpstreamSeries(double travelSec, List<Measurement> history, double latest, Instant now) {
        double at(double offsetS) {
            Instant target = now.plusMillis((long) ((offsetS - travelSec) * 1000));
            if (!target.isBefore(now) || history.isEmpty()) return latest;
            double v = history.get(0).getLevelCm();
            for (Measurement m : history) {
                if (m.getTs().isAfter(target)) break;
                v = m.getLevelCm();
            }
            return v;
        }
    }

    record UpstreamInput(List<UpstreamSeries> series) {
        double at(double offsetS) {
            double sum = 0.0;
            for (var s : series) sum += s.at(offsetS);
            return sum;
        }
    }

    // ------------------------------------------------------------------------------------------ erreurs
    record Sigma(double value, String basis) {
    }

    /** RMSE mesurée par horizon (minutes) pour une méthode, sur 7 jours. */
    private Map<Integer, Double> measuredRmse(String model, Instant now) {
        var out = new LinkedHashMap<Integer, Double>();
        for (Object[] r : predictions.errorStats(now.minus(Duration.ofDays(7)), now)) {
            if (!model.equals(r[0]) || ((Number) r[2]).longValue() < MIN_SCORED || r[5] == null) continue;
            out.put(((Number) r[1]).intValue() / 60, ((Number) r[5]).doubleValue());
        }
        return out;
    }

    static Sigma sigmaFor(Map<Integer, Double> rmseByMin, int horizonMin) {
        Double exact = rmseByMin.get(horizonMin);
        if (exact != null) return new Sigma(exact, "measured");
        int best = -1;
        for (int h : rmseByMin.keySet()) if (h < horizonMin && h > best) best = h;
        if (best > 0) return new Sigma(OverflowRisk.extrapolateSigma(rmseByMin.get(best), best, horizonMin),
                "extrapolated-from-" + best + "min");
        return new Sigma(OverflowRisk.defaultSigma(horizonMin), "default");
    }

    private static double round(double v) {
        return Math.round(v * 1000.0) / 1000.0;
    }
}

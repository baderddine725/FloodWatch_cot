/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware (intelligence Cloud)
 *  Fichier   : WeatherService.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-23          Modifié le : 2026-11-23
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.intelligence;

import jakarta.enterprise.context.ApplicationScoped;
import tn.supcom.cot.api.controllers.managers.AppConfig;
import tn.supcom.cot.api.entities.Station;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;
import java.util.regex.Pattern;

/**
 * Prévision de pluie pour les stations (entrée météo de la prévision du Cloud).
 * <ul>
 *   <li>{@code forecast.weather.provider} : {@code none} (défaut : persistance de la pluie mesurée)
 *       ou {@code open-meteo} (API publique sans clé, pas de 15 min). <b>Désactivé par défaut</b> :
 *       avec le simulateur, la pluie réelle de la zone n'a rien à voir avec la pluie simulée.</li>
 *   <li>Ne part vers le service météo que la position de la station (arrondie à 0,01°, ~1 km), jamais
 *       une donnée d'utilisateur. Réponses gardées 10 min par point ; un échec est gardé 2 min et la
 *       prévision retombe sur la persistance, sans bloquer la requête (délai 3 s).</li>
 *   <li>Conversion : cumul en mm par pas -> mm/h -> intensité normalisée, {@code forecast.rain.full.mmh}
 *       (20 mm/h, forte averse) valant 1. Hypothèse à recaler sur le pluviomètre réel.</li>
 * </ul>
 */
@ApplicationScoped
public class WeatherService {
    public static final String NONE = "none";
    public static final String OPEN_METEO = "open-meteo";
    private static final Logger LOG = Logger.getLogger(WeatherService.class.getName());
    private static final Duration TTL = Duration.ofMinutes(10);
    private static final Duration FAILURE_TTL = Duration.ofMinutes(2);
    private static final long STEP_S = 900;

    private final String provider = AppConfig.get("forecast.weather.provider", NONE).toLowerCase(Locale.ROOT);
    private final String url = AppConfig.get("forecast.weather.url", "https://api.open-meteo.com/v1/forecast");
    private final double fullMmPerHour = Double.parseDouble(AppConfig.get("forecast.rain.full.mmh", "20"));
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();
    private volatile HttpClient http;

    private record Cached(Instant at, Optional<RainOutlook> outlook) {
    }

    /** Fournisseur configuré ({@code none} ou {@code open-meteo}). */
    public String provider() {
        return provider;
    }

    /** Prévision de pluie sur la station, si un fournisseur est configuré et répond. */
    public Optional<RainOutlook> outlook(Station s, Instant now) {
        if (!OPEN_METEO.equals(provider)) {
            return Optional.empty();
        }
        String key = String.format(Locale.ROOT, "%.2f,%.2f", s.getLatitude(), s.getLongitude());
        var hit = cache.get(key);
        if (hit != null) {
            Duration ttl = hit.outlook().isPresent() ? TTL : FAILURE_TTL;
            if (hit.at().plus(ttl).isAfter(now)) return hit.outlook();
        }
        Optional<RainOutlook> fresh = fetch(key, now);
        cache.put(key, new Cached(now, fresh));
        return fresh;
    }

    private Optional<RainOutlook> fetch(String latLon, Instant now) {
        String[] ll = latLon.split(",");
        var uri = URI.create(url + "?latitude=" + ll[0] + "&longitude=" + ll[1]
                + "&minutely_15=precipitation&past_minutely_15=1&forecast_minutely_15=12&timezone=GMT");
        try {
            if (http == null) http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
            var resp = http.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(3))
                    .header("User-Agent", "FloodWatch-forecast").GET().build(), HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                LOG.warning(() -> "weather provider HTTP " + resp.statusCode());
                return Optional.empty();
            }
            return parseOpenMeteo(resp.body(), now, fullMmPerHour);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Optional.empty();
        } catch (Exception e) {
            LOG.warning(() -> "weather provider unavailable: " + e.getMessage());
            return Optional.empty();
        }
    }

    private static final Pattern BLOCK = Pattern.compile("\"minutely_15\"\\s*:\\s*\\{(.*?)\\}", Pattern.DOTALL);
    private static final Pattern TIMES = Pattern.compile("\"time\"\\s*:\\s*\\[(.*?)]", Pattern.DOTALL);
    private static final Pattern RAIN = Pattern.compile("\"precipitation\"\\s*:\\s*\\[(.*?)]", Pattern.DOTALL);

    /**
     * Lit la réponse d'Open-Meteo ({@code minutely_15.time} en GMT, {@code minutely_15.precipitation}
     * en mm cumulés sur les 15 min PRÉCÉDANT chaque instant). Les pas sont réalignés sur leur début.
     * Une valeur absente ({@code null}) est prise comme nulle.
     */
    static Optional<RainOutlook> parseOpenMeteo(String body, Instant now, double fullMmPerHour) {
        var block = BLOCK.matcher(body == null ? "" : body);
        if (!block.find()) return Optional.empty();
        var t = TIMES.matcher(block.group(1));
        var p = RAIN.matcher(block.group(1));
        if (!t.find() || !p.find()) return Optional.empty();
        List<Instant> times = new ArrayList<>();
        for (String raw : t.group(1).split(",")) {
            String v = raw.trim().replace("\"", "");
            if (!v.isEmpty()) times.add(LocalDateTime.parse(v).toInstant(ZoneOffset.UTC));
        }
        String[] mm = p.group(1).split(",");
        if (times.isEmpty() || mm.length != times.size()) return Optional.empty();
        double[] values = new double[mm.length];
        for (int i = 0; i < mm.length; i++) {
            String v = mm[i].trim();
            double x = v.isEmpty() || "null".equals(v) ? 0.0 : Double.parseDouble(v);
            values[i] = RainOutlook.normalize(x, STEP_S, fullMmPerHour);
        }
        return Optional.of(new RainOutlook(OPEN_METEO, now, times.get(0).minusSeconds(STEP_S), STEP_S, values));
    }
}

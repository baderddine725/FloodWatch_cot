/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware (intelligence Cloud)
 *  Fichier   : LearnedForecaster.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-23          Modifié le : 2026-11-23
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.intelligence;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.json.Json;
import jakarta.json.JsonObject;
import tn.supcom.cot.api.controllers.managers.AppConfig;
import tn.supcom.cot.api.controllers.repositories.MeasurementRepository;
import tn.supcom.cot.api.controllers.repositories.StationRepository;
import tn.supcom.cot.api.entities.Measurement;
import tn.supcom.cot.api.entities.Station;

import java.io.IOException;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Sert les modèles appris déposés par le service d'apprentissage ({@code ml/forecast}).
 * <ul>
 *   <li><b>Registre</b> : {@code <ml.models.dir>/registry.json} désigne le champion et le challenger ;
 *       relu dès qu'il change (au plus une vérification toutes les 30 s). Un fichier illisible ou un
 *       modèle incompatible est journalisé et ignoré : le service continue avec ce qu'il avait.</li>
 *   <li><b>Indicateurs</b> : calculés sur les mesures enregistrées de la station et de ses stations
 *       amont ({@link LearnedFeatures}), exactement comme à l'apprentissage.</li>
 * </ul>
 * Le challenger ne sert jamais une prévision : ses niveaux ne vont qu'à l'historique des prédictions.
 */
@ApplicationScoped
public class LearnedForecaster {
    private static final Logger LOG = Logger.getLogger(LearnedForecaster.class.getName());
    private static final long CHECK_EVERY_MS = 30_000;

    private final boolean enabled = AppConfig.getBool("ml.models.enabled", true);
    private final Path dir = Path.of(AppConfig.get("ml.models.dir", "/opt/floodwatch/models"));

    @Inject
    private StationRepository stations;
    @Inject
    private MeasurementRepository measurements;

    /** État chargé : immuable, remplacé d'un bloc. */
    public record Snapshot(LearnedModel champion, LearnedModel challenger, JsonObject registry, long modified) {
    }

    private volatile Snapshot snapshot = new Snapshot(null, null, null, Long.MIN_VALUE);
    private volatile long lastCheck = 0;
    private final Map<String, LearnedModel> cache = new HashMap<>();

    /** Modèles en service (relit le registre s'il a changé). */
    public Snapshot models() {
        if (!enabled) return snapshot;
        long now = System.currentTimeMillis();
        if (now - lastCheck >= CHECK_EVERY_MS) {
            lastCheck = now;
            reload();
        }
        return snapshot;
    }

    private synchronized void reload() {
        Path file = dir.resolve("registry.json");
        try {
            if (!Files.isRegularFile(file)) {
                if (snapshot.registry() != null) snapshot = new Snapshot(null, null, null, Long.MIN_VALUE);
                return;
            }
            long modified = Files.getLastModifiedTime(file).toMillis();
            if (modified == snapshot.modified()) return;
            JsonObject reg;
            try (var r = Json.createReader(new StringReader(Files.readString(file, StandardCharsets.UTF_8)))) {
                reg = r.readObject();
            }
            snapshot = new Snapshot(load(reg, "champion"), load(reg, "challenger"), reg, modified);
            LOG.info(() -> "Modèles appris : champion=" + id(snapshot.champion()) + ", challenger="
                    + id(snapshot.challenger()));
        } catch (IOException | RuntimeException e) {
            LOG.log(Level.WARNING, "Registre des modèles illisible (" + file + ") : état précédent conservé", e);
        }
    }

    private LearnedModel load(JsonObject reg, String role) {
        if (!reg.containsKey(role) || reg.isNull(role)) return null;
        String id = reg.getString(role);
        if (!id.matches("[A-Za-z0-9._-]{1,48}")) {               // nom de fichier ET identifiant d'historique
            LOG.warning(() -> "Identifiant de modèle refusé : " + id);
            return null;
        }
        return cache.computeIfAbsent(id, k -> {
            try (var r = Files.newBufferedReader(dir.resolve(k + ".json"), StandardCharsets.UTF_8)) {
                return LearnedModel.read(r);
            } catch (IOException | RuntimeException e) {
                LOG.log(Level.WARNING, "Modèle " + k + " illisible ou incompatible : ignoré", e);
                return null;
            }
        });
    }

    private static String id(LearnedModel m) {
        return m == null ? "aucun" : m.modelId();
    }

    // ------------------------------------------------------------------------------------ prévision
    /** Mesures de la station et de ses stations amont, lues une fois pour plusieurs modèles. */
    public record Context(LearnedFeatures.Site site, Map<String, LearnedFeatures.Series> data, double t) {
    }

    public Context context(Station s, Instant now) {
        var links = new ArrayList<LearnedFeatures.Upstream>();
        for (var link : ForecastService.parseLinks(s.getUpstreamLinks())) {
            links.add(new LearnedFeatures.Upstream(link.code(), link.travelSec()));
        }
        var site = new LearnedFeatures.Site(s.getCode(), s.getThresholds().getCriticalCm(),
                s.getThresholds().getSensorHeightCm(), List.copyOf(links));
        var data = new HashMap<String, LearnedFeatures.Series>();
        data.put(s.getCode(), series(s, now, LearnedFeatures.HISTORY_S));
        for (var link : links) {
            // amont : 5 min de pente, ou le niveau à t − parcours, plus la médiane et la péremption
            double back = Math.max(300.0, link.travelS()) + LearnedFeatures.MEDIAN_WINDOW_S + LearnedFeatures.STALE_S;
            stations.findByCode(link.code()).ifPresent(up -> data.put(up.getCode(), series(up, now, back)));
        }
        return new Context(site, data, seconds(now));
    }

    private LearnedFeatures.Series series(Station s, Instant now, double backS) {
        var rows = new ArrayList<double[]>();
        for (Measurement m : measurements.findSince(s, now.minusMillis((long) (backS * 1000) + 1000))) {
            rows.add(new double[]{seconds(m.getTs()), m.getLevelCm(), m.getRain()});
        }
        return LearnedFeatures.series(rows);
    }

    private static double seconds(Instant i) {
        return i.getEpochSecond() + i.getNano() / 1e9;
    }

    /**
     * Niveaux prévus (cm, bornés à [0, hauteur du capteur]) aux horizons demandés (s), ou vide si un
     * horizon dépasse le modèle ou si l'historique ne suffit pas (station muette, démarrage).
     */
    public Optional<double[]> levels(Context c, LearnedModel m, int[] horizonsSec) {
        double[] out = new double[horizonsSec.length];
        Double level0 = null;
        for (int i = 0; i < horizonsSec.length; i++) {
            Double d = m.deltaAt(horizonsSec[i], h -> LearnedFeatures.features(c.site(), c.t(), h, c.data()));
            if (d == null) return Optional.empty();
            if (level0 == null) {
                level0 = c.data().get(c.site().code()).levelAt(c.t());
            }
            out[i] = Math.max(0.0, Math.min(c.site().sensorHeightCm(), level0 + d));
        }
        return Optional.of(out);
    }

    /** Niveau de départ des prévisions apprises (médiane de la dernière minute). */
    public Optional<Double> baseLevel(Context c) {
        var own = c.data().get(c.site().code());
        return Optional.ofNullable(own == null ? null : own.levelAt(c.t()));
    }
}

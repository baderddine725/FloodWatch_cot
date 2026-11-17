/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : PredictionHistory.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-16          Modifié le : 2026-11-16
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.managers;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import tn.supcom.cot.api.controllers.alerting.Prediction;
import tn.supcom.cot.api.controllers.repositories.MeasurementRepository;
import tn.supcom.cot.api.controllers.repositories.PredictionRepository;
import tn.supcom.cot.api.dto.PredictionMetricsDto;
import tn.supcom.cot.api.entities.PredictionRecord;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Historique des prédictions : la boucle de retour qui permet de MESURER un modèle.
 * <ol>
 *   <li>{@link #record} : à intervalle régulier, note ce que le modèle en service annonce pour
 *       chaque horizon (1, 3, 5 et 10 min par défaut) ;</li>
 *   <li>{@link #score} : une fois l'échéance passée, confronte la prévision au niveau
 *       réellement mesuré ;</li>
 *   <li>{@link #metrics} : restitue l'erreur par modèle et par horizon, à côté de celle d'une
 *       référence triviale (« le niveau ne change pas »).</li>
 * </ol>
 * <p>Ce service ne participe à AUCUNE décision d'alerte : il observe. Son enregistrement se fait
 * dans une transaction séparée, afin qu'un incident ici ne puisse jamais annuler le traitement
 * d'une mesure.</p>
 */
@ApplicationScoped
public class PredictionHistory {
    /** Nombre maximal de prédictions évaluées par passage. */
    private static final int BATCH = 500;

    private final boolean enabled = AppConfig.getBool("prediction.history.enabled", true);
    private final int[] horizonsSec = parseHorizons(AppConfig.get("prediction.history.horizons.seconds", "60,180,300,600"));
    private final Duration interval = Duration.ofSeconds(AppConfig.getLong("prediction.history.interval.seconds", 30));
    private final Duration tolerance = Duration.ofSeconds(AppConfig.getLong("prediction.history.tolerance.seconds", 20));
    private final Duration missedAfter = Duration.ofSeconds(AppConfig.getLong("prediction.history.missed.after.seconds", 120));

    @Inject
    private PredictionRepository predictions;
    @Inject
    private MeasurementRepository measurements;

    /** Dernier enregistrement par station (limite le volume : une série par intervalle). */
    private final ConcurrentHashMap<UUID, Instant> lastRecorded = new ConcurrentHashMap<>();

    /**
     * Indique s'il est temps d'enregistrer une série pour cette station, et réserve le créneau.
     *
     * @return vrai au plus une fois par intervalle et par station
     */
    public boolean due(UUID stationId, Instant now) {
        if (!enabled) return false;
        boolean[] granted = {false};
        lastRecorded.compute(stationId, (id, last) -> {
            if (last != null && now.isBefore(last.plus(interval))) return last;
            granted[0] = true;
            return now;
        });
        return granted[0];
    }

    /**
     * Enregistre la prévision du modèle pour chaque horizon.
     *
     * @param stationId  station concernée
     * @param prediction prédiction courante (pente et niveau retenu)
     * @param model      identifiant du modèle en service
     * @param now        instant d'émission
     * @param maxLevelCm plafond physique du niveau (hauteur du capteur)
     */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public void record(UUID stationId, Prediction prediction, String model, Instant now, double maxLevelCm) {
        if (prediction.levelCm() == null) return;
        var station = predictions.stationRef(stationId);
        for (int horizon : horizonsSec) {
            double predicted = Math.min(maxLevelCm, prediction.levelAt(horizon / 60.0));
            predictions.persist(new PredictionRecord(station, now, horizon, model, prediction.levelCm(), predicted));
        }
    }

    /**
     * Enregistre des niveaux prévus par un autre modèle que celui du moteur d'alerte (ex. modèle
     * réservoir calibré) : les deux sont alors évalués sur les mêmes mesures réelles.
     */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public void recordLevels(UUID stationId, String model, Instant now, double baseLevelCm, int[] horizons,
                             double[] levels) {
        var station = predictions.stationRef(stationId);
        for (int i = 0; i < horizons.length && i < levels.length; i++) {
            predictions.persist(new PredictionRecord(station, now, horizons[i], model, baseLevelCm, levels[i]));
        }
    }

    /** Horizons configurés (secondes). */
    public int[] horizonsSec() {
        return horizonsSec.clone();
    }

    /**
     * Évalue les prédictions arrivées à échéance. On attend {@code tolerance} après l'échéance
     * pour que la mesure la plus proche (avant OU après) soit déjà arrivée.
     *
     * @return nombre de prédictions closes (évaluées ou abandonnées)
     */
    @Transactional
    public int score(Instant now) {
        if (!enabled) return 0;
        int closed = 0;
        for (PredictionRecord p : predictions.findDue(now.minus(tolerance), BATCH)) {
            var actual = measurements.findNearest(p.getStation(), p.getTargetAt(), tolerance);
            if (actual.isPresent()) {
                p.score(actual.get().getLevelCm());
                closed++;
            } else if (p.getTargetAt().isBefore(now.minus(missedAfter))) {
                p.miss(); // station muette ou capteur en défaut à l'échéance
                closed++;
            }
        }
        return closed;
    }

    /** Qualité de chaque modèle par horizon sur une période. */
    public List<PredictionMetricsDto> metrics(Instant from, Instant to) {
        var missed = new HashMap<String, Long>();
        for (Object[] r : predictions.missedCounts(from, to)) missed.put(r[0] + "@" + r[1], (Long) r[2]);
        var out = new ArrayList<PredictionMetricsDto>();
        for (Object[] r : predictions.errorStats(from, to)) {
            String model = (String) r[0];
            int horizon = ((Number) r[1]).intValue();
            Double mae = number(r[3]);
            Double reference = number(r[6]);
            Double skill = mae == null || reference == null || reference < 1e-9 ? null : round(1 - mae / reference);
            out.add(new PredictionMetricsDto(model, horizon, (Long) r[2],
                    missed.getOrDefault(model + "@" + horizon, 0L), round(mae), round(number(r[4])),
                    round(number(r[5])), round(reference), skill));
        }
        return out;
    }

    /**
     * Lit une liste d'horizons « 60,180,300 ».
     *
     * @return horizons strictement positifs, triés et sans doublon
     * @throws IllegalArgumentException si la liste est vide ou contient une valeur invalide
     */
    static int[] parseHorizons(String csv) {
        int[] values = Arrays.stream(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty())
                .mapToInt(Integer::parseInt).distinct().sorted().toArray();
        if (values.length == 0 || values[0] <= 0) {
            throw new IllegalArgumentException("prediction.history.horizons.seconds must list positive integers: " + csv);
        }
        return values;
    }

    private static Double number(Object o) {
        return o == null ? null : ((Number) o).doubleValue();
    }

    private static Double round(Double v) {
        return v == null ? null : Math.round(v * 1000.0) / 1000.0;
    }
}

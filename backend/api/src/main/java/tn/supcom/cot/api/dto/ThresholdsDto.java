/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : ThresholdsDto.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.dto;

import tn.supcom.cot.api.entities.StationThresholds;

/** Seuils et paramètres d'une station (champs nuls ignorés lors d'une mise à jour). */
public record ThresholdsDto(Double criticalCm, Double yellowPct, Double orangePct, Double redPct,
                            Double rainThreshold, Double rapidRiseCmPerMin, Double forecastRedMinutes,
                            Integer reopenDelaySec, Double sensorHeightCm, Integer periodNormalSec,
                            Integer periodWatchSec) {

    public static ThresholdsDto of(StationThresholds t) {
        return new ThresholdsDto(t.getCriticalCm(), t.getYellowPct(), t.getOrangePct(), t.getRedPct(),
                t.getRainThreshold(), t.getRapidRiseCmPerMin(), t.getForecastRedMinutes(), t.getReopenDelaySec(),
                t.getSensorHeightCm(), t.getPeriodNormalSec(), t.getPeriodWatchSec());
    }

    /** Applique les champs non nuls puis valide l'ensemble. */
    public void applyTo(StationThresholds t) {
        if (criticalCm != null) t.setCriticalCm(criticalCm);
        if (yellowPct != null) t.setYellowPct(yellowPct);
        if (orangePct != null) t.setOrangePct(orangePct);
        if (redPct != null) t.setRedPct(redPct);
        if (rainThreshold != null) t.setRainThreshold(rainThreshold);
        if (rapidRiseCmPerMin != null) t.setRapidRiseCmPerMin(rapidRiseCmPerMin);
        if (forecastRedMinutes != null) t.setForecastRedMinutes(forecastRedMinutes);
        if (reopenDelaySec != null) t.setReopenDelaySec(reopenDelaySec);
        if (sensorHeightCm != null) t.setSensorHeightCm(sensorHeightCm);
        if (periodNormalSec != null) t.setPeriodNormalSec(periodNormalSec);
        if (periodWatchSec != null) t.setPeriodWatchSec(periodWatchSec);
        t.toEngine(); // lève IllegalArgumentException si incohérent
        if (t.getSensorHeightCm() < t.getCriticalCm()) {
            throw new IllegalArgumentException("sensorHeightCm must be >= criticalCm");
        }
        if (t.getPeriodWatchSec() < 1 || t.getPeriodNormalSec() < t.getPeriodWatchSec()) {
            throw new IllegalArgumentException("periods must satisfy 1 <= watch <= normal");
        }
    }
}

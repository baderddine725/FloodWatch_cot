/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : StationThresholds.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.entities;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import tn.supcom.cot.api.controllers.alerting.Thresholds;

/**
 * Paramétrage d'une station : seuils d'alerte et paramètres envoyés au firmware.
 * Valeurs par défaut adaptées à la maquette (bac de 30 cm, 20 cm critiques).
 */
@Embeddable
public class StationThresholds {
    /** Hauteur d'eau critique (cm). */
    @Column(name = "critical_cm", nullable = false)
    private double criticalCm = 20;
    @Column(name = "yellow_pct", nullable = false)
    private double yellowPct = 30;
    @Column(name = "orange_pct", nullable = false)
    private double orangePct = 60;
    @Column(name = "red_pct", nullable = false)
    private double redPct = 85;
    @Column(name = "rain_threshold", nullable = false)
    private double rainThreshold = 0.2;
    @Column(name = "rapid_rise_cm_min", nullable = false)
    private double rapidRiseCmPerMin = 3.0;
    @Column(name = "forecast_red_min", nullable = false)
    private double forecastRedMinutes = 10;
    @Column(name = "reopen_delay_sec", nullable = false)
    private int reopenDelaySec = 60;
    /** Distance capteur ultrasonique – fond (cm) : niveau = hauteur capteur – distance mesurée. */
    @Column(name = "sensor_height_cm", nullable = false)
    private double sensorHeightCm = 30;
    @Column(name = "period_normal_sec", nullable = false)
    private int periodNormalSec = 30;
    @Column(name = "period_watch_sec", nullable = false)
    private int periodWatchSec = 5;

    /** @return les seuils au format du moteur d'alerte (validés) */
    public Thresholds toEngine() {
        return new Thresholds(criticalCm, yellowPct, orangePct, redPct, rainThreshold,
                rapidRiseCmPerMin, forecastRedMinutes, reopenDelaySec);
    }

    public double getCriticalCm() { return criticalCm; }
    public void setCriticalCm(double v) { criticalCm = v; }
    public double getYellowPct() { return yellowPct; }
    public void setYellowPct(double v) { yellowPct = v; }
    public double getOrangePct() { return orangePct; }
    public void setOrangePct(double v) { orangePct = v; }
    public double getRedPct() { return redPct; }
    public void setRedPct(double v) { redPct = v; }
    public double getRainThreshold() { return rainThreshold; }
    public void setRainThreshold(double v) { rainThreshold = v; }
    public double getRapidRiseCmPerMin() { return rapidRiseCmPerMin; }
    public void setRapidRiseCmPerMin(double v) { rapidRiseCmPerMin = v; }
    public double getForecastRedMinutes() { return forecastRedMinutes; }
    public void setForecastRedMinutes(double v) { forecastRedMinutes = v; }
    public int getReopenDelaySec() { return reopenDelaySec; }
    public void setReopenDelaySec(int v) { reopenDelaySec = v; }
    public double getSensorHeightCm() { return sensorHeightCm; }
    public void setSensorHeightCm(double v) { sensorHeightCm = v; }
    public int getPeriodNormalSec() { return periodNormalSec; }
    public void setPeriodNormalSec(int v) { periodNormalSec = v; }
    public int getPeriodWatchSec() { return periodWatchSec; }
    public void setPeriodWatchSec(int v) { periodWatchSec = v; }
}

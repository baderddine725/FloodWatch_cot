/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : Station.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.entities;

import jakarta.persistence.*;
import tn.supcom.cot.api.controllers.alerting.AlertLevel;
import tn.supcom.cot.core.entities.UUIDPKEntity;

import java.time.Instant;

/**
 * Station FloodWatch (Thing) : métadonnées, seuils et dernier état connu (jumeau numérique).
 * Le {@code code} est l'identifiant utilisé dans les topics MQTT
 * ({@code floodwatch/stations/<code>/...}).
 */
@Entity
@Table(name = "stations")
public class Station extends UUIDPKEntity {
    @Column(nullable = false, unique = true, length = 64)
    private String code;
    @Column(nullable = false)
    private String name;
    @Column(length = 1000)
    private String description;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private StationType type = StationType.OTHER;
    private double latitude;
    private double longitude;
    private String address;
    @Embedded
    private StationThresholds thresholds = new StationThresholds();
    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    // ---- état temps réel ----
    @Enumerated(EnumType.STRING)
    @Column(name = "alert_level", nullable = false, length = 8)
    private AlertLevel alertLevel = AlertLevel.GREEN;
    @Column(name = "level_cm")
    private Double levelCm;
    @Column(name = "level_pct")
    private Double levelPct;
    private Double rain;
    @Column(name = "slope_cm_min")
    private Double slopeCmPerMin;
    @Column(name = "minutes_to_overflow")
    private Double minutesToOverflow;
    @Column(name = "risk_index")
    private Integer riskIndex;
    @Column(name = "alert_reasons", length = 500)
    private String alertReasons;
    @Column(name = "last_measurement_at")
    private Instant lastMeasurementAt;
    @Column(name = "last_seen_at")
    private Instant lastSeenAt;
    @Column(name = "below_orange_since")
    private Instant belowOrangeSince;
    @Column(nullable = false)
    private boolean online;
    @Column(name = "sensor_fault", nullable = false)
    private boolean sensorFault;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8)
    private BarrierState barrier = BarrierState.UNKNOWN;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8)
    private LightColor light = LightColor.UNKNOWN;
    @Column(nullable = false)
    private boolean siren;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8)
    private SamplingMode sampling = SamplingMode.NORMAL;
    @Enumerated(EnumType.STRING)
    @Column(name = "control_mode", nullable = false, length = 8)
    private ControlMode controlMode = ControlMode.AUTO;
    @Column(name = "local_safety", nullable = false)
    private boolean localSafety;
    /** Mode de décision de la station : NORMAL, LOCAL_SAFETY ou DEGRADED (capteur aveugle). */
    @Column(name = "station_mode", length = 16)
    private String stationMode;
    /** Zone géographique (périmètre des clients d'API), ex. « ariana ». */
    @Column(length = 64)
    private String zone;
    /** Réponse du site estimée par la passerelle : dL/dt = a·pluie − b·L + g·Σ L_amont(t − τ). */
    @Column(name = "response_a")
    private Double responseA;
    @Column(name = "response_b")
    private Double responseB;
    @Column(name = "response_g")
    private Double responseG;
    @Column(name = "calibration_r2")
    private Double calibrationR2;
    @Column(name = "calibration_samples")
    private Integer calibrationSamples;
    @Column(name = "calibrated_at")
    private Instant calibratedAt;
    /** Stations amont et temps de parcours, « code:secondes,code2:secondes » (topologie de la passerelle). */
    @Column(name = "upstream_links", length = 512)
    private String upstreamLinks;
    private String firmware;
    private Integer rssi;
    @Column(name = "uptime_sec")
    private Long uptimeSec;

    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public StationType getType() { return type; }
    public void setType(StationType type) { this.type = type; }
    public double getLatitude() { return latitude; }
    public void setLatitude(double latitude) { this.latitude = latitude; }
    public double getLongitude() { return longitude; }
    public void setLongitude(double longitude) { this.longitude = longitude; }
    public String getAddress() { return address; }
    public void setAddress(String address) { this.address = address; }
    public StationThresholds getThresholds() { return thresholds; }
    public void setThresholds(StationThresholds thresholds) { this.thresholds = thresholds; }
    public Instant getCreatedAt() { return createdAt; }
    public AlertLevel getAlertLevel() { return alertLevel; }
    public void setAlertLevel(AlertLevel alertLevel) { this.alertLevel = alertLevel; }
    public Double getLevelCm() { return levelCm; }
    public void setLevelCm(Double levelCm) { this.levelCm = levelCm; }
    public Double getLevelPct() { return levelPct; }
    public void setLevelPct(Double levelPct) { this.levelPct = levelPct; }
    public Double getRain() { return rain; }
    public void setRain(Double rain) { this.rain = rain; }
    public Double getSlopeCmPerMin() { return slopeCmPerMin; }
    public void setSlopeCmPerMin(Double v) { this.slopeCmPerMin = v; }
    public Double getMinutesToOverflow() { return minutesToOverflow; }
    public void setMinutesToOverflow(Double v) { this.minutesToOverflow = v; }
    public Integer getRiskIndex() { return riskIndex; }
    public void setRiskIndex(Integer riskIndex) { this.riskIndex = riskIndex; }
    public String getAlertReasons() { return alertReasons; }
    public void setAlertReasons(String alertReasons) { this.alertReasons = alertReasons; }
    public Instant getLastMeasurementAt() { return lastMeasurementAt; }
    public void setLastMeasurementAt(Instant v) { this.lastMeasurementAt = v; }
    public Instant getLastSeenAt() { return lastSeenAt; }
    public void setLastSeenAt(Instant lastSeenAt) { this.lastSeenAt = lastSeenAt; }
    public Instant getBelowOrangeSince() { return belowOrangeSince; }
    public void setBelowOrangeSince(Instant v) { this.belowOrangeSince = v; }
    public boolean isOnline() { return online; }
    public void setOnline(boolean online) { this.online = online; }
    public boolean isSensorFault() { return sensorFault; }
    public void setSensorFault(boolean sensorFault) { this.sensorFault = sensorFault; }
    public BarrierState getBarrier() { return barrier; }
    public void setBarrier(BarrierState barrier) { this.barrier = barrier; }
    public LightColor getLight() { return light; }
    public void setLight(LightColor light) { this.light = light; }
    public boolean isSiren() { return siren; }
    public void setSiren(boolean siren) { this.siren = siren; }
    public SamplingMode getSampling() { return sampling; }
    public void setSampling(SamplingMode sampling) { this.sampling = sampling; }
    public ControlMode getControlMode() { return controlMode; }
    public void setControlMode(ControlMode controlMode) { this.controlMode = controlMode; }
    public boolean isLocalSafety() { return localSafety; }
    public void setLocalSafety(boolean localSafety) { this.localSafety = localSafety; }
    public String getStationMode() { return stationMode; }
    public String getZone() { return zone; }
    public void setZone(String zone) { this.zone = zone; }
    public Double getResponseA() { return responseA; }
    public Double getResponseB() { return responseB; }
    public Double getResponseG() { return responseG; }
    public Double getCalibrationR2() { return calibrationR2; }
    public Integer getCalibrationSamples() { return calibrationSamples; }
    public Instant getCalibratedAt() { return calibratedAt; }
    public String getUpstreamLinks() { return upstreamLinks; }
    /** Enregistre la calibration reçue de la passerelle. */
    public void calibrate(Double a, Double b, Double g, Double r2, Integer samples, String upstreamLinks, Instant at) {
        this.responseA = a;
        this.responseB = b;
        this.responseG = g;
        this.calibrationR2 = r2;
        this.calibrationSamples = samples;
        this.upstreamLinks = upstreamLinks;
        this.calibratedAt = at;
    }
    public void setStationMode(String stationMode) { this.stationMode = stationMode; }
    public String getFirmware() { return firmware; }
    public void setFirmware(String firmware) { this.firmware = firmware; }
    public Integer getRssi() { return rssi; }
    public void setRssi(Integer rssi) { this.rssi = rssi; }
    public Long getUptimeSec() { return uptimeSec; }
    public void setUptimeSec(Long uptimeSec) { this.uptimeSec = uptimeSec; }
}

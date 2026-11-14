/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : Measurement.java
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

/** Mesure horodatée reçue d'une station (niveau d'eau, pluie). */
@Entity
@Table(name = "measurements", indexes = @Index(name = "ix_measurements_station_ts", columnList = "station_id, ts"))
public class Measurement extends UUIDPKEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "station_id", nullable = false)
    private Station station;
    @Column(nullable = false)
    private Instant ts;
    @Column(name = "level_cm", nullable = false)
    private double levelCm;
    @Column(name = "level_pct", nullable = false)
    private double levelPct;
    @Column(nullable = false)
    private double rain;
    @Enumerated(EnumType.STRING)
    @Column(name = "alert_level", length = 8)
    private AlertLevel alertLevel;

    protected Measurement() {
    }

    public Measurement(Station station, Instant ts, double levelCm, double levelPct, double rain) {
        this.station = station;
        this.ts = ts;
        this.levelCm = levelCm;
        this.levelPct = levelPct;
        this.rain = rain;
    }

    public Station getStation() { return station; }
    public Instant getTs() { return ts; }
    public double getLevelCm() { return levelCm; }
    public double getLevelPct() { return levelPct; }
    public double getRain() { return rain; }
    public AlertLevel getAlertLevel() { return alertLevel; }
    public void setAlertLevel(AlertLevel alertLevel) { this.alertLevel = alertLevel; }
}

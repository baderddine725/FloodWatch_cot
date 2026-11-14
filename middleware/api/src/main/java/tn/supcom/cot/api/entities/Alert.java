/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : Alert.java
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
 * Alerte (incident) : niveau d'eau, station muette, capteur défaillant, sécurité locale.
 * Les horodatages de fermeture/réouverture de la barrière alimentent les KPI.
 */
@Entity
@Table(name = "alerts", indexes = {
        @Index(name = "ix_alerts_station_active", columnList = "station_id, active"),
        @Index(name = "ix_alerts_raised", columnList = "raised_at")})
public class Alert extends UUIDPKEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "station_id", nullable = false)
    private Station station;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private AlertType type;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8)
    private AlertLevel level;
    @Column(nullable = false, length = 500)
    private String message;
    @Column(name = "raised_at", nullable = false)
    private Instant raisedAt;
    @Column(nullable = false)
    private boolean active = true;
    @Column(name = "resolved_at")
    private Instant resolvedAt;
    @Column(name = "acknowledged_at")
    private Instant acknowledgedAt;
    @Column(name = "acknowledged_by", length = 191)
    private String acknowledgedBy;
    @Column(name = "barrier_closed_at")
    private Instant barrierClosedAt;
    @Column(name = "barrier_reopened_at")
    private Instant barrierReopenedAt;

    protected Alert() {
    }

    public Alert(Station station, AlertType type, AlertLevel level, String message, Instant raisedAt) {
        this.station = station;
        this.type = type;
        this.level = level;
        this.message = message.length() > 500 ? message.substring(0, 500) : message;
        this.raisedAt = raisedAt;
    }

    /** Clôture l'alerte. */
    public void resolve(Instant at) {
        if (active) {
            active = false;
            resolvedAt = at;
        }
    }

    /** Acquittement par un opérateur. */
    public void acknowledge(String by, Instant at) {
        if (acknowledgedAt == null) {
            acknowledgedAt = at;
            acknowledgedBy = by;
        }
    }

    public Station getStation() { return station; }
    public AlertType getType() { return type; }
    public AlertLevel getLevel() { return level; }
    public String getMessage() { return message; }
    public Instant getRaisedAt() { return raisedAt; }
    public boolean isActive() { return active; }
    public Instant getResolvedAt() { return resolvedAt; }
    public Instant getAcknowledgedAt() { return acknowledgedAt; }
    public String getAcknowledgedBy() { return acknowledgedBy; }
    public Instant getBarrierClosedAt() { return barrierClosedAt; }
    public void setBarrierClosedAt(Instant v) { this.barrierClosedAt = v; }
    public Instant getBarrierReopenedAt() { return barrierReopenedAt; }
    public void setBarrierReopenedAt(Instant v) { this.barrierReopenedAt = v; }
}

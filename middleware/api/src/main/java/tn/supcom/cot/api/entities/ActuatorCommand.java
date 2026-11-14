/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : ActuatorCommand.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.entities;

import jakarta.persistence.*;
import tn.supcom.cot.core.entities.UUIDPKEntity;

import java.time.Instant;

/** Trace d'une commande envoyée à un actionneur (audit + suivi de l'acquittement). */
@Entity
@Table(name = "commands", indexes = @Index(name = "ix_commands_station_issued", columnList = "station_id, issued_at"))
public class ActuatorCommand extends UUIDPKEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "station_id", nullable = false)
    private Station station;
    @Column(nullable = false, length = 16)
    private String actuator;
    @Column(name = "cmd_value", nullable = false, length = 16)
    private String value;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8)
    private CommandOrigin origin;
    @Column(name = "issued_by", nullable = false, length = 191)
    private String issuedBy;
    @Column(name = "issued_at", nullable = false)
    private Instant issuedAt;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8)
    private CommandStatus status = CommandStatus.PENDING;
    @Column(name = "acked_at")
    private Instant ackedAt;
    @Column(length = 255)
    private String detail;

    protected ActuatorCommand() {
    }

    public ActuatorCommand(Station station, String actuator, String value, CommandOrigin origin,
                           String issuedBy, Instant issuedAt) {
        this.station = station;
        this.actuator = actuator;
        this.value = value;
        this.origin = origin;
        this.issuedBy = issuedBy;
        this.issuedAt = issuedAt;
    }

    public Station getStation() { return station; }
    public String getActuator() { return actuator; }
    public String getValue() { return value; }
    public CommandOrigin getOrigin() { return origin; }
    public String getIssuedBy() { return issuedBy; }
    public Instant getIssuedAt() { return issuedAt; }
    public CommandStatus getStatus() { return status; }
    public void setStatus(CommandStatus status) { this.status = status; }
    public Instant getAckedAt() { return ackedAt; }
    public void setAckedAt(Instant ackedAt) { this.ackedAt = ackedAt; }
    public String getDetail() { return detail; }
    public void setDetail(String detail) { this.detail = detail; }
}

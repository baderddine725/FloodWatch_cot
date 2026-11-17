/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : SensorDiagnostic.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-16          Modifié le : 2026-11-16
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.entities;

import jakarta.persistence.*;
import tn.supcom.cot.core.entities.UUIDPKEntity;

import java.time.Instant;

/**
 * Diagnostic d'une lecture du capteur de niveau, QU'ELLE AIT ÉTÉ RETENUE OU NON.
 * <p>La table {@code measurements} ne contient que les lectures valides : un écho parasite
 * écarté par la passerelle ou une lecture en défaut n'y laisse aucune trace. Cette table
 * garde les trois cas avec leur verdict, ce qui en fait à la fois l'historique de santé du
 * capteur et un jeu d'exemples faiblement étiquetés pour le classifieur embarqué.</p>
 */
@Entity
@Table(name = "sensor_diagnostics", indexes = @Index(name = "ix_diagnostics_station_ts", columnList = "station_id, ts"))
public class SensorDiagnostic extends UUIDPKEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "station_id", nullable = false)
    private Station station;
    @Column(nullable = false)
    private Instant ts;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8)
    private SensorVerdict verdict;
    /** Niveau brut annoncé par la station, avant tout filtrage (absent si illisible). */
    @Column(name = "raw_level_cm")
    private Double rawLevelCm;
    /** Nombre d'échos valides sur la salve (0..5 pour le HC-SR04 du firmware). */
    @Column(name = "echo_ok")
    private Integer echoOk;
    /** Écart max − min entre les échos valides de la salve, en cm. */
    @Column(name = "echo_spread_cm")
    private Double echoSpreadCm;

    protected SensorDiagnostic() {
    }

    public SensorDiagnostic(Station station, Instant ts, SensorVerdict verdict, Double rawLevelCm,
                            Integer echoOk, Double echoSpreadCm) {
        this.station = station;
        this.ts = ts;
        this.verdict = verdict;
        this.rawLevelCm = rawLevelCm;
        this.echoOk = echoOk;
        this.echoSpreadCm = echoSpreadCm;
    }

    public Station getStation() { return station; }
    public Instant getTs() { return ts; }
    public SensorVerdict getVerdict() { return verdict; }
    public Double getRawLevelCm() { return rawLevelCm; }
    public Integer getEchoOk() { return echoOk; }
    public Double getEchoSpreadCm() { return echoSpreadCm; }
}

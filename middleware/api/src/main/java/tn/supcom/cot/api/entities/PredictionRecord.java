/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : PredictionRecord.java
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
 * Prédiction historisée : ce qu'un modèle annonçait pour une échéance donnée, puis ce qui
 * a réellement été mesuré. C'est la base de toute comparaison entre modèles : sans elle,
 * « meilleur » ne se démontre pas.
 */
@Entity
@Table(name = "prediction_records", indexes = {
        @Index(name = "ix_predictions_status_target", columnList = "status, target_at"),
        @Index(name = "ix_predictions_station_generated", columnList = "station_id, generated_at")})
public class PredictionRecord extends UUIDPKEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "station_id", nullable = false)
    private Station station;
    /** Instant où la prédiction a été émise. */
    @Column(name = "generated_at", nullable = false)
    private Instant generatedAt;
    /** Horizon de prévision, en secondes. */
    @Column(name = "horizon_sec", nullable = false)
    private int horizonSec;
    /** Échéance : {@code generatedAt + horizonSec}. */
    @Column(name = "target_at", nullable = false)
    private Instant targetAt;
    /** Identifiant du modèle (voir {@code OverflowPredictor.modelId()}). */
    @Column(nullable = false, length = 48)
    private String model;
    /** Niveau retenu au moment de la prédiction : sert de référence « rien ne change ». */
    @Column(name = "base_level_cm", nullable = false)
    private double baseLevelCm;
    @Column(name = "predicted_level_cm", nullable = false)
    private double predictedLevelCm;
    @Column(name = "actual_level_cm")
    private Double actualLevelCm;
    /** Erreur signée : prévu − réel (positive = le modèle surestime la montée). */
    @Column(name = "error_cm")
    private Double errorCm;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8)
    private PredictionStatus status = PredictionStatus.PENDING;

    protected PredictionRecord() {
    }

    public PredictionRecord(Station station, Instant generatedAt, int horizonSec, String model,
                            double baseLevelCm, double predictedLevelCm) {
        this.station = station;
        this.generatedAt = generatedAt;
        this.horizonSec = horizonSec;
        this.targetAt = generatedAt.plusSeconds(horizonSec);
        this.model = model;
        this.baseLevelCm = baseLevelCm;
        this.predictedLevelCm = predictedLevelCm;
    }

    /** Confronte la prédiction au niveau réellement mesuré à l'échéance. */
    public void score(double actualLevelCm) {
        this.actualLevelCm = actualLevelCm;
        this.errorCm = predictedLevelCm - actualLevelCm;
        this.status = PredictionStatus.SCORED;
    }

    /** Aucune mesure à l'échéance : la prédiction ne sera jamais évaluée. */
    public void miss() {
        this.status = PredictionStatus.MISSED;
    }

    public Station getStation() { return station; }
    public Instant getGeneratedAt() { return generatedAt; }
    public int getHorizonSec() { return horizonSec; }
    public Instant getTargetAt() { return targetAt; }
    public String getModel() { return model; }
    public double getBaseLevelCm() { return baseLevelCm; }
    public double getPredictedLevelCm() { return predictedLevelCm; }
    public Double getActualLevelCm() { return actualLevelCm; }
    public Double getErrorCm() { return errorCm; }
    public PredictionStatus getStatus() { return status; }
}

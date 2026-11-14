/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : StationDto.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.dto;

import tn.supcom.cot.api.entities.Station;

import java.time.Instant;
import java.util.UUID;

/** Représentation publique d'une station et de son état temps réel. */
public record StationDto(UUID id, String code, String name, String description, String type,
                         double latitude, double longitude, String address, ThresholdsDto thresholds,
                         String alertLevel, String alertReasons, Double levelCm, Double levelPct, Double rain,
                         Double slopeCmPerMin, Double minutesToOverflow, Integer riskIndex,
                         boolean online, boolean sensorFault, Instant lastSeenAt, Instant lastMeasurementAt,
                         String barrier, String light, boolean siren, String sampling, String controlMode,
                         boolean localSafety, String firmware, Integer rssi, boolean roadOpen, String etag) {

    public static StationDto of(Station s) {
        boolean roadOpen = s.getBarrier() != tn.supcom.cot.api.entities.BarrierState.CLOSED
                && s.getAlertLevel() != tn.supcom.cot.api.controllers.alerting.AlertLevel.RED;
        return new StationDto(s.getId(), s.getCode(), s.getName(), s.getDescription(), s.getType().name(),
                s.getLatitude(), s.getLongitude(), s.getAddress(), ThresholdsDto.of(s.getThresholds()),
                s.getAlertLevel().name(), s.getAlertReasons(), s.getLevelCm(), s.getLevelPct(), s.getRain(),
                s.getSlopeCmPerMin(), s.getMinutesToOverflow(), s.getRiskIndex(),
                s.isOnline(), s.isSensorFault(), s.getLastSeenAt(), s.getLastMeasurementAt(),
                s.getBarrier().name(), s.getLight().name(), s.isSiren(), s.getSampling().name(),
                s.getControlMode().name(), s.isLocalSafety(), s.getFirmware(), s.getRssi(), roadOpen, s.tag());
    }
}

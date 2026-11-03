/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : AlertDto.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.dto;

import tn.supcom.cot.api.entities.Alert;

import java.time.Instant;
import java.util.UUID;

/** Alerte exposée aux opérateurs. */
public record AlertDto(UUID id, UUID stationId, String stationCode, String stationName, String type, String level,
                       String message, Instant raisedAt, boolean active, Instant resolvedAt,
                       Instant acknowledgedAt, String acknowledgedBy, Instant barrierClosedAt,
                       Instant barrierReopenedAt) {
    public static AlertDto of(Alert a) {
        var s = a.getStation();
        return new AlertDto(a.getId(), s.getId(), s.getCode(), s.getName(), a.getType().name(), a.getLevel().name(),
                a.getMessage(), a.getRaisedAt(), a.isActive(), a.getResolvedAt(), a.getAcknowledgedAt(),
                a.getAcknowledgedBy(), a.getBarrierClosedAt(), a.getBarrierReopenedAt());
    }
}

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : CommandDto.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.dto;

import tn.supcom.cot.api.entities.ActuatorCommand;

import java.time.Instant;
import java.util.UUID;

/** Commande d'actionneur et son statut. */
public record CommandDto(UUID id, String stationCode, String actuator, String value, String origin, String issuedBy,
                         Instant issuedAt, String status, Instant ackedAt, String detail) {
    public static CommandDto of(ActuatorCommand c) {
        return new CommandDto(c.getId(), c.getStation().getCode(), c.getActuator(), c.getValue(), c.getOrigin().name(),
                c.getIssuedBy(), c.getIssuedAt(), c.getStatus().name(), c.getAckedAt(), c.getDetail());
    }
}

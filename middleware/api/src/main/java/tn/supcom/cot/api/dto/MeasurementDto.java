/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : MeasurementDto.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.dto;

import tn.supcom.cot.api.entities.Measurement;

import java.time.Instant;

/** Mesure historisée. */
public record MeasurementDto(Instant ts, double levelCm, double levelPct, double rain, String alertLevel) {
    public static MeasurementDto of(Measurement m) {
        return new MeasurementDto(m.getTs(), m.getLevelCm(), m.getLevelPct(), m.getRain(),
                m.getAlertLevel() == null ? null : m.getAlertLevel().name());
    }
}

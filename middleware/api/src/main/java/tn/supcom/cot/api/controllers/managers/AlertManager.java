/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : AlertManager.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.managers;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Event;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import tn.supcom.cot.api.controllers.alerting.AlertLevel;
import tn.supcom.cot.api.controllers.repositories.AlertRepository;
import tn.supcom.cot.api.dto.AlertDto;
import tn.supcom.cot.api.dto.AlertNotice;
import tn.supcom.cot.api.dto.LiveMessage;
import tn.supcom.cot.api.dto.StationDto;
import tn.supcom.cot.api.entities.Alert;
import tn.supcom.cot.api.entities.AlertType;
import tn.supcom.cot.api.entities.BarrierState;
import tn.supcom.cot.api.entities.Station;

import java.time.Instant;
import java.util.UUID;

/**
 * Cycle de vie des alertes : levée, escalade, résolution, acquittement, et horodatage de la
 * fermeture/réouverture de la barrière (KPI). Publie des événements CDI (Observer) consommés par
 * la diffusion WebSocket et les notifications Web Push.
 */
@ApplicationScoped
@Transactional
public class AlertManager {
    @Inject
    private AlertRepository alerts;
    @Inject
    private Event<LiveMessage> live;
    @Inject
    private Event<AlertNotice> notices;

    /** Gère l'alerte de niveau lors d'un changement (orange/rouge = alerte active). */
    public void onLevelChange(Station station, AlertLevel previous, AlertLevel current, String reasons, Instant now) {
        var active = alerts.findActive(station, AlertType.LEVEL);
        if (current.isAtLeast(AlertLevel.ORANGE)) {
            if (active.isPresent() && active.get().getLevel() == current) return;
            active.ifPresent(a -> close(a, now));
            String msg = "Niveau " + current.label().toUpperCase() + " – " + station.getName()
                    + (reasons == null || reasons.isBlank() ? "" : " : " + reasons);
            raise(station, AlertType.LEVEL, current, msg, now);
        } else {
            active.ifPresent(a -> close(a, now));
        }
    }

    /** Lève une alerte si aucune alerte active du même type n'existe. */
    public Alert raise(Station station, AlertType type, AlertLevel level, String message, Instant now) {
        var existing = alerts.findActive(station, type);
        if (existing.isPresent() && type != AlertType.LEVEL) return existing.get();
        var alert = alerts.persist(new Alert(station, type, level, message, now));
        if (type == AlertType.LEVEL && level == AlertLevel.RED && station.getBarrier() == BarrierState.CLOSED) {
            alert.setBarrierClosedAt(now); // barrière déjà fermée (sécurité locale plus rapide que le Cloud)
        }
        var dto = AlertDto.of(alert);
        live.fire(new LiveMessage("alert", dto, true));
        notices.fire(new AlertNotice(dto, StationDto.of(station), false));
        return alert;
    }

    /** Résout l'alerte active d'un type donné, s'il y en a une. */
    public void resolve(Station station, AlertType type, Instant now) {
        alerts.findActive(station, type).ifPresent(a -> close(a, now));
    }

    private void close(Alert alert, Instant now) {
        alert.resolve(now);
        var dto = AlertDto.of(alert);
        live.fire(new LiveMessage("alert", dto, true));
        notices.fire(new AlertNotice(dto, StationDto.of(alert.getStation()), true));
    }

    /** Acquittement par un opérateur. */
    public AlertDto acknowledge(UUID id, String username) {
        var alert = alerts.find(id);
        alert.acknowledge(username, Instant.now());
        var dto = AlertDto.of(alert);
        live.fire(new LiveMessage("alert", dto, true));
        return dto;
    }

    /** Horodate la fermeture / réouverture de la barrière sur l'alerte correspondante. */
    public void onBarrierChange(Station station, BarrierState state, Instant now) {
        if (state == BarrierState.CLOSED) {
            var target = alerts.findActive(station, AlertType.LEVEL)
                    .or(() -> alerts.findActive(station, AlertType.LOCAL_SAFETY));
            target.filter(a -> a.getBarrierClosedAt() == null).ifPresent(a -> a.setBarrierClosedAt(now));
        } else if (state == BarrierState.OPEN) {
            alerts.findOpenClosure(station).ifPresent(a -> a.setBarrierReopenedAt(now));
        }
    }
}

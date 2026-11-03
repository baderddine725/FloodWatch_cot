/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : StationWatchdog.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.managers;

import jakarta.ejb.Schedule;
import jakarta.ejb.Singleton;
import jakarta.ejb.TransactionAttribute;
import jakarta.ejb.TransactionAttributeType;
import jakarta.enterprise.event.Event;
import jakarta.inject.Inject;
import tn.supcom.cot.api.dto.LiveMessage;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Tâches périodiques (toutes les 5 s) : détection des stations muettes (≤ 45 s),
 * expiration des commandes non acquittées, et « ping » WebSocket toutes les 30 s.
 */
@Singleton
@TransactionAttribute(TransactionAttributeType.NOT_SUPPORTED)
public class StationWatchdog {
    private static final Logger LOG = Logger.getLogger(StationWatchdog.class.getName());
    private final Duration offlineAfter = Duration.ofSeconds(AppConfig.getLong("station.offline.after.seconds", 45));
    private final Duration commandTimeout = Duration.ofSeconds(AppConfig.getLong("command.ack.timeout.seconds", 15));
    private int ticks;

    @Inject
    private ThingManager thingManager;
    @Inject
    private CommandManager commandManager;
    @Inject
    private Event<LiveMessage> live;

    @Schedule(hour = "*", minute = "*", second = "*/5", persistent = false)
    public void tick() {
        var now = Instant.now();
        try {
            thingManager.checkSilentStations(now, offlineAfter);
            commandManager.expirePending(now, commandTimeout);
        } catch (RuntimeException e) {
            LOG.log(Level.WARNING, "Watchdog run failed", e);
        }
        if (++ticks % 6 == 0) live.fire(new LiveMessage("ping", Map.of("ts", now.toString()), false));
    }
}

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : PushManager.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.push;

import jakarta.annotation.Resource;
import jakarta.enterprise.concurrent.ManagedExecutorService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.enterprise.event.TransactionPhase;
import jakarta.inject.Inject;
import jakarta.json.Json;
import tn.supcom.cot.api.controllers.alerting.AlertLevel;
import tn.supcom.cot.api.controllers.managers.AppConfig;
import tn.supcom.cot.api.dto.AlertNotice;
import tn.supcom.cot.api.entities.PushAudience;
import tn.supcom.cot.api.entities.PushSubscription;

import java.util.List;
import java.util.function.Predicate;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Notifications Web Push (Observer des alertes, après validation de la transaction) :
 * <ul>
 *   <li>opérateurs : toutes les alertes (niveau, station muette, capteur, sécurité locale) ;</li>
 *   <li>citoyens : alertes orange/rouge et réouverture des stations situées dans leur rayon.</li>
 * </ul>
 */
@ApplicationScoped
public class PushManager {
    private static final Logger LOG = Logger.getLogger(PushManager.class.getName());

    @Inject
    private PushStore store;
    @Resource
    private ManagedExecutorService executor;

    private volatile WebPushSender sender;

    /** @return l'émetteur (initialisé à la première utilisation avec les clés VAPID) */
    public WebPushSender sender() {
        if (sender == null) {
            synchronized (this) {
                if (sender == null) {
                    sender = new WebPushSender(store.vapidKeys(),
                            AppConfig.get("vapid.subject", "mailto:floodwatch@supcom.tn"));
                }
            }
        }
        return sender;
    }

    /** Réagit aux alertes levées ou résolues. */
    public void onAlert(@Observes(during = TransactionPhase.AFTER_SUCCESS) AlertNotice notice) {
        var a = notice.alert();
        var s = notice.station();
        boolean levelAlert = "LEVEL".equals(a.type()) || "LOCAL_SAFETY".equals(a.type());
        boolean severe = AlertLevel.valueOf(a.level()).isAtLeast(AlertLevel.ORANGE);
        String title;
        String body;
        if (notice.resolved()) {
            if (!(levelAlert && AlertLevel.valueOf(a.level()) == AlertLevel.RED)) return; // seule la fin du rouge intéresse le public
            title = "FloodWatch – " + s.name() + " : fin d'alerte";
            body = "Le niveau est redescendu. Passage à nouveau praticable avec prudence.";
        } else {
            title = "FloodWatch – Alerte " + AlertLevel.valueOf(a.level()).label().toUpperCase() + " : " + s.name();
            body = "RED".equals(a.level()) && levelAlert
                    ? "Passage FERMÉ. Ne vous engagez pas, empruntez un autre itinéraire."
                    : a.message();
        }
        String payload = Json.createObjectBuilder()
                .add("title", title).add("body", body).add("tag", "fw-" + s.code())
                .add("level", a.level()).add("station", s.code()).add("url", "/")
                .build().toString();
        Predicate<PushSubscription> citizenFilter = sub -> levelAlert && severe
                && sub.getLatitude() != null && sub.getLongitude() != null
                && haversineKm(sub.getLatitude(), sub.getLongitude(), s.latitude(), s.longitude()) <= sub.getRadiusKm();
        executor.execute(() -> deliver(payload, citizenFilter, "RED".equals(a.level()) ? "high" : "normal"));
    }

    /** Envoie une notification de test à tous les abonnés. */
    public int broadcastTest(String title, String body) {
        String payload = Json.createObjectBuilder().add("title", title).add("body", body)
                .add("tag", "fw-test").add("url", "/").build().toString();
        return deliver(payload, sub -> true, "normal");
    }

    private int deliver(String payload, Predicate<PushSubscription> citizenFilter, String urgency) {
        List<PushSubscription> targets;
        WebPushSender ws;
        try {
            targets = store.all().stream()
                    .filter(sub -> sub.getAudience() == PushAudience.OPERATOR || citizenFilter.test(sub))
                    .toList();
            ws = sender();
        } catch (RuntimeException e) {
            LOG.log(Level.WARNING, "Push preparation failed", e);
            return 0;
        }
        int sent = 0;
        for (var sub : targets) {
            try {
                int status = ws.send(new WebPushSender.Target(sub.getEndpoint(), sub.getP256dh(), sub.getAuth()),
                        payload, 600, urgency);
                if (status == 404 || status == 410) {
                    store.removeById(sub.getId());
                } else if (status >= 200 && status < 300) {
                    store.markSuccess(sub.getId());
                    sent++;
                } else {
                    LOG.warning(() -> "Push service answered " + status + " for " + sub.getEndpoint());
                }
            } catch (Exception e) {
                LOG.log(Level.WARNING, "Push delivery failed to " + sub.getEndpoint(), e);
            }
        }
        return sent;
    }

    /** Distance orthodromique (km). */
    public static double haversineKm(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 6371.0 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}

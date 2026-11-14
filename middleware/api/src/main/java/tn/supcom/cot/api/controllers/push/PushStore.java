/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : PushStore.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.push;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import tn.supcom.cot.api.controllers.managers.AppConfig;
import tn.supcom.cot.api.controllers.repositories.PushSubscriptionRepository;
import tn.supcom.cot.api.controllers.repositories.SettingRepository;
import tn.supcom.cot.api.entities.AppSetting;
import tn.supcom.cot.api.entities.PushAudience;
import tn.supcom.cot.api.entities.PushSubscription;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Opérations transactionnelles sur les abonnements Web Push et les clés VAPID. */
@ApplicationScoped
@Transactional
public class PushStore {
    @Inject
    private PushSubscriptionRepository subscriptions;
    @Inject
    private SettingRepository settings;

    /** Clés VAPID : variables d'environnement, sinon générées une fois et persistées. */
    public WebPushSender.VapidKeys vapidKeys() {
        String envPub = AppConfig.get("vapid.public.key", "");
        String envPriv = AppConfig.get("vapid.private.key", "");
        if (!envPub.isEmpty() && !envPriv.isEmpty()) return new WebPushSender.VapidKeys(envPub, envPriv);
        var pub = settings.findById("vapid.public");
        var priv = settings.findById("vapid.private");
        if (pub.isPresent() && priv.isPresent()) {
            return new WebPushSender.VapidKeys(pub.get().getValue(), priv.get().getValue());
        }
        var keys = WebPushSender.generateKeys();
        settings.persist(new AppSetting("vapid.public", keys.publicKey()));
        settings.persist(new AppSetting("vapid.private", keys.privateKey()));
        return keys;
    }

    /** Crée ou met à jour un abonnement. */
    public PushSubscription upsert(String endpoint, String p256dh, String auth, PushAudience audience,
                                   Double lat, Double lon, Double radiusKm, String username) {
        var sub = subscriptions.findByEndpoint(endpoint).orElseGet(() -> {
            var s = new PushSubscription();
            s.setEndpoint(endpoint);
            return subscriptions.persist(s);
        });
        sub.setP256dh(p256dh);
        sub.setAuth(auth);
        sub.setAudience(audience);
        sub.setLatitude(lat);
        sub.setLongitude(lon);
        if (radiusKm != null && radiusKm > 0) sub.setRadiusKm(Math.min(radiusKm, 100));
        sub.setUsername(username);
        return sub;
    }

    /** Supprime un abonnement par point de terminaison. */
    public boolean remove(String endpoint) {
        var sub = subscriptions.findByEndpoint(endpoint);
        sub.ifPresent(subscriptions::delete);
        return sub.isPresent();
    }

    /** Supprime un abonnement expiré (404/410). */
    public void removeById(UUID id) {
        subscriptions.findById(id).ifPresent(subscriptions::delete);
    }

    /** Horodate le dernier envoi réussi. */
    public void markSuccess(UUID id) {
        subscriptions.findById(id).ifPresent(s -> s.setLastSuccessAt(Instant.now()));
    }

    /** @return tous les abonnements */
    public List<PushSubscription> all() {
        return subscriptions.findAll();
    }
}

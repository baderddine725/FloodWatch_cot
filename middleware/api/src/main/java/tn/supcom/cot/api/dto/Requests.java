/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : Requests.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.dto;

import java.util.List;

/** Corps des requêtes REST simples. */
public final class Requests {
    private Requests() {
    }

    public record Login(String username, String password) {
    }

    public record Command(String actuator, String value) {
    }

    public record Mode(String mode) {
    }

    public record User(String username, String password, String fullName, List<String> roles, Boolean enabled) {
    }

    public record PushKeys(String p256dh, String auth) {
    }

    public record PushSubscriptionJson(String endpoint, PushKeys keys) {
    }

    public record PushSubscribe(PushSubscriptionJson subscription, Double latitude, Double longitude, Double radiusKm) {
    }

    public record PushTest(String title, String body) {
    }
}

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : PushSubscription.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.entities;

import jakarta.persistence.*;
import tn.supcom.cot.core.entities.UUIDPKEntity;

import java.time.Instant;

/** Abonnement Web Push d'un navigateur (PWA), géolocalisé pour les citoyens. */
@Entity
@Table(name = "push_subscriptions")
public class PushSubscription extends UUIDPKEntity {
    @Column(nullable = false, unique = true, length = 1024)
    private String endpoint;
    @Column(nullable = false, length = 255)
    private String p256dh;
    @Column(nullable = false, length = 64)
    private String auth;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8)
    private PushAudience audience = PushAudience.CITIZEN;
    private Double latitude;
    private Double longitude;
    @Column(name = "radius_km", nullable = false)
    private double radiusKm = 5;
    @Column(length = 191)
    private String username;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();
    @Column(name = "last_success_at")
    private Instant lastSuccessAt;

    public String getEndpoint() { return endpoint; }
    public void setEndpoint(String endpoint) { this.endpoint = endpoint; }
    public String getP256dh() { return p256dh; }
    public void setP256dh(String p256dh) { this.p256dh = p256dh; }
    public String getAuth() { return auth; }
    public void setAuth(String auth) { this.auth = auth; }
    public PushAudience getAudience() { return audience; }
    public void setAudience(PushAudience audience) { this.audience = audience; }
    public Double getLatitude() { return latitude; }
    public void setLatitude(Double latitude) { this.latitude = latitude; }
    public Double getLongitude() { return longitude; }
    public void setLongitude(Double longitude) { this.longitude = longitude; }
    public double getRadiusKm() { return radiusKm; }
    public void setRadiusKm(double radiusKm) { this.radiusKm = radiusKm; }
    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getLastSuccessAt() { return lastSuccessAt; }
    public void setLastSuccessAt(Instant v) { this.lastSuccessAt = v; }
}

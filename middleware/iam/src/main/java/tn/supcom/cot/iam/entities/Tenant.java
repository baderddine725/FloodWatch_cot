/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : iam
 *  Fichier   : Tenant.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.iam.entities;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import tn.supcom.cot.core.entities.UUIDPKEntity;

import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Client d'API (tenant) : application tierce qui consomme les services de FloodWatch (municipalité,
 * protection civile, application de mobilité...) avec le flux OAuth 2.0 « client credentials ».
 * <p>Correction : import manquant de {@link UUIDPKEntity}. Depuis la version 2.0, l'entité est
 * persistée et utilisée : secret haché (PBKDF2, jamais stocké en clair), portées accordées et zones
 * géographiques auxquelles le client a accès.</p>
 */
@Entity
@Table(name = "tenants")
public class Tenant extends UUIDPKEntity {

    /** Identifiant public du client (« client_id »). */
    @Column(name = "tenant_id", nullable = false, unique = true, length = 191)
    private String name;
    /** Empreinte PBKDF2 du secret (« client_secret »). */
    @Column(name = "tenant_secret", nullable = false)
    private String secret;
    @Column(name = "redirect_uri")
    private String redirectUri;
    /** Rôles utilisateur que ce client pourrait obtenir (masque) : 0 pour un client de service. */
    @Column(name = "allowed_roles", nullable = false)
    private Long allowedRoles = 0L;
    /** Portées accordées, séparées par des espaces (ex. « forecast:read »). */
    @Column(name = "required_scopes", nullable = false)
    private String requiredScopes = "";
    @Column(name = "supported_grant_types", nullable = false)
    private String supportedGrantTypes = "client_credentials";
    /** Zones autorisées, séparées par des espaces ; « * » = toutes. */
    @Column(nullable = false)
    private String zones = "";
    @Column(name = "display_name")
    private String displayName;
    @Column(nullable = false)
    private boolean enabled = true;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public static Set<String> words(String value) {
        if (value == null || value.isBlank()) return Set.of();
        return new LinkedHashSet<>(Arrays.asList(value.trim().split("\\s+")));
    }

    public Set<String> scopeSet() { return words(requiredScopes); }
    public Set<String> zoneSet() { return words(zones); }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getSecret() { return secret; }
    public void setSecret(String secret) { this.secret = secret; }
    public String getRedirectUri() { return redirectUri; }
    public void setRedirectUri(String redirectUri) { this.redirectUri = redirectUri; }
    public Long getAllowedRoles() { return allowedRoles; }
    public void setAllowedRoles(Long allowedRoles) { this.allowedRoles = allowedRoles; }
    public String getRequiredScopes() { return requiredScopes; }
    public void setRequiredScopes(String requiredScopes) { this.requiredScopes = requiredScopes; }
    public String getSupportedGrantTypes() { return supportedGrantTypes; }
    public void setSupportedGrantTypes(String supportedGrantTypes) { this.supportedGrantTypes = supportedGrantTypes; }
    public String getZones() { return zones; }
    public void setZones(String zones) { this.zones = zones; }
    public String getDisplayName() { return displayName; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public Instant getCreatedAt() { return createdAt; }
}

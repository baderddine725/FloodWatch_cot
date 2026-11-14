/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : iam
 *  Fichier   : Identity.java
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
import tn.supcom.cot.iam.security.Role;

import java.security.Principal;
import java.time.Instant;
import java.util.Set;

/**
 * Identité d'un utilisateur de la plateforme (opérateur, administrateur, citoyen enregistré).
 * <p>Corrections : import manquant de {@link UUIDPKEntity} ; le mot de passe est stocké
 * haché (PBKDF2) ; les rôles sont un masque de bits défini par {@link Role}.</p>
 */
@Entity
@Table(name = "identities")
public class Identity extends UUIDPKEntity implements Principal {
    @Column(length = 191, unique = true, nullable = false)
    private String username;
    @Column(nullable = false)
    private String password;
    @Column(nullable = false)
    private Long roles;
    @Column(name = "provided_scopes", nullable = false)
    private String providedScopes = "";
    @Column(name = "full_name")
    private String fullName;
    @Column(nullable = false)
    private boolean enabled = true;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    @Override
    public String getName() {
        return username;
    }

    /** @return le mot de passe haché (format pbkdf2$iterations$sel$hash) */
    public String getPassword() {
        return password;
    }

    /** @param password mot de passe déjà haché par {@code PasswordHasher} */
    public void setPassword(String password) {
        this.password = password;
    }

    public Long getRoles() {
        return roles;
    }

    public void setRoles(Long roles) {
        this.roles = roles;
    }

    /** @return l'ensemble des rôles décodés du masque */
    public Set<Role> roleSet() {
        return Role.fromMask(roles == null ? 0L : roles);
    }

    public String getProvidedScopes() {
        return providedScopes;
    }

    public void setProvidedScopes(String providedScopes) {
        this.providedScopes = providedScopes;
    }

    public String getFullName() {
        return fullName;
    }

    public void setFullName(String fullName) {
        this.fullName = fullName;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}

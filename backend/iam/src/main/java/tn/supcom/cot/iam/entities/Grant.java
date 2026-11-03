/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : iam
 *  Fichier   : Grant.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.iam.entities;

import jakarta.persistence.*;
import tn.supcom.cot.core.entities.RootEntity;
import java.time.LocalDateTime;

/**
 * Autorisation accordée par une identité à un locataire (tenant) OAuth.
 * Correction : import manquant de {@link RootEntity} (le module ne compilait pas).
 * Réservé à l'évolution OAuth 2.1 ; non inclus dans l'unité de persistance du prototype.
 */
@Entity
@Table(name = "issued_grants")
public class Grant implements RootEntity<GrantPK> {
    @EmbeddedId
    private GrantPK id;
    @Version
    private long version;
    @MapsId("tenantId")
    @ManyToOne
    private Tenant tenant;
    @MapsId("identityId")
    @ManyToOne
    private Identity identity;

    @Column(name = "approved_scopes")
    private String approvedScopes;

    @Column(name = "issuance_date_time")
    private LocalDateTime issuanceDateTime;

    @Override
    public GrantPK getId() {
        return id;
    }

    @Override
    public void setId(GrantPK id) {
        this.id = id;
    }

    @Override
    public long getVersion() {
        return version;
    }

    @Override
    public void setVersion(long version) {
        this.version = version;
    }

    public Tenant getTenant() {
        return tenant;
    }

    public void setTenant(Tenant tenant) {
        this.tenant = tenant;
    }

    public Identity getIdentity() {
        return identity;
    }

    public void setIdentity(Identity identity) {
        this.identity = identity;
    }

    public String getApprovedScopes() {
        return approvedScopes;
    }

    public void setApprovedScopes(String approvedScopes) {
        this.approvedScopes = approvedScopes;
    }

    public LocalDateTime getIssuanceDateTime() {
        return issuanceDateTime;
    }

    public void setIssuanceDateTime(LocalDateTime issuanceDateTime) {
        this.issuanceDateTime = issuanceDateTime;
    }
}

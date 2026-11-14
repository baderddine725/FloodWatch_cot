/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : core
 *  Fichier   : UUIDPKEntity.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.core.entities;

import jakarta.persistence.*;
import tn.supcom.cot.core.utilities.UUIDv7;

import java.util.Objects;
import java.util.UUID;

/**
 * Super-classe des entités relationnelles identifiées par un UUIDv7 (triable dans le temps).
 * <p>Correction : le type de colonne « binary(16) » (spécifique MySQL) est supprimé ;
 * Hibernate associe nativement {@link UUID} au type {@code uuid} de PostgreSQL.</p>
 */
@MappedSuperclass
@Access(AccessType.FIELD)
public abstract class UUIDPKEntity implements RootEntity<UUID> {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id = UUIDv7.generate();

    @Version
    private long version;

    @Override
    public UUID getId() {
        return id;
    }

    /** L'identifiant est généré à la construction et ne peut pas être modifié. */
    @Override
    public void setId(UUID uuid) {
        throw new UnsupportedOperationException("UUIDv7 is immutable.");
    }

    @Override
    public long getVersion() {
        return version;
    }

    @Override
    public void setVersion(long version) {
        this.version = version;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof UUIDPKEntity that)) return false;
        return Objects.equals(id, that.id);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);
    }
}

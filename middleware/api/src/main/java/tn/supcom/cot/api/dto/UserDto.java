/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : UserDto.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.dto;

import tn.supcom.cot.iam.entities.Identity;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Compte utilisateur (sans le mot de passe). */
public record UserDto(UUID id, String username, String fullName, List<String> roles, boolean enabled, Instant createdAt) {
    public static UserDto of(Identity i) {
        return new UserDto(i.getId(), i.getUsername(), i.getFullName(),
                i.roleSet().stream().map(Enum::name).toList(), i.isEnabled(), i.getCreatedAt());
    }
}

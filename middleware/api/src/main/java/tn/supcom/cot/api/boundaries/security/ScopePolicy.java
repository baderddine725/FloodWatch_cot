/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : ScopePolicy.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-17          Modifié le : 2026-11-17
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.boundaries.security;

import tn.supcom.cot.iam.security.TokenService;

import java.util.Set;

/** Règle d'accès des clients d'API (classe pure, testée sans serveur). */
public final class ScopePolicy {
    /** Rôles qui donnent accès aux services exposés aux clients (sans portée). */
    public static final Set<String> STAFF = Set.of("OPERATOR", "ADMIN");

    public enum Decision { ALLOW, UNAUTHORIZED, FORBIDDEN }

    private ScopePolicy() {
    }

    /**
     * @param claims   jeton vérifié, ou {@code null}
     * @param required portée exigée par la ressource, ou {@code null} si la ressource n'en déclare pas
     * @return ALLOW, ou la raison du refus. Ne tranche PAS le cas d'un utilisateur sur une ressource
     *         sans portée : les rôles s'appliquent alors normalement (ALLOW ici).
     */
    public static Decision decide(TokenService.Claims claims, String required) {
        if (required == null) {
            return claims != null && claims.isClient() ? Decision.FORBIDDEN : Decision.ALLOW;
        }
        if (claims == null) return Decision.UNAUTHORIZED;
        if (claims.isClient()) return claims.hasScope(required) ? Decision.ALLOW : Decision.FORBIDDEN;
        return claims.hasAnyRole(STAFF) ? Decision.ALLOW : Decision.FORBIDDEN;
    }
}

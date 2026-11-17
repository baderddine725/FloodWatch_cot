/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware (tests)
 *  Fichier   : ClientAccessTest.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-17          Modifié le : 2026-11-17
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.boundaries;

import org.junit.jupiter.api.Test;
import tn.supcom.cot.api.boundaries.security.ScopePolicy;
import tn.supcom.cot.iam.security.Role;
import tn.supcom.cot.iam.security.TokenService;

import java.util.EnumSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static tn.supcom.cot.api.boundaries.security.ScopePolicy.Decision.*;

/** Jetons de clients d'API : portées, zones, et moindre privilège face aux ressources. */
class ClientAccessTest {
    private final TokenService tokens = new TokenService("0123456789abcdef0123456789abcdef", 3600);

    @Test
    void clientTokenCarriesScopesAndZonesButNoRole() {
        var c = tokens.verify(tokens.issueClient("ariana-mobility", Set.of("forecast:read"), Set.of("ariana"))).orElseThrow();
        assertTrue(c.isClient());
        assertEquals("client:ariana-mobility", c.subject());
        assertEquals("ariana-mobility", c.username());
        assertTrue(c.roles().isEmpty());
        assertTrue(c.hasScope("forecast:read"));
        assertTrue(c.allowsZone("ariana"));
        assertFalse(c.allowsZone("tunis"), "zone hors périmètre");
        assertFalse(c.allowsZone(null));
        var all = tokens.verify(tokens.issueClient("protection-civile", Set.of("forecast:read"), Set.of("*"))).orElseThrow();
        assertTrue(all.allowsZone("tunis"), "« * » : toutes les zones");
    }

    @Test
    void userTokensAreUnchanged() {
        var u = tokens.verify(tokens.issue("id-1", "operator", EnumSet.of(Role.OPERATOR))).orElseThrow();
        assertFalse(u.isClient());
        assertTrue(u.scopes().isEmpty());
        assertTrue(u.allowsZone("anything"), "un utilisateur voit toutes les zones");
    }

    @Test
    void tamperedClientTokenIsRejected() {
        String jwt = tokens.issueClient("c1", Set.of("forecast:read"), Set.of("ariana"));
        String[] p = jwt.split("\\.");
        String forged = p[0] + "." + p[1].substring(0, p[1].length() - 2) + "AA." + p[2];
        assertTrue(tokens.verify(forged).isEmpty());
        assertTrue(new TokenService("another-secret-another-secret-xx", 3600).verify(jwt).isEmpty());
    }

    @Test
    void leastPrivilegePolicy() {
        var client = tokens.verify(tokens.issueClient("c1", Set.of("forecast:read"), Set.of("ariana"))).orElseThrow();
        var noScope = tokens.verify(tokens.issueClient("c2", Set.of(), Set.of("ariana"))).orElseThrow();
        var operator = tokens.verify(tokens.issue("u1", "op", EnumSet.of(Role.OPERATOR))).orElseThrow();
        var citizen = tokens.verify(tokens.issue("u2", "cit", EnumSet.of(Role.CITIZEN))).orElseThrow();
        // ressource à portée
        assertEquals(ALLOW, ScopePolicy.decide(client, "forecast:read"));
        assertEquals(FORBIDDEN, ScopePolicy.decide(noScope, "forecast:read"));
        assertEquals(ALLOW, ScopePolicy.decide(operator, "forecast:read"), "les opérateurs utilisent aussi le service");
        assertEquals(FORBIDDEN, ScopePolicy.decide(citizen, "forecast:read"));
        assertEquals(UNAUTHORIZED, ScopePolicy.decide(null, "forecast:read"));
        // ressource sans portée : un client n'y a JAMAIS accès, un utilisateur relève des rôles
        assertEquals(FORBIDDEN, ScopePolicy.decide(client, null));
        assertEquals(ALLOW, ScopePolicy.decide(operator, null));
        assertEquals(ALLOW, ScopePolicy.decide(null, null));
    }
}

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : iam
 *  Fichier   : SecurityTest.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.iam;

import org.junit.jupiter.api.Test;
import tn.supcom.cot.iam.security.PasswordHasher;
import tn.supcom.cot.iam.security.Role;
import tn.supcom.cot.iam.security.TokenService;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.EnumSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/** Tests du hachage des mots de passe et des jetons JWT. */
class SecurityTest {

    @Test
    void passwordHashRoundTrip() {
        String h = PasswordHasher.hash("s3cret!");
        assertTrue(PasswordHasher.verify("s3cret!", h));
        assertFalse(PasswordHasher.verify("wrong", h));
        assertNotEquals(h, PasswordHasher.hash("s3cret!"), "salt must differ");
    }

    @Test
    void tokenRoundTrip() {
        var ts = new TokenService("0123456789abcdef0123456789abcdef", 3600);
        String jwt = ts.issue("id-1", "operator", EnumSet.of(Role.OPERATOR));
        var claims = ts.verify(jwt).orElseThrow();
        assertEquals("operator", claims.username());
        assertEquals(Set.of(Role.OPERATOR), claims.roles());
    }

    @Test
    void tamperedOrExpiredTokenIsRejected() {
        var ts = new TokenService("0123456789abcdef0123456789abcdef", 60);
        String jwt = ts.issue("id-1", "op", EnumSet.of(Role.OPERATOR));
        String forged = jwt.substring(0, jwt.lastIndexOf('.') + 1) + "AAAA";
        assertTrue(ts.verify(forged).isEmpty());
        var later = new TokenService("0123456789abcdef0123456789abcdef", 60,
                Clock.fixed(Instant.now().plusSeconds(120), ZoneOffset.UTC));
        assertTrue(later.verify(jwt).isEmpty());
        var other = new TokenService("another-secret-another-secret!!", 60);
        assertTrue(other.verify(jwt).isEmpty());
    }

    @Test
    void roleMask() {
        long mask = Role.toMask(EnumSet.of(Role.OPERATOR, Role.ADMIN));
        assertEquals(6L, mask);
        assertEquals(EnumSet.of(Role.OPERATOR, Role.ADMIN), Role.fromMask(mask));
    }
}

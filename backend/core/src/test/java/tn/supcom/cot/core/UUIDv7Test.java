/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : core
 *  Fichier   : UUIDv7Test.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.core;

import org.junit.jupiter.api.Test;
import tn.supcom.cot.core.utilities.ETagSupport;
import tn.supcom.cot.core.utilities.UUIDv7;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Tests unitaires du générateur UUIDv7 et du calcul d'ETag. */
class UUIDv7Test {

    @Test
    void versionAndVariantAreCorrect() {
        UUID u = UUIDv7.generate();
        assertEquals(7, u.version());
        assertEquals(2, u.variant());
    }

    @Test
    void fullTimestampIsEncoded() {
        long ts = 1_793_000_000_000L; // > 2^32 : le bug initial tronquait cette valeur
        assertEquals(ts, UUIDv7.timestampOf(UUIDv7.generate(ts)));
    }

    @Test
    void idsAreTimeOrdered() {
        UUID a = UUIDv7.generate(1_000_000_000_000L);
        UUID b = UUIDv7.generate(1_000_000_000_001L);
        assertTrue(Long.compareUnsigned(a.getMostSignificantBits(), b.getMostSignificantBits()) < 0);
    }

    @Test
    void etagChangesWithVersion() {
        UUID id = UUIDv7.generate();
        assertNotEquals(ETagSupport.computeETag(id, 1), ETagSupport.computeETag(id, 2));
        assertEquals(ETagSupport.computeETag(id, 1), ETagSupport.computeETag(id, 1));
    }
}

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : core
 *  Fichier   : UUIDv7.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.core.utilities;

import java.security.SecureRandom;
import java.time.Clock;
import java.util.UUID;

/**
 * Générateur d'UUID version 7 (RFC 9562) : 48 bits d'horodatage Unix en millisecondes,
 * 4 bits de version, 12 bits aléatoires, 2 bits de variante et 62 bits aléatoires.
 * <p>Correction : le code initial ne conservait que 32 bits de l'horodatage
 * ({@code & 0xFFFFFFFFL}), ce qui cassait l'ordre chronologique des identifiants.</p>
 */
public final class UUIDv7 {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Clock CLOCK = Clock.systemUTC();

    private UUIDv7() {
    }

    /** @return un nouvel UUIDv7 */
    public static UUID generate() {
        return generate(CLOCK.millis());
    }

    /**
     * @param timestampMillis horodatage Unix en millisecondes
     * @return un UUIDv7 dont les 48 bits de poids fort valent {@code timestampMillis}
     */
    public static UUID generate(long timestampMillis) {
        long msb = (timestampMillis & 0xFFFF_FFFF_FFFFL) << 16;
        msb |= 0x7000L;                              // version 7
        msb |= (RANDOM.nextLong() & 0x0FFFL);        // rand_a (12 bits)
        long lsb = RANDOM.nextLong();
        lsb &= 0x3FFF_FFFF_FFFF_FFFFL;               // rand_b (62 bits)
        lsb |= 0x8000_0000_0000_0000L;               // variante IETF (10xx)
        return new UUID(msb, lsb);
    }

    /** @return l'horodatage (ms) encodé dans un UUIDv7 */
    public static long timestampOf(UUID uuid) {
        return uuid.getMostSignificantBits() >>> 16;
    }
}

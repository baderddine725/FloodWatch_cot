/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : iam
 *  Fichier   : Role.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.iam.security;

import java.util.EnumSet;
import java.util.Set;

/**
 * Rôles de la plateforme FloodWatch, codés en masque de bits dans {@code Identity.roles}.
 */
public enum Role {
    /** Citoyen : consultation et notifications (PWA Citoyen). */
    CITIZEN(1L),
    /** Opérateur municipal / protection civile : supervision, acquittement, commandes. */
    OPERATOR(2L),
    /** Administrateur technique : stations, seuils, comptes. */
    ADMIN(4L);

    private final long bit;

    Role(long bit) {
        this.bit = bit;
    }

    public long bit() {
        return bit;
    }

    /** Décode un masque de bits en ensemble de rôles. */
    public static Set<Role> fromMask(long mask) {
        var set = EnumSet.noneOf(Role.class);
        for (Role r : values()) {
            if ((mask & r.bit) != 0) set.add(r);
        }
        return set;
    }

    /** Encode un ensemble de rôles en masque de bits. */
    public static long toMask(Iterable<Role> roles) {
        long m = 0;
        for (Role r : roles) m |= r.bit;
        return m;
    }
}

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : SecurityService.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.boundaries.security;

import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import tn.supcom.cot.api.controllers.managers.AppConfig;
import tn.supcom.cot.iam.security.TokenService;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.Optional;
import java.util.logging.Logger;

/** Fournit le {@link TokenService} configuré (secret JWT_SECRET, durée JWT_TTL_SECONDS). */
@ApplicationScoped
public class SecurityService {
    private static final Logger LOG = Logger.getLogger(SecurityService.class.getName());
    private TokenService tokens;

    @PostConstruct
    void init() {
        String secret = AppConfig.get("jwt.secret", "");
        if (secret.length() < 32) {
            byte[] random = new byte[32];
            new SecureRandom().nextBytes(random);
            secret = Base64.getEncoder().encodeToString(random);
            LOG.warning("JWT_SECRET missing or shorter than 32 characters: using a random secret "
                    + "(tokens will be invalidated at each restart)");
        }
        tokens = new TokenService(secret, AppConfig.getLong("jwt.ttl.seconds", 8 * 3600));
    }

    public TokenService tokens() {
        return tokens;
    }

    /** Vérifie un en-tête {@code Authorization: Bearer <jwt>}. */
    public Optional<TokenService.Claims> fromAuthorizationHeader(String header) {
        if (header == null || !header.regionMatches(true, 0, "Bearer ", 0, 7)) return Optional.empty();
        return tokens.verify(header.substring(7).trim());
    }
}

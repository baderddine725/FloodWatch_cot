/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : iam
 *  Fichier   : TokenService.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.iam.security;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Émission et vérification de jetons JWT signés HMAC-SHA256 (RFC 7519).
 * <p>Implémentation sans dépendance : les revendications sont un objet JSON plat
 * (sub, upn, groups, iss, iat, exp).</p>
 */
public final class TokenService {
    private static final String ISSUER = "floodwatch";
    private static final Pattern STRING_CLAIM = Pattern.compile("\"(\\w+)\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
    private static final Pattern NUMBER_CLAIM = Pattern.compile("\"(\\w+)\"\\s*:\\s*(-?\\d+)");
    private static final Pattern GROUPS_CLAIM = Pattern.compile("\"groups\"\\s*:\\s*\\[([^\\]]*)]");

    private final byte[] secret;
    private final long ttlSeconds;
    private final Clock clock;

    /**
     * @param secret     clé HMAC (au moins 32 caractères recommandés)
     * @param ttlSeconds durée de validité des jetons
     */
    public TokenService(String secret, long ttlSeconds) {
        this(secret, ttlSeconds, Clock.systemUTC());
    }

    public TokenService(String secret, long ttlSeconds, Clock clock) {
        if (secret == null || secret.length() < 16) {
            throw new IllegalArgumentException("JWT secret must be at least 16 characters");
        }
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
        this.ttlSeconds = ttlSeconds;
        this.clock = clock;
    }

    /** Revendications vérifiées d'un jeton. */
    public record Claims(String subject, String username, Set<Role> roles, long issuedAt, long expiresAt) {
        public boolean hasAnyRole(Collection<String> names) {
            return roles.stream().anyMatch(r -> names.contains(r.name()));
        }
    }

    /** Émet un jeton pour un utilisateur. */
    public String issue(String subject, String username, Set<Role> roles) {
        long now = clock.instant().getEpochSecond();
        var groups = new StringJoiner(",", "[", "]");
        roles.forEach(r -> groups.add("\"" + r.name() + "\""));
        String header = "{\"alg\":\"HS256\",\"typ\":\"JWT\"}";
        String payload = "{\"iss\":\"" + ISSUER + "\",\"sub\":\"" + escape(subject) + "\",\"upn\":\""
                + escape(username) + "\",\"groups\":" + groups + ",\"iat\":" + now + ",\"exp\":" + (now + ttlSeconds) + "}";
        String signingInput = b64(header.getBytes(StandardCharsets.UTF_8)) + "." + b64(payload.getBytes(StandardCharsets.UTF_8));
        return signingInput + "." + b64(hmac(signingInput));
    }

    /** @return la durée de validité configurée (s) */
    public long ttlSeconds() {
        return ttlSeconds;
    }

    /**
     * Vérifie la signature, l'émetteur et l'expiration.
     *
     * @return les revendications, ou vide si le jeton est invalide
     */
    public Optional<Claims> verify(String token) {
        if (token == null) return Optional.empty();
        String[] parts = token.split("\\.");
        if (parts.length != 3) return Optional.empty();
        try {
            byte[] expected = hmac(parts[0] + "." + parts[1]);
            byte[] actual = Base64.getUrlDecoder().decode(parts[2]);
            if (!MessageDigest.isEqual(expected, actual)) return Optional.empty();
            String header = new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8);
            if (!header.contains("\"HS256\"")) return Optional.empty();
            String json = new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8);
            Map<String, String> strings = new HashMap<>();
            Matcher m = STRING_CLAIM.matcher(json);
            while (m.find()) strings.put(m.group(1), m.group(2).replace("\\\"", "\"").replace("\\\\", "\\"));
            Map<String, Long> numbers = new HashMap<>();
            m = NUMBER_CLAIM.matcher(json);
            while (m.find()) numbers.put(m.group(1), Long.parseLong(m.group(2)));
            if (!ISSUER.equals(strings.get("iss"))) return Optional.empty();
            long exp = numbers.getOrDefault("exp", 0L);
            if (clock.instant().getEpochSecond() >= exp) return Optional.empty();
            Set<Role> roles = EnumSet.noneOf(Role.class);
            m = GROUPS_CLAIM.matcher(json);
            if (m.find()) {
                for (String g : m.group(1).split(",")) {
                    String name = g.trim().replace("\"", "");
                    if (!name.isEmpty()) roles.add(Role.valueOf(name));
                }
            }
            return Optional.of(new Claims(strings.get("sub"), strings.get("upn"), roles,
                    numbers.getOrDefault("iat", 0L), exp));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    private byte[] hmac(String input) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return mac.doFinal(input.getBytes(StandardCharsets.US_ASCII));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String b64(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String escape(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}

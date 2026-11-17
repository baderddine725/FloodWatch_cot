/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : AuthResource.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.boundaries.resources;

import jakarta.annotation.security.PermitAll;
import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.SecurityContext;
import tn.supcom.cot.api.boundaries.security.SecurityService;
import tn.supcom.cot.api.controllers.repositories.IdentityRepository;
import tn.supcom.cot.api.dto.Requests;
import tn.supcom.cot.api.dto.UserDto;
import tn.supcom.cot.iam.security.PasswordHasher;

import java.util.Map;

/**
 * Authentification : émission de jetons JWT (servie sur iam.&lt;domaine&gt;).
 * <ul>
 *   <li>POST /api/auth/login : utilisateurs (opérateurs, administrateurs) ;</li>
 *   <li>POST /api/auth/token : clients d'API, flux OAuth 2.0 « client credentials » (RFC 6749 § 4.4),
 *       identifiants en HTTP Basic ou dans le formulaire ;</li>
 *   <li>GET /api/auth/me : profil de l'utilisateur connecté.</li>
 * </ul>
 */
@Path("auth")
@RequestScoped
@Transactional
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AuthResource {
    @Inject
    private IdentityRepository identities;
    @Inject
    private SecurityService security;
    @Inject
    private tn.supcom.cot.api.controllers.repositories.TenantRepository tenants;

    /** POST /api/auth/login {username, password} -> {token, expiresIn, user} */
    @POST
    @Path("login")
    @PermitAll
    public Map<String, Object> login(Requests.Login req) throws InterruptedException {
        if (req == null || req.username() == null || req.password() == null) {
            throw new BadRequestException("username and password are required");
        }
        var identity = identities.findByUsername(req.username().trim())
                .filter(i -> i.isEnabled() && PasswordHasher.verify(req.password(), i.getPassword()));
        if (identity.isEmpty()) {
            Thread.sleep(400); // ralentit les attaques par force brute
            throw new NotAuthorizedException("Bearer realm=\"floodwatch\"");
        }
        var i = identity.get();
        String token = security.tokens().issue(i.getId().toString(), i.getUsername(), i.roleSet());
        return Map.of("token", token, "tokenType", "Bearer", "expiresIn", security.tokens().ttlSeconds(),
                "user", UserDto.of(i));
    }

    /** POST /api/auth/token (application/x-www-form-urlencoded) -> {access_token, token_type, expires_in, scope} */
    @POST
    @Path("token")
    @PermitAll
    @Consumes(MediaType.APPLICATION_FORM_URLENCODED)
    public jakarta.ws.rs.core.Response token(@FormParam("grant_type") String grantType,
                                             @FormParam("client_id") String clientId,
                                             @FormParam("client_secret") String clientSecret,
                                             @FormParam("scope") String scope,
                                             @HeaderParam("Authorization") String authorization) throws InterruptedException {
        if (authorization != null && authorization.regionMatches(true, 0, "Basic ", 0, 6)) {
            try {
                String decoded = new String(java.util.Base64.getDecoder().decode(authorization.substring(6).trim()),
                        java.nio.charset.StandardCharsets.UTF_8);
                int colon = decoded.indexOf(':');
                if (colon > 0) {
                    clientId = java.net.URLDecoder.decode(decoded.substring(0, colon), java.nio.charset.StandardCharsets.UTF_8);
                    clientSecret = java.net.URLDecoder.decode(decoded.substring(colon + 1), java.nio.charset.StandardCharsets.UTF_8);
                }
            } catch (IllegalArgumentException e) {
                return oauthError(400, "invalid_request");
            }
        }
        if (!"client_credentials".equals(grantType)) return oauthError(400, "unsupported_grant_type");
        if (clientId == null || clientSecret == null) return oauthError(400, "invalid_request");
        final String secret = clientSecret;
        var client = tenants.findByName(clientId).filter(tn.supcom.cot.iam.entities.Tenant::isEnabled)
                .filter(t -> PasswordHasher.verify(secret, t.getSecret()));
        if (client.isEmpty()) {
            Thread.sleep(400); // ralentit les attaques par force brute
            return oauthError(401, "invalid_client");
        }
        var granted = client.get().scopeSet();
        var requested = scope == null || scope.isBlank() ? granted : tn.supcom.cot.iam.entities.Tenant.words(scope);
        if (!granted.containsAll(requested)) return oauthError(400, "invalid_scope");
        String jwt = security.tokens().issueClient(clientId, requested, client.get().zoneSet());
        return jakarta.ws.rs.core.Response.ok(Map.of("access_token", jwt, "token_type", "Bearer",
                        "expires_in", security.tokens().ttlSeconds(), "scope", String.join(" ", new java.util.TreeSet<>(requested))))
                .header("Cache-Control", "no-store").build();
    }

    /** Erreur au format OAuth 2.0 (RFC 6749 § 5.2). */
    private static jakarta.ws.rs.core.Response oauthError(int status, String error) {
        var r = jakarta.ws.rs.core.Response.status(status).type(MediaType.APPLICATION_JSON).entity(Map.of("error", error))
                .header("Cache-Control", "no-store");
        if (status == 401) r.header("WWW-Authenticate", "Basic realm=\"floodwatch\"");
        return r.build();
    }

    /** GET /api/auth/me : profil de l'utilisateur connecté. */
    @GET
    @Path("me")
    public UserDto me(@Context SecurityContext sc) {
        return identities.findByUsername(sc.getUserPrincipal().getName()).map(UserDto::of)
                .orElseThrow(() -> new NotAuthorizedException("Bearer"));
    }
}

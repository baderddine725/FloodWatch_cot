/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : AuthenticationFilter.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.boundaries.security;

import jakarta.annotation.Priority;
import jakarta.annotation.security.DenyAll;
import jakarta.annotation.security.PermitAll;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.ResourceInfo;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.SecurityContext;
import jakarta.ws.rs.ext.Provider;
import tn.supcom.cot.iam.security.Role;
import tn.supcom.cot.iam.security.TokenService;

import java.lang.reflect.AnnotatedElement;
import java.security.Principal;
import java.util.Map;
import java.util.Set;

/**
 * Authentification par jeton (Bearer JWT) et contrôle d'accès par rôles
 * ({@code @RolesAllowed}, {@code @PermitAll}, {@code @DenyAll}) sur les ressources REST.
 * Par défaut (aucune annotation), un utilisateur authentifié est exigé.
 */
@Provider
@Priority(Priorities.AUTHENTICATION)
public class AuthenticationFilter implements ContainerRequestFilter {
    @Inject
    private SecurityService security;
    @Context
    private ResourceInfo resourceInfo;

    @Override
    public void filter(ContainerRequestContext ctx) {
        var claims = security.fromAuthorizationHeader(ctx.getHeaderString(HttpHeaders.AUTHORIZATION)).orElse(null);
        if (claims != null) {
            boolean secure = ctx.getSecurityContext() != null && ctx.getSecurityContext().isSecure();
            ctx.setSecurityContext(new JwtSecurityContext(claims, secure));
        }
        var method = resourceInfo == null ? null : resourceInfo.getResourceMethod();
        if (method == null) return; // pré-vol CORS, ressource inconnue...

        AnnotatedElement[] scopes = {method, resourceInfo.getResourceClass()};
        for (var scope : scopes) {
            if (scope.isAnnotationPresent(DenyAll.class)) {
                abort(ctx, Response.Status.FORBIDDEN, "access denied");
                return;
            }
            if (scope.isAnnotationPresent(PermitAll.class)) return;
            var rolesAllowed = scope.getAnnotation(RolesAllowed.class);
            if (rolesAllowed != null) {
                if (claims == null) {
                    abort(ctx, Response.Status.UNAUTHORIZED, "authentication required");
                } else if (!claims.hasAnyRole(Set.of(rolesAllowed.value()))) {
                    abort(ctx, Response.Status.FORBIDDEN, "insufficient role");
                }
                return;
            }
        }
        if (claims == null) abort(ctx, Response.Status.UNAUTHORIZED, "authentication required");
    }

    private static void abort(ContainerRequestContext ctx, Response.Status status, String message) {
        var builder = Response.status(status).type(MediaType.APPLICATION_JSON)
                .entity(Map.of("status", status.getStatusCode(), "error", message));
        if (status == Response.Status.UNAUTHORIZED) builder.header(HttpHeaders.WWW_AUTHENTICATE, "Bearer realm=\"floodwatch\"");
        ctx.abortWith(builder.build());
    }

    /** Contexte de sécurité issu du jeton. */
    public record JwtSecurityContext(TokenService.Claims claims, boolean secure) implements SecurityContext {
        @Override
        public Principal getUserPrincipal() {
            return claims::username;
        }

        @Override
        public boolean isUserInRole(String role) {
            try {
                return claims.roles().contains(Role.valueOf(role));
            } catch (IllegalArgumentException e) {
                return false;
            }
        }

        @Override
        public boolean isSecure() {
            return secure;
        }

        @Override
        public String getAuthenticationScheme() {
            return "Bearer";
        }
    }
}

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : CorsFilter.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.boundaries.security;

import jakarta.ws.rs.container.*;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;
import tn.supcom.cot.api.controllers.managers.AppConfig;

/**
 * En-têtes CORS (utile en développement quand les PWA ne sont pas servies par le même Nginx).
 * Origines autorisées : variable CORS_ALLOWED_ORIGINS (défaut « * », sans cookies : jetons Bearer).
 */
@Provider
@PreMatching
public class CorsFilter implements ContainerRequestFilter, ContainerResponseFilter {
    private final String allowed = AppConfig.get("cors.allowed.origins", "*");

    @Override
    public void filter(ContainerRequestContext req) {
        if ("OPTIONS".equalsIgnoreCase(req.getMethod()) && req.getHeaderString("Origin") != null) {
            req.abortWith(Response.ok().build());
        }
    }

    @Override
    public void filter(ContainerRequestContext req, ContainerResponseContext res) {
        String origin = req.getHeaderString("Origin");
        if (origin == null) return;
        boolean ok = "*".equals(allowed) || ("," + allowed.replace(" ", "") + ",").contains("," + origin + ",");
        if (!ok) return;
        var h = res.getHeaders();
        h.putSingle("Access-Control-Allow-Origin", "*".equals(allowed) ? "*" : origin);
        h.putSingle("Vary", "Origin");
        h.putSingle("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        h.putSingle("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match, If-None-Match");
        h.putSingle("Access-Control-Expose-Headers", "ETag, Location");
        h.putSingle("Access-Control-Max-Age", "3600");
    }
}

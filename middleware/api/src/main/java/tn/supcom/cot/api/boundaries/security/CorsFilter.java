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
 * En-têtes CORS de secours, pour le développement uniquement.
 * <p>En production, les en-têtes CORS sont posés par Undertow sur chaque hôte virtuel
 * (voir {@code middleware/wildfly/configure.cli}) : ce filtre reste donc INACTIF par
 * défaut, afin de ne pas émettre d'en-tête {@code Access-Control-Allow-Origin} en double
 * (ce qui serait rejeté par les navigateurs).
 * <p>Il s'active en renseignant {@code CORS_ALLOWED_ORIGINS} (origines séparées par une
 * virgule, ou « * ») — utile quand le front-end tourne sur un serveur de développement
 * distinct de WildFly. Aucun cookie n'est utilisé : l'authentification passe par un
 * jeton Bearer.
 */
@Provider
@PreMatching
public class CorsFilter implements ContainerRequestFilter, ContainerResponseFilter {
    /** Vide = filtre inactif (CORS traité par Undertow). */
    private final String allowed = AppConfig.get("cors.allowed.origins", "");

    @Override
    public void filter(ContainerRequestContext req) {
        if ("OPTIONS".equalsIgnoreCase(req.getMethod()) && req.getHeaderString("Origin") != null) {
            req.abortWith(Response.ok().build());
        }
    }

    @Override
    public void filter(ContainerRequestContext req, ContainerResponseContext res) {
        String origin = req.getHeaderString("Origin");
        if (origin == null || allowed.isEmpty()) return;
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

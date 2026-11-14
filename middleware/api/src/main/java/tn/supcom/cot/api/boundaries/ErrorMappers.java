/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : ErrorMappers.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.boundaries;

import jakarta.persistence.EntityNotFoundException;
import jakarta.persistence.OptimisticLockException;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

import java.util.Map;
import java.util.logging.Level;
import java.util.logging.Logger;

/** Traduction des exceptions en réponses JSON homogènes {"status": ..., "error": ...}. */
public final class ErrorMappers {
    private static final Logger LOG = Logger.getLogger(ErrorMappers.class.getName());

    private ErrorMappers() {
    }

    static Response json(int status, String message) {
        return Response.status(status).type(MediaType.APPLICATION_JSON)
                .entity(Map.of("status", status, "error", message == null ? "error" : message)).build();
    }

    /** Cause racine d'une exception (les intercepteurs transactionnels enveloppent souvent l'erreur). */
    static Throwable root(Throwable t) {
        Throwable c = t;
        while (c.getCause() != null && c.getCause() != c) {
            if (c instanceof IllegalArgumentException || c instanceof EntityNotFoundException
                    || c instanceof OptimisticLockException || c instanceof WebApplicationException) return c;
            c = c.getCause();
        }
        return c;
    }

    @Provider
    public static class Generic implements ExceptionMapper<Exception> {
        @Override
        public Response toResponse(Exception e) {
            var r = root(e);
            if (r instanceof WebApplicationException w) {
                var resp = w.getResponse();
                return resp.hasEntity() ? resp : json(resp.getStatus(), w.getMessage());
            }
            if (r instanceof EntityNotFoundException) return json(404, r.getMessage());
            if (r instanceof IllegalArgumentException) return json(400, r.getMessage());
            if (r instanceof OptimisticLockException || r.getClass().getSimpleName().contains("OptimisticLock")) {
                return json(409, "resource modified concurrently, reload and retry");
            }
            LOG.log(Level.SEVERE, "Unhandled REST error", e);
            return json(500, "internal error");
        }
    }
}

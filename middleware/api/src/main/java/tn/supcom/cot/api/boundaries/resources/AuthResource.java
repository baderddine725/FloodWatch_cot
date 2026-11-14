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

/** Authentification : émission d'un jeton JWT. */
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

    /** GET /api/auth/me : profil de l'utilisateur connecté. */
    @GET
    @Path("me")
    public UserDto me(@Context SecurityContext sc) {
        return identities.findByUsername(sc.getUserPrincipal().getName()).map(UserDto::of)
                .orElseThrow(() -> new NotAuthorizedException("Bearer"));
    }
}

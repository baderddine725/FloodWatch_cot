/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : UserResource.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.boundaries.resources;

import jakarta.annotation.security.RolesAllowed;
import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.SecurityContext;
import tn.supcom.cot.api.controllers.repositories.IdentityRepository;
import tn.supcom.cot.api.dto.Requests;
import tn.supcom.cot.api.dto.UserDto;
import tn.supcom.cot.iam.entities.Identity;
import tn.supcom.cot.iam.security.PasswordHasher;
import tn.supcom.cot.iam.security.Role;

import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/** Gestion des comptes (administrateurs). */
@Path("users")
@RequestScoped
@Transactional
@RolesAllowed("ADMIN")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class UserResource {
    @Inject
    private IdentityRepository identities;

    @GET
    public List<UserDto> list() {
        return identities.listOrdered().stream().map(UserDto::of).toList();
    }

    @POST
    public Response create(Requests.User req) {
        if (req == null || req.username() == null || req.username().isBlank()) throw new BadRequestException("username required");
        if (req.password() == null || req.password().length() < 8) throw new BadRequestException("password must have at least 8 characters");
        if (identities.findByUsername(req.username().trim()).isPresent()) throw new ClientErrorException("username already exists", 409);
        var i = new Identity();
        i.setUsername(req.username().trim());
        i.setPassword(PasswordHasher.hash(req.password()));
        i.setFullName(req.fullName());
        i.setRoles(Role.toMask(roles(req.roles())));
        i.setProvidedScopes("");
        if (req.enabled() != null) i.setEnabled(req.enabled());
        identities.persist(i);
        return Response.status(201).entity(UserDto.of(i)).build();
    }

    @PUT
    @Path("{id}")
    public UserDto update(@PathParam("id") UUID id, Requests.User req, @Context SecurityContext sc) {
        if (req == null) throw new BadRequestException("body required");
        var i = identities.find(id);
        if (req.fullName() != null) i.setFullName(req.fullName());
        if (req.password() != null) {
            if (req.password().length() < 8) throw new BadRequestException("password must have at least 8 characters");
            i.setPassword(PasswordHasher.hash(req.password()));
        }
        boolean self = i.getUsername().equals(sc.getUserPrincipal().getName());
        if (req.roles() != null) {
            var r = roles(req.roles());
            if (self && !r.contains(Role.ADMIN)) throw new BadRequestException("you cannot remove your own ADMIN role");
            i.setRoles(Role.toMask(r));
        }
        if (req.enabled() != null) {
            if (self && !req.enabled()) throw new BadRequestException("you cannot disable your own account");
            i.setEnabled(req.enabled());
        }
        return UserDto.of(i);
    }

    @DELETE
    @Path("{id}")
    public Response delete(@PathParam("id") UUID id, @Context SecurityContext sc) {
        var i = identities.find(id);
        if (i.getUsername().equals(sc.getUserPrincipal().getName())) throw new BadRequestException("you cannot delete yourself");
        identities.delete(i);
        return Response.noContent().build();
    }

    private static EnumSet<Role> roles(List<String> names) {
        var set = EnumSet.noneOf(Role.class);
        if (names != null) names.forEach(n -> set.add(Role.valueOf(n.trim().toUpperCase(Locale.ROOT))));
        if (set.isEmpty()) throw new BadRequestException("at least one role is required");
        return set;
    }
}

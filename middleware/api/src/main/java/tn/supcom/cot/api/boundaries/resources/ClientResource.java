/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : ClientResource.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-17          Modifié le : 2026-11-17
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.boundaries.resources;

import jakarta.annotation.security.RolesAllowed;
import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import tn.supcom.cot.api.controllers.repositories.TenantRepository;
import tn.supcom.cot.iam.entities.Tenant;
import tn.supcom.cot.iam.security.PasswordHasher;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Administration des clients d'API (ADMIN). Le secret n'est montré QU'UNE fois, à la création ;
 * seule son empreinte PBKDF2 est conservée.
 * <ul>
 *   <li>GET /api/clients ; POST /api/clients {name, displayName, scopes[], zones[]} ;</li>
 *   <li>PUT /api/clients/{name}/enabled {enabled} ; DELETE /api/clients/{name}.</li>
 * </ul>
 */
@Path("clients")
@RequestScoped
@Transactional
@RolesAllowed("ADMIN")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class ClientResource {
    /** Portées connues : en ajouter ici quand un service s'ouvre aux clients. */
    public static final Set<String> KNOWN_SCOPES = Set.of("forecast:read");
    private static final Pattern NAME = Pattern.compile("[a-z0-9][a-z0-9-]{2,62}");
    private static final Pattern ZONE = Pattern.compile("\\*|[a-z0-9][a-z0-9-]{0,62}");
    private static final SecureRandom RANDOM = new SecureRandom();

    @Inject
    private TenantRepository tenants;

    public record CreateClient(String name, String displayName, List<String> scopes, List<String> zones) {
    }

    public record Enabled(Boolean enabled) {
    }

    @GET
    public List<Map<String, Object>> list() {
        return tenants.listOrdered().stream().map(ClientResource::view).toList();
    }

    @POST
    public Response create(CreateClient req) {
        if (req == null || req.name() == null || !NAME.matcher(req.name()).matches()) {
            throw new BadRequestException("name must match [a-z0-9][a-z0-9-]{2,62}");
        }
        if (tenants.findByName(req.name()).isPresent()) throw new ClientErrorException("client already exists", 409);
        var scopes = req.scopes() == null ? List.<String>of() : req.scopes();
        if (scopes.isEmpty() || !KNOWN_SCOPES.containsAll(scopes)) {
            throw new BadRequestException("scopes must be a non-empty subset of " + KNOWN_SCOPES);
        }
        var zones = req.zones() == null ? List.<String>of() : req.zones();
        if (zones.isEmpty() || !zones.stream().allMatch(z -> ZONE.matcher(z).matches())) {
            throw new BadRequestException("zones must be a non-empty list of zone codes, or [\"*\"]");
        }
        byte[] raw = new byte[32];
        RANDOM.nextBytes(raw);
        String secret = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        var t = new Tenant();
        t.setName(req.name());
        t.setDisplayName(req.displayName());
        t.setSecret(PasswordHasher.hash(secret));
        t.setRequiredScopes(String.join(" ", scopes));
        t.setZones(String.join(" ", zones));
        tenants.persist(t);
        var body = new LinkedHashMap<>(view(t));
        body.put("clientSecret", secret);
        body.put("note", "secret shown once: store it now (only its PBKDF2 hash is kept)");
        return Response.status(Response.Status.CREATED).entity(body).build();
    }

    @PUT
    @Path("{name}/enabled")
    public Map<String, Object> enable(@PathParam("name") String name, Enabled req) {
        var t = tenants.findByName(name).orElseThrow(() -> new NotFoundException("client not found: " + name));
        if (req == null || req.enabled() == null) throw new BadRequestException("enabled required");
        t.setEnabled(req.enabled());
        return view(t);
    }

    @DELETE
    @Path("{name}")
    public Response delete(@PathParam("name") String name) {
        var t = tenants.findByName(name).orElseThrow(() -> new NotFoundException("client not found: " + name));
        tenants.delete(t);
        return Response.noContent().build();
    }

    static Map<String, Object> view(Tenant t) {
        var m = new LinkedHashMap<String, Object>();
        m.put("clientId", t.getName());
        m.put("displayName", t.getDisplayName());
        m.put("scopes", t.scopeSet());
        m.put("zones", t.zoneSet());
        m.put("enabled", t.isEnabled());
        m.put("createdAt", t.getCreatedAt());
        return m;
    }
}

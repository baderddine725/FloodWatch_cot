/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : RequiresScope.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-17          Modifié le : 2026-11-17
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.boundaries.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Ressource ouverte aux CLIENTS D'API qui détiennent la portée indiquée (et aux opérateurs).
 * <p>Moindre privilège : un jeton de client n'est accepté QUE sur les ressources ainsi annotées ;
 * partout ailleurs il est refusé, même là où un simple utilisateur authentifié suffirait.</p>
 */
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD, ElementType.TYPE})
public @interface RequiresScope {
    /** Portée exigée, ex. {@code forecast:read}. */
    String value();
}

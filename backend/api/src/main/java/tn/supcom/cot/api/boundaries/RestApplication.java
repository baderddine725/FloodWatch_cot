/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – back-end
 *  Fichier   : RestApplication.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.boundaries;

import jakarta.ws.rs.ApplicationPath;
import jakarta.ws.rs.core.Application;

/** Racine de l'API REST : {@code /floodwatch/api} (exposée en {@code /api} par Nginx). */
@ApplicationPath("api")
public class RestApplication extends Application {
}

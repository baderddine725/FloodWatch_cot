/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : AutomationManager.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.managers;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import tn.supcom.cot.api.controllers.commands.ActuationPolicy;
import tn.supcom.cot.api.controllers.commands.DefaultActuationPolicy;
import tn.supcom.cot.api.controllers.commands.SamplingCommand;
import tn.supcom.cot.api.controllers.repositories.CommandRepository;
import tn.supcom.cot.api.entities.CommandOrigin;
import tn.supcom.cot.api.entities.ControlMode;
import tn.supcom.cot.api.entities.Station;

/**
 * Automatisme Cloud : aligne les actionneurs d'une station sur la politique de réaction
 * ({@link ActuationPolicy}) correspondant à son niveau d'alerte. Idempotent : n'émet une commande
 * que si l'état rapporté diffère de la cible et qu'aucune commande identique n'est en attente.
 * En mode MANUAL, seule la période d'échantillonnage reste automatique.
 */
@ApplicationScoped
@Transactional
public class AutomationManager {
    private final ActuationPolicy policy = new DefaultActuationPolicy();

    @Inject
    private CommandManager commandManager;
    @Inject
    private CommandRepository commands;

    /** Applique la politique au dernier état connu de la station. */
    public void apply(Station station) {
        if (!station.isOnline()) return;
        for (var cmd : policy.targetsFor(station.getAlertLevel())) {
            boolean automatic = station.getControlMode() == ControlMode.AUTO || cmd instanceof SamplingCommand;
            if (!automatic || cmd.isSatisfiedBy(station)) continue;
            if (commands.hasPending(station, cmd.actuator(), cmd.value())) continue;
            commandManager.issue(station, cmd, "system", CommandOrigin.AUTO);
        }
    }
}

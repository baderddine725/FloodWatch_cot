/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : prediction – back-end & IoT
 *  Fichier   : LevelSample.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.prediction;

import java.time.Instant;
import java.util.Objects;

/**
 * Une mesure de niveau d'eau à un instant donné.
 *
 * @param at      instant de la mesure (champ {@code ts} ajouté par la passerelle, ou date de réception)
 * @param levelCm hauteur d'eau en centimètres (champ {@code levelCm} de la télémétrie)
 */
public record LevelSample(Instant at, double levelCm) {

    /**
     * Vérifie que la mesure est exploitable.
     *
     * @throws NullPointerException     si {@code at} est nul
     * @throws IllegalArgumentException si le niveau n'est pas un nombre fini
     */
    public LevelSample {
        Objects.requireNonNull(at, "at");
        if (!Double.isFinite(levelCm)) {
            throw new IllegalArgumentException("Niveau d'eau non fini : " + levelCm);
        }
    }
}

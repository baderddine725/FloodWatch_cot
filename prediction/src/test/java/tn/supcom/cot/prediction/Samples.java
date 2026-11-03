/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : prediction – back-end & IoT
 *  Fichier   : Samples.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.prediction;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Fabrique de séries de mesures pour les tests.
 */
final class Samples {

    /** Instant de départ des séries. */
    static final Instant T0 = Instant.parse("2026-11-02T17:00:00Z");

    private Samples() {
    }

    /**
     * Série régulière : {@code count} mesures espacées de {@code stepSeconds}, chacune
     * ajoutant {@code deltaCm} au niveau.
     *
     * @param startCm     niveau de la première mesure
     * @param deltaCm     variation entre deux mesures
     * @param stepSeconds intervalle entre deux mesures
     * @param count       nombre de mesures
     * @return les mesures, dans l'ordre chronologique
     */
    static List<LevelSample> linear(double startCm, double deltaCm, int stepSeconds, int count) {
        List<LevelSample> samples = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            samples.add(new LevelSample(T0.plusSeconds((long) i * stepSeconds), startCm + i * deltaCm));
        }
        return samples;
    }

    /**
     * Série de {@code count} mesures, une par minute, montant à {@code speedCmPerMin} et se terminant
     * exactement à {@code endCm}.
     *
     * @param endCm         niveau de la dernière mesure
     * @param speedCmPerMin vitesse de montée
     * @param count         nombre de mesures
     * @return les mesures
     */
    static List<LevelSample> endingAt(double endCm, double speedCmPerMin, int count) {
        return linear(endCm - (count - 1) * speedCmPerMin, speedCmPerMin, 60, count);
    }
}

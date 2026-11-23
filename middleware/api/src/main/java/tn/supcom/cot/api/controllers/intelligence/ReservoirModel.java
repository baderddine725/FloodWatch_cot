/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware (intelligence Cloud)
 *  Fichier   : ReservoirModel.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-17          Modifié le : 2026-11-23
 *  Version   : 1.1
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.intelligence;

import java.util.function.DoubleUnaryOperator;

/**
 * Prévision du niveau par le modèle réservoir CALIBRÉ du site (classe pure, sans Jakarta EE).
 * <pre>
 *   dL/dt = a·pluie − b·L + g·Σ L_amont(t − τ)        (cm/min)
 * </pre>
 * Les coefficients {@code a}, {@code b}, {@code g} sont estimés par la passerelle (fog) sur les
 * mesures du site. L'apport amont pendant le temps de parcours est CONNU (niveaux déjà mesurés en
 * amont) ; au-delà, le niveau amont est supposé constant. La pluie est une fonction du temps :
 * prévision météo raccordée à la mesure ({@link RainOutlook}) quand elle existe, sinon constante
 * (persistance). L'hypothèse retenue est annoncée dans la réponse du service.
 *
 * @param a coefficient pluie -> montée (cm/min par unité de pluie)
 * @param b vidange (1/min)
 * @param g couplage amont (1/min)
 */
public record ReservoirModel(double a, double b, double g) {
    /** Pas d'intégration (s). */
    public static final double STEP_S = 10.0;

    /**
     * Intègre le modèle (Euler explicite) jusqu'à chaque horizon.
     *
     * @param level0     niveau courant (cm)
     * @param rain       pluie supposée constante (0..1)
     * @param upstreamAt apport amont : décalage en s depuis maintenant -> Σ L_amont(t − τ) (cm)
     * @param horizonsS  horizons en secondes, croissants
     * @param maxLevel   plafond physique du niveau (hauteur du capteur)
     * @return niveau prévu à chaque horizon
     */
    public double[] forecast(double level0, double rain, DoubleUnaryOperator upstreamAt, double[] horizonsS,
                             double maxLevel) {
        return forecast(level0, offsetS -> rain, upstreamAt, horizonsS, maxLevel);
    }

    /**
     * Même intégration, avec une pluie variable : {@code rainAt} donne la pluie (0..1) en fonction du
     * décalage en s depuis maintenant.
     */
    public double[] forecast(double level0, DoubleUnaryOperator rainAt, DoubleUnaryOperator upstreamAt,
                             double[] horizonsS, double maxLevel) {
        double[] out = new double[horizonsS.length];
        double level = level0, t = 0.0;
        for (int i = 0; i < horizonsS.length; i++) {
            while (t < horizonsS[i] - 1e-9) {
                double dt = Math.min(STEP_S, horizonsS[i] - t);
                double dLdtPerMin = a * rainAt.applyAsDouble(t) - b * level + g * upstreamAt.applyAsDouble(t);
                level = Math.max(0.0, Math.min(maxLevel, level + dLdtPerMin * dt / 60.0));
                t += dt;
            }
            out[i] = level;
        }
        return out;
    }

    /** Niveau d'équilibre sous une pluie et un apport amont constants (dL/dt = 0). */
    public double equilibrium(double rain, double upstream) {
        return b <= 0 ? Double.POSITIVE_INFINITY : (a * rain + g * upstream) / b;
    }
}

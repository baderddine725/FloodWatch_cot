/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : MedianFilterPredictor.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.alerting;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Décorateur de prédicteur (patron Decorator) : rejet des valeurs aberrantes par médiane
 * locale (filtre de Hampel simplifié) avant de déléguer. Une mesure qui s'écarte de plus de
 * {@code toleranceCm} de la médiane de ses voisines (ou des deux précédentes pour la dernière
 * mesure) est remplacée par cette médiane. Élimine les échos parasites du capteur ultrasonique
 * (HC-SR04) sans retarder ni aplatir une montée réelle.
 */
public class MedianFilterPredictor implements OverflowPredictor {
    private final OverflowPredictor delegate;
    private final double toleranceCm;

    public MedianFilterPredictor(OverflowPredictor delegate, double toleranceCm) {
        this.delegate = delegate;
        this.toleranceCm = toleranceCm;
    }

    /** Tolérance par défaut : 2 cm. */
    public MedianFilterPredictor(OverflowPredictor delegate) {
        this(delegate, 2.0);
    }

    @Override
    public Prediction predict(List<Sample> samples, double criticalCm) {
        return delegate.predict(filter(samples), criticalCm);
    }

    /** @return la série où les valeurs aberrantes sont remplacées par la médiane locale */
    public List<Sample> filter(List<Sample> samples) {
        int n = samples.size();
        if (n < 3) return samples;
        var out = new ArrayList<Sample>(n);
        for (int i = 0; i < n; i++) {
            int from = i == 0 ? 0 : (i == n - 1 ? n - 3 : i - 1);
            double[] w = {samples.get(from).levelCm(), samples.get(from + 1).levelCm(), samples.get(from + 2).levelCm()};
            Arrays.sort(w);
            double v = samples.get(i).levelCm();
            out.add(Math.abs(v - w[1]) > toleranceCm ? new Sample(samples.get(i).ts(), w[1]) : samples.get(i));
        }
        return out;
    }
}

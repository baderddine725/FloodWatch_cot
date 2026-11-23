/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware (intelligence Cloud)
 *  Fichier   : RainOutlook.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-23          Modifié le : 2026-11-23
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.intelligence;

import java.time.Instant;
import java.util.function.DoubleUnaryOperator;

/**
 * Prévision de pluie sur la station (classe pure, sans Jakarta EE), en intensité NORMALISÉE 0..1
 * comme le pluviomètre de la station.
 * <ul>
 *   <li>Pas de temps fixe ({@code stepS}, 15 min pour Open-Meteo) à partir de {@code start} :
 *       {@code values[k]} est l'intensité moyenne sur [start + k·step, start + (k+1)·step[.</li>
 *   <li><b>Raccord à la mesure</b> (« nowcasting ») : à l'instant présent, la pluie MESURÉE sur le
 *       site est plus juste qu'un modèle météo à maille kilométrique. On passe de l'une à l'autre avec
 *       un poids {@code exp(-Δt/τ)} (τ = {@link #BLEND_TAU_S}, 15 min).</li>
 *   <li>Au-delà de la couverture de la prévision : dernière valeur prévue.</li>
 * </ul>
 *
 * @param source  origine (ex. « open-meteo »)
 * @param issuedAt instant où la prévision a été obtenue
 * @param start   début du premier pas
 * @param stepS   durée d'un pas (s)
 * @param values  intensité normalisée par pas (0..1)
 */
public record RainOutlook(String source, Instant issuedAt, Instant start, long stepS, double[] values) {
    /** Constante de raccord mesure -> prévision (s). */
    public static final double BLEND_TAU_S = 900.0;

    public RainOutlook {
        if (stepS <= 0 || values == null || values.length == 0) {
            throw new IllegalArgumentException("rain outlook: at least one step of positive duration");
        }
    }

    /** Intensité prévue à l'instant {@code t} (sans raccord à la mesure). */
    public double at(Instant t) {
        long k = Math.floorDiv(t.getEpochSecond() - start.getEpochSecond(), stepS);
        if (k < 0) return values[0];
        return values[(int) Math.min(k, values.length - 1)];
    }

    /** Minutes couvertes par la prévision à partir de {@code now} (0 si déjà dépassée). */
    public long coverageMinutes(Instant now) {
        long end = start.getEpochSecond() + stepS * values.length;
        return Math.max(0, (end - now.getEpochSecond()) / 60);
    }

    /**
     * Pluie supposée en fonction du décalage (s) depuis {@code now} : raccord entre la pluie mesurée
     * {@code rainNow} et la prévision.
     */
    public DoubleUnaryOperator blended(Instant now, double rainNow) {
        return offsetS -> {
            double w = Math.exp(-Math.max(0.0, offsetS) / BLEND_TAU_S);
            double forecast = at(now.plusMillis((long) (offsetS * 1000)));
            return clamp(w * rainNow + (1 - w) * forecast);
        };
    }

    /** Intensité normalisée d'un cumul en mm sur un pas, {@code fullMmPerHour} valant 1. */
    public static double normalize(double mm, long stepS, double fullMmPerHour) {
        if (!(mm > 0) || fullMmPerHour <= 0) return 0.0;
        return clamp(mm * 3600.0 / stepS / fullMmPerHour);
    }

    private static double clamp(double v) {
        return Math.max(0.0, Math.min(1.0, v));
    }
}

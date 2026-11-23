/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware (intelligence Cloud)
 *  Fichier   : LearnedFeatures.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-23          Modifié le : 2026-11-23
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.intelligence;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Indicateurs du modèle de prévision appris : traduction ligne à ligne de {@code ml/forecast/features.py}
 * (la spécification). Mêmes lectures (médiane sur 60 s, mesure périmée après 180 s), mêmes sommes dans
 * le même ordre : {@code LearnedForecastParityTest} vérifie l'égalité exacte sur des mesures communes.
 */
public final class LearnedFeatures {
    public static final double MEDIAN_WINDOW_S = 60.0;
    public static final double STALE_S = 180.0;
    public static final double GRID_S = 30.0;
    /** Historique nécessaire avant t : 30 min de pluie, plus la médiane. */
    public static final double HISTORY_S = 1800.0 + MEDIAN_WINDOW_S;

    public static final List<String> FEATURES = List.of(
            "level_cm", "level_pct", "d1_cm", "d2_cm", "d5_cm", "d10_cm", "rain", "rain_mean10", "rain_mean30",
            "up_level_cm", "up_d5_cm", "up_at_h_cm", "has_upstream", "critical_cm");

    private LearnedFeatures() {
    }

    /** Mesures d'une station triées par instant (secondes depuis l'époque). */
    public static final class Series {
        private final double[] ts;
        private final double[] level;
        private final double[] rain;

        public Series(double[] ts, double[] level, double[] rain) {
            this.ts = ts;
            this.level = level;
            this.rain = rain;
        }

        /** Indice du premier instant strictement supérieur à x (bisect_right). */
        private int upper(double x) {
            int lo = 0;
            int hi = ts.length;
            while (lo < hi) {
                int mid = (lo + hi) >>> 1;
                if (x < ts[mid]) hi = mid;
                else lo = mid + 1;
            }
            return lo;
        }

        public Double levelAt(double x) {
            int hi = upper(x);
            int lo = upper(x - MEDIAN_WINDOW_S);
            if (hi > lo) return median(Arrays.copyOfRange(level, lo, hi));
            if (hi > 0 && x - ts[hi - 1] <= STALE_S) return level[hi - 1];
            return null;
        }

        public Double rainAt(double x) {
            int hi = upper(x);
            if (hi > 0 && x - ts[hi - 1] <= STALE_S) return rain[hi - 1];
            return null;
        }
    }

    /** Station amont et temps de parcours (s). */
    public record Upstream(String code, double travelS) {
    }

    /** Ce que le modèle sait d'une station. */
    public record Site(String code, double criticalCm, double sensorHeightCm, List<Upstream> upstream) {
    }

    static double median(double[] values) {
        double[] s = values.clone();
        Arrays.sort(s);
        int n = s.length;
        return n % 2 == 1 ? s[n / 2] : (s[n / 2 - 1] + s[n / 2]) / 2.0;
    }

    private static Double meanRain(Series series, double t, int points) {
        double total = 0.0;
        for (int k = 0; k < points; k++) {
            Double r = series.rainAt(t - k * GRID_S);
            if (r == null) return null;
            total += r;
        }
        return total / points;
    }

    /** Vecteur d'indicateurs de {@code site} à l'instant {@code t} pour l'horizon {@code horizonS}, ou null. */
    public static double[] features(Site site, double t, double horizonS, Map<String, Series> data) {
        Series own = data.get(site.code());
        if (own == null) return null;
        Double g0 = own.levelAt(t);
        if (g0 == null) return null;
        double[] past = new double[4];
        double[] lags = {60.0, 120.0, 300.0, 600.0};
        for (int i = 0; i < lags.length; i++) {
            Double g = own.levelAt(t - lags[i]);
            if (g == null) return null;
            past[i] = g0 - g;
        }
        Double rain = own.rainAt(t);
        Double mean10 = meanRain(own, t, 20);
        Double mean30 = meanRain(own, t, 60);
        if (rain == null || mean10 == null || mean30 == null) return null;
        double upLevel = 0.0;
        double upD5 = 0.0;
        double upAtH = 0.0;
        for (Upstream link : site.upstream()) {
            Series up = data.get(link.code());
            if (up == null) return null;
            Double u0 = up.levelAt(t);
            Double u5 = up.levelAt(t - 300.0);
            double x = t + horizonS - link.travelS();
            Double uh = up.levelAt(x < t ? x : t);
            if (u0 == null || u5 == null || uh == null) return null;
            upLevel += u0;
            upD5 += u0 - u5;
            upAtH += uh;
        }
        return new double[]{g0, 100.0 * g0 / site.criticalCm(), past[0], past[1], past[2], past[3], rain, mean10,
                mean30, upLevel, upD5, upAtH, site.upstream().isEmpty() ? 0.0 : 1.0, site.criticalCm()};
    }

    /** Liste de mesures (instant s, niveau, pluie) → série. */
    public static Series series(List<double[]> rows) {
        var sorted = new ArrayList<>(rows);
        sorted.sort((a, b) -> Double.compare(a[0], b[0]));
        double[] ts = new double[sorted.size()];
        double[] level = new double[sorted.size()];
        double[] rain = new double[sorted.size()];
        for (int i = 0; i < ts.length; i++) {
            ts[i] = sorted.get(i)[0];
            level[i] = sorted.get(i)[1];
            rain[i] = sorted.get(i)[2];
        }
        return new Series(ts, level, rain);
    }
}

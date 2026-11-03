/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : AppConfig.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.managers;

import org.eclipse.microprofile.config.ConfigProvider;

/**
 * Accès à la configuration (MicroProfile Config) avec valeurs par défaut.
 * Toute propriété peut être surchargée par une variable d'environnement :
 * {@code mqtt.broker.url} -> {@code MQTT_BROKER_URL}.
 */
public final class AppConfig {
    private AppConfig() {
    }

    /** @return la valeur de la propriété, ou {@code def} si absente/vide */
    public static String get(String key, String def) {
        try {
            return ConfigProvider.getConfig().getOptionalValue(key, String.class)
                    .map(String::trim).filter(s -> !s.isEmpty()).orElse(def);
        } catch (RuntimeException e) {
            return def;
        }
    }

    public static int getInt(String key, int def) {
        return Integer.parseInt(get(key, Integer.toString(def)));
    }

    public static long getLong(String key, long def) {
        return Long.parseLong(get(key, Long.toString(def)));
    }

    public static boolean getBool(String key, boolean def) {
        return Boolean.parseBoolean(get(key, Boolean.toString(def)));
    }
}

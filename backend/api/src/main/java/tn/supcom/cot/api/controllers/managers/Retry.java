/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : api – middleware
 *  Fichier   : Retry.java
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-02
 *  Version   : 1.0
 * ============================================================================
 */
package tn.supcom.cot.api.controllers.managers;

import jakarta.persistence.OptimisticLockException;

import java.util.function.Supplier;

/**
 * Nouvelle tentative en cas de conflit de version optimiste : une station active est mise à jour
 * chaque seconde par l'ingestion MQTT, une action opérateur concurrente doit simplement être rejouée.
 * Chaque tentative doit s'exécuter dans sa propre transaction.
 * <p>Remarque : un conflit détecté à la validation remonte sous forme de
 * {@code jakarta.transaction.RollbackException} (exception contrôlée relancée par l'intercepteur
 * transactionnel) : on intercepte donc {@link Exception} et non seulement {@link RuntimeException}.</p>
 */
public final class Retry {
    private static final int MAX_ATTEMPTS = 5;

    private Retry() {
    }

    /** Exécute l'action, rejouée jusqu'à 5 fois en cas de conflit optimiste. */
    public static <T> T onConflict(Supplier<T> action) {
        for (int attempt = 1; ; attempt++) {
            try {
                return action.get();
            } catch (Exception e) {
                if (attempt >= MAX_ATTEMPTS || !isOptimisticLock(e)) throw Retry.<RuntimeException>sneaky(e);
                try {
                    Thread.sleep(25L * attempt + (long) (Math.random() * 25));
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw Retry.<RuntimeException>sneaky(e);
                }
            }
        }
    }

    /** Relance une exception (éventuellement contrôlée) sans l'envelopper. */
    @SuppressWarnings("unchecked")
    static <E extends Throwable> E sneaky(Throwable t) throws E {
        throw (E) t;
    }

    /** @return vrai si l'exception (ou une de ses causes) est un conflit de version */
    public static boolean isOptimisticLock(Throwable t) {
        for (Throwable c = t; c != null; c = c.getCause()) {
            if (c instanceof OptimisticLockException) return true;
            String n = c.getClass().getSimpleName();
            if (n.contains("OptimisticLock") || n.contains("StaleObjectState") || n.contains("StaleState")) return true;
            if (c.getCause() == c) break;
        }
        return false;
    }
}

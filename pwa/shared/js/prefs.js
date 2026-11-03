/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : shared/js/prefs.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */

/**
 * Préférences locales (localStorage) tolérantes aux erreurs : navigation privée,
 * stockage bloqué ou quota dépassé. En cas d'échec, une copie en mémoire prend
 * le relais pour la durée de la page.
 */

/** Copie mémoire utilisée quand localStorage est indisponible. */
const memory = new Map();

/** Clés de stockage partagées par les deux PWA. */
export const KEYS = Object.freeze({
  token: 'fw.token',
  user: 'fw.user',
  demo: 'fw.demo',
});

/**
 * Lit une valeur texte.
 * @param {string} key clé de stockage
 * @returns {string|null} la valeur, ou null si absente
 */
function get(key) {
  try {
    const value = localStorage.getItem(key);
    if (value != null) return value;
  } catch {
    /* stockage indisponible : repli mémoire */
  }
  return memory.has(key) ? memory.get(key) : null;
}

/**
 * Écrit (ou supprime si la valeur est null/undefined) une valeur texte.
 * @param {string} key clé de stockage
 * @param {string|number|boolean|null|undefined} value valeur à mémoriser
 */
function set(key, value) {
  if (value == null) memory.delete(key);
  else memory.set(key, String(value));
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {
    /* ignoré : la copie mémoire suffit */
  }
}

/**
 * Lit une valeur JSON.
 * @param {string} key clé de stockage
 * @param {*} fallback valeur renvoyée si absente ou illisible
 * @returns {*} l'objet décodé ou fallback
 */
function getJSON(key, fallback = null) {
  const raw = get(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Écrit une valeur JSON (null supprime la clé).
 * @param {string} key clé de stockage
 * @param {*} value valeur sérialisable
 */
function setJSON(key, value) {
  set(key, value == null ? null : JSON.stringify(value));
}

export const prefs = Object.freeze({ get, set, getJSON, setJSON });

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : citoyen/js/preferences.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { prefs } from '../../shared/js/prefs.js';

/**
 * Préférences du citoyen, conservées uniquement sur l'appareil (localStorage) : parcours
 * d'accueil terminé, position, rayon d'alerte et points favoris. La position n'est envoyée au
 * serveur que si le citoyen active les notifications (filtrage géographique des alertes push).
 */

const KEY = 'fw.citizen';

/** Position par défaut quand la géolocalisation est refusée : centre de Tunis. */
export const DEFAULT_POSITION = Object.freeze({ lat: 36.8065, lng: 10.1815, source: 'default' });

/** Bornes du rayon d'alerte proposé (le serveur accepte jusqu'à 100 km, 5 km par défaut). */
export const RADIUS = Object.freeze({ min: 1, max: 10, initial: 5 });

/**
 * @typedef {object} CitizenPrefs
 * @property {boolean} onboarded parcours d'accueil terminé
 * @property {{lat: number, lng: number, source: 'device'|'default'}} position position de référence
 * @property {number} radiusKm rayon d'alerte
 * @property {string[]} favorites codes des stations favorites
 */

/**
 * Lit les préférences (valeurs par défaut si absentes ou illisibles).
 * @returns {CitizenPrefs} préférences
 */
export function loadPrefs() {
  const saved = prefs.getJSON(KEY, {}) ?? {};
  const position = saved.position && Number.isFinite(saved.position.lat) && Number.isFinite(saved.position.lng)
    ? saved.position : DEFAULT_POSITION;
  const radius = Number(saved.radiusKm);
  return {
    onboarded: saved.onboarded === true,
    position,
    radiusKm: Number.isFinite(radius) ? Math.min(RADIUS.max, Math.max(RADIUS.min, radius)) : RADIUS.initial,
    favorites: Array.isArray(saved.favorites) ? saved.favorites.filter((c) => typeof c === 'string') : [],
  };
}

/**
 * Modifie et enregistre une partie des préférences.
 * @param {Partial<CitizenPrefs>} patch champs modifiés
 * @returns {CitizenPrefs} préférences à jour
 */
export function savePrefs(patch) {
  const next = { ...loadPrefs(), ...patch };
  prefs.setJSON(KEY, next);
  return next;
}

/**
 * Ajoute ou retire une station des favoris.
 * @param {string} code code de la station
 * @returns {boolean} vrai si la station est désormais favorite
 */
export function toggleFavorite(code) {
  const { favorites } = loadPrefs();
  const has = favorites.includes(code);
  savePrefs({ favorites: has ? favorites.filter((c) => c !== code) : [...favorites, code] });
  return !has;
}

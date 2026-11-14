/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : shared/js/format.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { CONFIG } from './config.js';

/**
 * Libellés, couleurs et formats d'affichage communs (charte de la maquette Figma).
 * Aucune règle métier n'est recalculée ici : niveaux, prédictions et indices viennent du serveur.
 */

/**
 * Clé d'affichage d'une station : niveau d'alerte du serveur, ou OFFLINE si elle ne répond plus.
 * @typedef {'GREEN'|'YELLOW'|'ORANGE'|'RED'|'OFFLINE'} LevelKey
 */

/** Charte des niveaux (couleurs de la maquette, classes CSS en minuscules). */
export const LEVELS = Object.freeze({
  GREEN: { css: 'green', label: 'Normal', citizen: 'Praticable', color: '#16a34a', rank: 1 },
  YELLOW: { css: 'yellow', label: 'Vigilance', citizen: 'Surveillance renforcée', color: '#c39808', rank: 3 },
  ORANGE: { css: 'orange', label: 'Alerte orange', citizen: 'Prudence : montée des eaux', color: '#f97316', rank: 4 },
  RED: { css: 'red', label: 'Alerte rouge', citizen: 'Fermé : ne pas s’engager', color: '#dc2626', rank: 5 },
  OFFLINE: { css: 'offline', label: 'Hors ligne', citizen: 'Information indisponible', color: '#8793a2', rank: 2 },
});

/** Types de points surveillés (énumération StationType du backend). */
export const STATION_TYPES = Object.freeze({
  UNDERPASS: 'Passage souterrain', WADI: 'Oued / gué', LOW_ROAD: 'Route en contrebas', FORD: 'Gué', OTHER: 'Point critique',
});

/** Types d'alertes (énumération AlertType du backend). */
export const ALERT_TYPES = Object.freeze({
  LEVEL: 'Seuil dépassé', OFFLINE: 'Station hors ligne', SENSOR_FAULT: 'Défaut du capteur', LOCAL_SAFETY: 'Sécurité locale',
});

/** Actionneurs et valeurs des commandes. */
export const ACTUATORS = Object.freeze({ barrier: 'Barrière', light: 'Feu', siren: 'Sirène', sampling: 'Fréquence de mesure' });
export const VALUES = Object.freeze({
  OPEN: 'ouverte', CLOSE: 'fermée', CLOSED: 'fermée', GREEN: 'vert', ORANGE: 'orange', RED: 'rouge', OFF: 'éteint',
  ON: 'activée', NORMAL: 'normale', WATCH: 'renforcée', UNKNOWN: 'inconnu',
});

/**
 * @param {{online: boolean, alertLevel: string}} station StationDto
 * @returns {LevelKey} niveau à afficher
 */
export function levelOf(station) {
  if (!station?.online) return 'OFFLINE';
  return LEVELS[station.alertLevel] ? station.alertLevel : 'GREEN';
}

/**
 * Tri par gravité décroissante (rouge, orange, jaune, hors ligne, normal).
 * @param {object} a StationDto
 * @param {object} b StationDto
 * @returns {number} ordre de tri
 */
export function bySeverity(a, b) {
  return LEVELS[levelOf(b)].rank - LEVELS[levelOf(a)].rank || (b.riskIndex ?? 0) - (a.riskIndex ?? 0)
    || String(a.name).localeCompare(String(b.name), 'fr');
}

/**
 * État d'une commande vu par l'opérateur.
 * @param {{status: string, detail: string|null, issuedAt: string}} command CommandDto
 * @returns {'pending'|'acked'|'failed'|'expired'|'stale'} état d'affichage
 */
export function commandState(command) {
  if (command.status === 'ACKED') return 'acked';
  if (command.status === 'FAILED') {
    // TEMPORAIRE : le backend signale l'expiration par FAILED + ce texte (CommandManager.expirePending).
    // À remplacer par un statut EXPIRED dédié dès qu'il existera côté API.
    return /délai d'acquittement/i.test(command.detail ?? '') ? 'expired' : 'failed';
  }
  // Sans nouvelle du serveur bien après l'échéance (flux coupé ?), on ne prétend pas que tout va bien.
  const age = (Date.now() - Date.parse(command.issuedAt)) / 1000;
  return age > CONFIG.commandAckTimeoutSec + 15 ? 'stale' : 'pending';
}

/** Libellés des états de commande. */
export const COMMAND_STATES = Object.freeze({
  pending: 'En attente d’acquittement', acked: 'Acquittée', failed: 'Échec', expired: 'Expirée (15 s sans réponse)',
  stale: 'Sans réponse : vérifier la station',
});

/**
 * Statut d'une alerte pour l'affichage (dérivé des champs AlertDto).
 * @param {{active: boolean, acknowledgedAt: string|null}} alert AlertDto
 * @returns {'new'|'acknowledged'|'resolved'} statut
 */
export function alertStatus(alert) {
  if (!alert.active) return 'resolved';
  return alert.acknowledgedAt ? 'acknowledged' : 'new';
}

// ----------------------------------------------------------------------------- texte et nombres

/**
 * Échappe une valeur pour une insertion sûre dans du HTML.
 * @param {*} value valeur quelconque
 * @returns {string} texte échappé
 */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Formate un nombre à la française.
 * @param {number|null|undefined} value nombre
 * @param {number} [digits=1] nombre de décimales
 * @returns {string} nombre formaté, ou « — » si absent
 */
export function num(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString(CONFIG.locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/**
 * Intensité de pluie : le serveur fournit une intensité 0..1 (pas des mm/h).
 * @param {number|null} rain intensité
 * @returns {string} pourcentage formaté
 */
export function rainText(rain) {
  return rain == null ? '—' : `${num(rain * 100, 0)} %`;
}

/**
 * Temps avant débordement.
 * @param {number|null} minutes minutesToOverflow (null = pas de montée)
 * @returns {string} texte court
 */
export function overflowText(minutes) {
  if (minutes == null) return 'Pas de montée';
  if (minutes < 1) return 'Imminent';
  if (minutes >= 120) return `${num(minutes / 60, 0)} h`;
  return `${num(minutes, 0)} min`;
}

// ----------------------------------------------------------------------------- dates (fuseau Africa/Tunis)

/**
 * @param {string|number|Date|null} value instant ISO-8601, millisecondes ou Date
 * @returns {Date|null} la date, ou null si absente/invalide
 */
function toDate(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Heure (hh:mm, ou hh:mm:ss avec seconds) dans le fuseau de Tunis.
 * @param {string|number|Date|null} value instant
 * @param {boolean} [seconds=false] afficher les secondes
 * @returns {string} heure formatée, ou « — »
 */
export function time(value, seconds = false) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleTimeString(CONFIG.locale, { hour: '2-digit', minute: '2-digit', ...(seconds && { second: '2-digit' }), timeZone: CONFIG.timeZone });
}

/**
 * Date et heure courtes (jj/mm hh:mm) dans le fuseau de Tunis.
 * @param {string|number|Date|null} value instant
 * @returns {string} date formatée, ou « — »
 */
export function dateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleString(CONFIG.locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: CONFIG.timeZone });
}

/**
 * Date longue (ex. « mardi 3 novembre ») dans le fuseau de Tunis.
 * @param {string|number|Date|null} value instant
 * @returns {string} date formatée, ou « — »
 */
export function longDate(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString(CONFIG.locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: CONFIG.timeZone });
}

/**
 * Durée relative (« il y a 12 s »).
 * @param {string|number|Date|null} value instant passé
 * @returns {string} durée relative, ou « jamais »
 */
export function ago(value) {
  const d = toDate(value);
  if (!d) return 'jamais';
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
}

/**
 * Durée entre deux instants (« 1 h 05 », « 42 min », « 38 s »).
 * @param {string|number|Date} from début
 * @param {string|number|Date|null} [to] fin (maintenant si absent)
 * @returns {string} durée formatée, ou « — »
 */
export function duration(from, to = Date.now()) {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b) return '—';
  const s = Math.max(0, Math.round((b - a) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/**
 * Distance orthodromique (formule de Haversine, comme PushManager côté serveur).
 * @param {number} lat1 latitude 1 (degrés)
 * @param {number} lon1 longitude 1
 * @param {number} lat2 latitude 2
 * @param {number} lon2 longitude 2
 * @returns {number} distance en kilomètres
 */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

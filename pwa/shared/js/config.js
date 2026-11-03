/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : shared/js/config.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { prefs, KEYS } from './prefs.js';

/**
 * Configuration des PWA. Les URL sont relatives : Nginx sert les PWA, l'API (/api)
 * et le WebSocket (/ws) sur la même origine HTTPS (voir deploy/nginx).
 */

const params = new URLSearchParams(location.search);

export const CONFIG = Object.freeze({
  /** Préfixe de l'API REST. */
  apiBase: '/api',
  /** Chemin du flux temps réel. */
  wsPath: '/ws/live',
  /** Fuseau d'affichage des heures (stations du Grand Tunis). */
  timeZone: 'Africa/Tunis',
  locale: 'fr-FR',
  /** Délai d'acquittement d'une commande côté serveur (command.ack.timeout.seconds). */
  commandAckTimeoutSec: 15,
  /** Sans message pendant ce délai, la connexion WebSocket est considérée comme morte (le serveur envoie un ping toutes les 30 s). */
  wsSilenceMs: 75_000,
  /** Délai maximal entre deux tentatives de reconnexion. */
  wsMaxDelayMs: 30_000,
  /** ?perf=1 : journalise dans la console la latence mesure → affichage. */
  perf: params.has('perf'),
});

/**
 * Construit l'URL du WebSocket (wss en HTTPS).
 * @param {string|null} token jeton JWT opérateur/admin (ajoute les alertes et commandes au flux)
 * @returns {string} URL absolue du flux /ws/live
 */
export function wsUrl(token) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${proto}://${location.host}${CONFIG.wsPath}${query}`;
}

// ----------------------------------------------------------------------------- mode démonstration
// ?demo=1 active (mémorisé), ?demo=0 désactive. window.FW_DEMO = true le force (page de démonstration hébergée).
if (params.has('demo')) prefs.set(KEYS.demo, params.get('demo') === '0' ? null : '1');

/** État du mode démonstration (backend simulé dans le navigateur, sans serveur). */
export const demo = Object.freeze({
  forced: window.FW_DEMO === true,
  active: window.FW_DEMO === true || prefs.get(KEYS.demo) === '1',
});

let demoBackendPromise = null;

/**
 * Charge le backend simulé à la demande : le module demo.js n'est jamais téléchargé
 * hors mode démonstration.
 * @returns {Promise<import('./demo.js').DemoBackend>} instance unique partagée par l'API et le temps réel
 */
export function demoBackend() {
  demoBackendPromise ??= import('./demo.js').then((m) => new m.DemoBackend());
  return demoBackendPromise;
}

/**
 * Active ou désactive le mode démonstration puis recharge la page.
 * @param {boolean} on vrai pour activer
 */
export function setDemo(on) {
  prefs.set(KEYS.demo, on ? '1' : null);
  location.reload();
}

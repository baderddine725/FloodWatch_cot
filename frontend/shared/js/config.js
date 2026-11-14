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
 * Configuration des deux front-ends (front-office citoyen, back-office pilotage).
 *
 * Depuis la version 2.0, WildFly sert chaque partie sur son propre nom DNS
 * (hôtes virtuels Undertow, voir middleware/wildfly/add-host.cli) :
 *
 *   https://www.<domaine>/     front-office  (espace citoyen)
 *   https://admin.<domaine>/   back-office   (espace pilotage)
 *   https://api.<domaine>/     API REST + WebSocket temps réel
 *   https://iam.<domaine>/     authentification (/api/auth/**) uniquement
 *
 * Les origines sont déduites du nom d'hôte courant : aucun domaine n'est codé en
 * dur, la même PWA fonctionne en local, en recette et en production. Si la page
 * est servie depuis « localhost » ou une adresse IP (développement, tunnel), tout
 * est supposé sur la même origine et les chemins restent relatifs.
 */

const params = new URLSearchParams(location.search);

/** Préfixes DNS reconnus (ils déterminent le domaine de base). */
const PREFIXES = /^(www|admin|api|iam)\.(.+)$/;

/**
 * Déduit les quatre origines du déploiement à partir de l'adresse courante.
 * @returns {{api: string, iam: string, public: string, admin: string, split: boolean}}
 *          origines absolues (sans barre finale) ; « split » est faux en mode
 *          origine unique (localhost, adresse IP, nom sans point).
 */
function deployment() {
  const { protocol, hostname } = location;
  const port = location.port ? `:${location.port}` : '';
  const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  const single = hostname === 'localhost' || ip || !hostname.includes('.');
  if (single) {
    // Origine unique : les chemins relatifs suffisent (l'API est sur la même origine).
    return { api: '', iam: '', public: '', admin: '', split: false };
  }
  const base = PREFIXES.exec(hostname)?.[2] ?? hostname; // www.x.tn -> x.tn ; x.tn -> x.tn
  const origin = (prefix) => `${protocol}//${prefix}.${base}${port}`;
  return {
    api: origin('api'),
    iam: origin('iam'),
    public: origin('www'),
    admin: origin('admin'),
    split: true,
  };
}

const hosts = deployment();

export const CONFIG = Object.freeze({
  /** Préfixe de l'API REST (absolu en production : https://api.<domaine>/api). */
  apiBase: `${hosts.api}/api`,
  /** Préfixe des routes d'authentification, servies par le nom iam.<domaine>. */
  iamBase: `${hosts.iam}/api`,
  /** Adresse du back-office (lien « espace opérateurs » du front-office). */
  adminUrl: hosts.split ? `${hosts.admin}/` : '/',
  /** Adresse du front-office (lien de retour depuis le back-office). */
  publicUrl: hosts.split ? `${hosts.public}/` : '/',
  /** Vrai quand les quatre noms DNS sont en service (production). */
  splitHosts: hosts.split,
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
 * Construit l'URL du WebSocket (wss en HTTPS). Le flux est servi par l'hôte
 * virtuel api-host, donc sur une origine différente de celle de la page.
 * @param {string|null} token jeton JWT opérateur/admin (ajoute les alertes et commandes au flux)
 * @returns {string} URL absolue du flux /ws/live
 */
export function wsUrl(token) {
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  const origin = hosts.split ? hosts.api : `${location.protocol}//${location.host}`;
  return `${origin.replace(/^http/, 'ws')}${CONFIG.wsPath}${query}`;
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

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : citoyen/js/app.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { api } from '../../shared/js/api.js';
import { demo } from '../../shared/js/config.js';
import { ago, esc, time } from '../../shared/js/format.js';
import { icon } from '../../shared/js/icons.js';
import { createSaver, loadSnapshot } from '../../shared/js/offline.js';
import { registerServiceWorker } from '../../shared/js/platform.js';
import { connectLive } from '../../shared/js/realtime.js';
import { createStore } from '../../shared/js/store.js';
import { citizenAlertFor } from './notifications.js';
import { loadPrefs } from './preferences.js';
import { brand } from './ui.js';
import { mountAlerts, nearbyAlerts } from './views/alerts.js';
import { mountDetail } from './views/detail.js';
import { mountFavorites } from './views/favorites.js';
import { mountMap } from './views/map.js';
import { renderOnboarding } from './views/onboarding.js';
import { mountSettings } from './views/settings.js';

/**
 * Point d'entrée de la PWA Citoyen : consultation publique, sans compte.
 * Données : GET /api/stations puis flux WSS /ws/live sans jeton (snapshot, « station »,
 * « measurement »). Les préférences (position, rayon, favoris) restent sur l'appareil.
 * Routage par hash : #map, #alerts, #favorites, #settings, #station/<code>.
 */

/** Clé IndexedDB de l'état des stations mémorisé pour la consultation hors connexion. */
const SNAPSHOT_KEY = 'citoyen:stations';

const root = document.getElementById('app');
const store = createStore();

/** Onglets (navigation du haut sur grand écran, du bas sur mobile). */
const TABS = [
  { id: 'map', label: 'Carte', icon: 'Map', mount: mountMap },
  { id: 'alerts', label: 'Alertes', icon: 'Bell', mount: mountAlerts },
  { id: 'favorites', label: 'Favoris', icon: 'Heart', mount: mountFavorites },
  { id: 'settings', label: 'Paramètres', icon: 'Settings', mount: mountSettings },
];

let shell = null;
let unmount = null;
let lastTab = 'map';
let noticeTimer = null;
let pushTimer = null;

/** Contexte transmis aux vues. */
const ctx = {
  store,
  /** @returns {import('./preferences.js').CitizenPrefs} préférences courantes */
  get prefs() {
    return loadPrefs();
  },
  /** @returns {string} onglet d'où l'on vient (retour depuis la fiche) */
  get lastTab() {
    return lastTab;
  },
  /**
   * Ouvre la fiche d'une station.
   * @param {string} code code de la station
   */
  openStation(code) {
    location.hash = `#station/${encodeURIComponent(code)}`;
  },
  /**
   * Change d'onglet.
   * @param {string} tab identifiant de l'onglet
   */
  goTab(tab) {
    location.hash = `#${tab}`;
  },
  /**
   * Affiche un message éphémère (composant c-notice de la maquette).
   * @param {string} text message
   */
  notice(text) {
    const box = root.querySelector('[data-notice]');
    if (!box) return;
    box.innerHTML = `<div class="c-notice" role="status">${icon('Info', 19)}<span>${esc(text)}</span>
      <button type="button" aria-label="Fermer le message" data-notice-close>${icon('X', 16)}</button></div>`;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { box.innerHTML = ''; }, 4000);
  },
  /** Met à jour le compteur d'alertes des onglets. */
  updateBadges() {
    const n = nearbyAlerts(store, loadPrefs()).length;
    root.querySelectorAll('[data-alert-count]').forEach((b) => {
      b.textContent = n;
      b.hidden = n === 0;
    });
  },
  /**
   * Met à jour les durées relatives (« il y a 12 s »).
   * @param {ParentNode} [scope=document] zone concernée
   */
  refreshAgo(scope = document) {
    scope.querySelectorAll('[data-ago]').forEach((el) => { el.textContent = ago(el.dataset.ago || null); });
  },
};

// ============================================================================= coquille
/** Construit l'en-tête, la zone de contenu et la navigation du bas. */
function renderShell() {
  const tabButton = (t, bottom) => `<button type="button" data-tab="${t.id}">
    ${bottom ? `<span class="c-tab-icon">${icon(t.icon, 22)}${t.id === 'alerts' ? '<b data-alert-count hidden></b>' : ''}</span><span>${t.label}</span><i></i>`
    : `${icon(t.icon, 17)}<span>${t.label}</span>${t.id === 'alerts' ? '<b data-alert-count hidden></b>' : ''}`}</button>`;
  root.innerHTML = `<div class="citizen-shell" data-shell>
    <header class="c-header">
      <div class="c-header-brand-wrap">${brand()}<span class="c-app-name">CITOYEN</span></div>
      <nav class="c-header-nav" aria-label="Navigation principale">${TABS.map((t) => tabButton(t, false)).join('')}</nav>
      <div class="c-header-actions"><a class="c-header-switch" href="/pilotage/" title="Espace réservé aux opérateurs">
        ${icon('LayoutGrid', 18)}<span class="c-header-switch-text">Espace opérateurs</span></a></div>
    </header>
    ${demo.active ? `<div class="c-demo-banner" role="status">${icon('Info', 15)}<span>Mode démonstration : données simulées dans le navigateur.</span>
      ${demo.forced ? '' : '<a href="?demo=0">Quitter</a>'}</div>` : ''}
    <div class="c-offline-banner" data-live-banner role="status" hidden></div>
    <div class="c-content" data-content></div>
    <nav class="c-bottom-nav" aria-label="Navigation citoyenne">${TABS.map((t) => tabButton(t, true)).join('')}</nav>
    <div data-push></div><div data-notice></div>
  </div>`;
  shell = { content: root.querySelector('[data-content]') };
  root.addEventListener('click', (e) => {
    const tabLink = e.target.closest('[data-tab]');
    if (tabLink) ctx.goTab(tabLink.dataset.tab);
    if (e.target.closest('[data-notice-close]')) root.querySelector('[data-notice]').innerHTML = '';
    if (e.target.closest('[data-push-close]')) closePush();
    const open = e.target.closest('[data-open]');
    if (open) {
      closePush();
      ctx.openStation(open.dataset.open);
    }
  });
}

/** Signale une coupure du flux temps réel (les données affichées peuvent dater). */
function renderLive() {
  const banner = root.querySelector('[data-live-banner]');
  if (!banner) return;
  const { live, cachedAt, lastUpdate } = store.state;
  const down = !!cachedAt || live === 'reconnecting' || live === 'closed' || !navigator.onLine;
  banner.hidden = !down;
  // Texte de la maquette : « Hors connexion – dernières données du jj/mm à hh:mm » (données mémorisées).
  const since = cachedAt ?? lastUpdate;
  const day = since ? new Date(since).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Africa/Tunis' }) : null;
  banner.innerHTML = down ? `${icon('WifiOff', 17)}<span><strong>${navigator.onLine ? 'Reconnexion…' : 'Hors connexion'}</strong>
    – ${since ? `dernières données du ${day} à ${time(since)}${cachedAt ? ' · Données mémorisées' : ` (${esc(ago(since))})`}` : 'aucune donnée reçue pour le moment'}</span>` : '';
  root.querySelector('[data-shell]')?.classList.toggle('is-offline', down);
}

// ============================================================================= alertes en direct (repli du Web Push)
/** Ferme le bandeau d'alerte. */
function closePush() {
  clearTimeout(pushTimer);
  const box = root.querySelector('[data-push]');
  if (box) box.innerHTML = '';
}

/**
 * Bandeau d'alerte de la maquette (c-push-banner), affiché quand une station du rayon passe en
 * orange ou rouge, ou sort du rouge. Même règle que les notifications push du serveur.
 * @param {{kind: string, station: object}} alert alerte détectée
 */
function showPush({ kind, station }) {
  const box = root.querySelector('[data-push]');
  if (!box || document.hidden) return; // en arrière-plan, la notification Web Push prend le relais
  const css = kind === 'end' ? 'green' : kind;
  const title = kind === 'red' ? `${station.name} fermée` : kind === 'orange' ? `${station.name} : alerte orange` : `${station.name} : fin d’alerte`;
  const text = kind === 'red' ? 'Ne vous engagez pas. Consultez la situation.'
    : kind === 'orange' ? 'La situation évolue. Consultez les dernières informations.' : 'Le niveau est redescendu. Passage à nouveau praticable avec prudence.';
  box.innerHTML = `<div class="c-push-banner ${css}" role="alert"><span class="c-push-icon">${icon('BellRing', 21)}</span>
    <button type="button" data-open="${esc(station.code)}"><span>FLOODWATCH · À L’INSTANT</span><strong>${esc(title)}</strong><small>${esc(text)}</small></button>
    <button type="button" class="c-push-close" aria-label="Fermer l’alerte" data-push-close>${icon('X', 17)}</button></div>`;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(closePush, kind === 'red' ? 15_000 : 8500);
}

/**
 * Applique un message du flux et détecte les changements à signaler au citoyen.
 * @param {{type: string, data: *}} message message du WebSocket
 */
function onLive(message) {
  const before = message.type === 'station' ? store.state.stations.get(message.data.code) : null;
  store.applyLive(message);
  if (message.type === 'station') {
    const alert = citizenAlertFor(before, message.data);
    if (alert) showPush(alert);
  }
}

// ============================================================================= routage
/** Affiche la vue correspondant à l'URL. */
function route() {
  if (!shell) return;
  const [id, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const code = id === 'station' && rest.length ? decodeURIComponent(rest.join('/')) : null;
  const tab = TABS.find((t) => t.id === id) ?? (code ? null : TABS[0]);
  unmount?.();
  unmount = null;
  // Conteneur neuf à chaque vue : les écouteurs posés par la vue précédente disparaissent avec lui.
  const fresh = shell.content.cloneNode(false);
  shell.content.replaceWith(fresh);
  shell.content = fresh;
  const isMap = tab?.id === 'map';
  shell.content.className = `c-content ${isMap ? 'is-map' : ''}`;
  if (tab) lastTab = tab.id;
  root.querySelectorAll('[data-tab]').forEach((a) => {
    const active = a.dataset.tab === (tab?.id ?? lastTab);
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  unmount = code ? mountDetail(shell.content, ctx, code) : tab.mount(shell.content, ctx);
  document.title = code ? `${store.state.stations.get(code)?.name ?? 'Station'} · FloodWatch Citoyen` : `${tab.label} · FloodWatch Citoyen`;
  shell.content.scrollTop = 0;
  ctx.updateBadges();
  ctx.refreshAgo(shell.content);
}

// ============================================================================= démarrage
/** Démarre l'application (après le parcours d'accueil si nécessaire). */
async function start() {
  renderShell();
  shell.content.innerHTML = `<div class="c-loading" role="status">${icon('Waves', 28)}<p>Chargement de l’état des routes…</p></div>`;
  try {
    store.setStations(await api('/stations'));
  } catch (e) {
    // hors connexion : dernier état connu, mémorisé dans IndexedDB
    const cached = await loadSnapshot(SNAPSHOT_KEY);
    if (cached?.value) {
      store.setStations(cached.value);
      store.setCachedAt(cached.savedAt);
    } else {
      ctx.notice(`${e.message} Nouvelle tentative automatique.`);
    }
  }
  // Mémorisation de l'état reçu (au plus une écriture toutes les 5 s), jamais celle d'un état déjà mémorisé.
  const saver = createSaver(SNAPSHOT_KEY, () => [...store.state.stations.values()]);
  store.subscribe('stations', () => { if (!store.state.cachedAt) saver.schedule(); });
  if (!store.state.cachedAt && store.state.stations.size) saver.schedule();
  connectLive({ onMessage: onLive, onState: store.setLive });
  store.subscribe('live', renderLive);
  store.subscribe('cache', renderLive);
  store.subscribe('stations', () => ctx.updateBadges());
  // les vues (ex. interrupteur des notifications) réévaluent aussi l'état du réseau
  for (const type of ['online', 'offline']) window.addEventListener(type, () => { renderLive(); store.emit('live', store.state.live); });
  window.addEventListener('hashchange', route);
  setInterval(() => { ctx.refreshAgo(shell.content); renderLive(); }, 5000);
  route();
}

registerServiceWorker('sw.js');
if (loadPrefs().onboarded) start();
else renderOnboarding(root, start);

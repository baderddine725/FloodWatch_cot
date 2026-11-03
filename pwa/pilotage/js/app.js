/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : pilotage/js/app.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { api } from '../../shared/js/api.js';
import { logout, onUnauthorized, refreshProfile, session } from '../../shared/js/auth.js';
import { ALERT_TYPES, ago } from '../../shared/js/format.js';
import { clearSnapshots, createSaver, loadSnapshot } from '../../shared/js/offline.js';
import { localNotify, pushEnabled } from '../../shared/js/push.js';
import { registerServiceWorker } from '../../shared/js/platform.js';
import { connectLive } from '../../shared/js/realtime.js';
import { createStore } from '../../shared/js/store.js';
import { closeToast, toast } from '../../shared/js/components/toast.js';
import { createShell, renderSkeleton } from './shell.js';
import { mountAlerts } from './views/alerts.js';
import { mountDashboard } from './views/dashboard.js';
import { mountHistory } from './views/history.js';
import { renderLogin } from './views/login.js';
import { mountStation } from './views/station.js';
import { mountStations } from './views/stations.js';
import { mountUsers } from './views/users.js';

/**
 * Point d'entrée de la PWA Pilotage (opérateurs et administrateurs).
 * Démarrage : jeton mémorisé → GET /api/auth/me (validité et rôles) → chargement REST des
 * stations et des alertes → flux WSS /ws/live?token= (alertes et commandes en plus) → routage.
 * Une réponse 401 ou l'échéance du jeton ramènent à l'écran de connexion.
 * Hors connexion : profil mémorisé et dernières données (IndexedDB) affichés avec le bandeau
 * « Données mémorisées » ; tout est rechargé dès le retour du flux temps réel.
 */

/** Clés IndexedDB de la PWA Pilotage (effacées à la déconnexion : poste potentiellement partagé). */
const SNAPSHOT_PREFIX = 'pilotage:';
const SNAPSHOT_KEYS = { stations: 'pilotage:stations', alerts: 'pilotage:alerts', points: 'pilotage:points' };
/** Points de mesure conservés hors connexion par station (30 dernières minutes). */
const POINTS_KEEP_MS = 30 * 60_000;

const root = document.getElementById('app');
const store = createStore();

/** Pages de l'application : entrée de menu, rôle requis et fonction d'affichage. */
const PAGES = [
  { id: 'dashboard', label: 'Tableau de bord', icon: 'LayoutDashboard', mount: mountDashboard },
  { id: 'alerts', label: 'Alertes', icon: 'Bell', mount: mountAlerts },
  { id: 'history', label: 'Historique', icon: 'History', mount: mountHistory },
  { id: 'stations', label: 'Stations', icon: 'Radio', mount: mountStations, admin: true },
  { id: 'users', label: 'Utilisateurs', icon: 'Users', mount: mountUsers, admin: true },
];

/** Session en cours : coquille, flux temps réel, page affichée et minuteries. */
let current = null;

/** Contexte transmis aux pages. */
const ctx = {
  store,
  /**
   * Change de page.
   * @param {string} page identifiant de la page
   */
  navigate(page) {
    location.hash = `#${page}`;
  },
  /**
   * Ouvre la fiche d'une station.
   * @param {string} code code de la station
   */
  openStation(code) {
    location.hash = `#station/${encodeURIComponent(code)}`;
  },
  /**
   * Les actions (commandes, acquittements) exigent le réseau et le flux temps réel, par lequel
   * arrive le résultat des commandes.
   * @returns {boolean} vrai si les actions sont possibles
   */
  canAct() {
    return navigator.onLine && store.state.live === 'open';
  },
  /**
   * Met à jour les durées relatives (« il y a 12 s ») d'une partie de la page.
   * @param {ParentNode} [scope=document] zone à mettre à jour
   */
  refreshAgo(scope = document) {
    scope.querySelectorAll('[data-ago]').forEach((el) => { el.textContent = ago(el.dataset.ago || null); });
  },
  /** Ferme la session, efface les données mémorisées sur ce poste et revient à l'écran de connexion. */
  logout() {
    endSession();
    logout();
    clearSnapshots(SNAPSHOT_PREFIX);
    showLogin();
  },
};

// ============================================================================= routage
/**
 * Lit la page demandée dans l'URL (#dashboard, #alerts, #station/<code>).
 * @returns {{page: object|null, id: string, param: string|null}} page à afficher
 */
function parseHash() {
  const [id, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const param = rest.length ? decodeURIComponent(rest.join('/')) : null;
  if (id === 'station' && param) return { page: { id: 'station', label: 'Détail de la station', mount: mountStation }, id, param };
  const page = PAGES.find((p) => p.id === id && (!p.admin || session.isAdmin));
  return { page: page ?? PAGES[0], id: page ? id : 'dashboard', param };
}

/** Affiche la page correspondant à l'URL (démonte la précédente). */
function route() {
  if (!current) return;
  const { page, param } = parseHash();
  current.unmount?.();
  current.unmount = null;
  closeToast();
  // Conteneur neuf à chaque page : les écouteurs posés par la page précédente disparaissent avec lui.
  const old = current.shell.main;
  const main = old.cloneNode(false);
  old.replaceWith(main);
  current.shell.main = main;
  // la fiche station est rattachée au tableau de bord dans le menu, comme dans la maquette
  current.shell.setActive(page.id === 'station' ? 'dashboard' : page.id, page.label);
  current.unmount = page.mount(main, ctx, param);
  ctx.refreshAgo(main);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);

// Perte ou retour du réseau : les écrans réévaluent tout de suite la disponibilité des commandes
// (sans attendre que le WebSocket constate la coupure).
for (const type of ['online', 'offline']) window.addEventListener(type, () => store.emit('live', store.state.live));

// Liens « Voir la station » présents dans plusieurs composants (carte, recherche, bandeau, tableaux).
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-open-station]');
  if (link && current) ctx.openStation(link.dataset.openStation);
});

// ============================================================================= alertes en direct
/**
 * Signale une nouvelle alerte dans la page (et en notification locale si l'onglet est en arrière-plan
 * et que le Web Push n'est pas actif sur cet appareil : repli décrit dans le cahier des charges).
 * @param {object|null} alert AlertDto reçu (null = rechargement de liste)
 */
async function announceAlert(alert) {
  if (!alert || !alert.active || alert.acknowledgedAt) return;
  if (Date.now() - Date.parse(alert.raisedAt) > 60_000) return; // pas une nouvelle alerte
  const known = current?.announced;
  if (!known || known.has(alert.id)) return;
  known.add(alert.id);
  const title = `${ALERT_TYPES[alert.type] ?? alert.type} : ${alert.stationName}`;
  const urgent = alert.level === 'RED';
  toast(`${title}. ${alert.message ?? ''}`, { kind: urgent ? 'urgent' : 'info', title: urgent ? 'Nouvel événement critique' : 'Nouvelle alerte', duration: urgent ? 0 : 6000 });
  if (document.hidden && !(await pushEnabled())) {
    localNotify(`FloodWatch – ${title}`, alert.message ?? '', { tag: `fw-${alert.stationCode}`, url: `./#station/${encodeURIComponent(alert.stationCode)}`, urgent });
  }
}

// ============================================================================= session
/** Arrête tout ce qui dépend de la session courante (flux, minuteries, page, coquille). */
function endSession() {
  if (!current) return;
  current.unmount?.();
  current.live?.close();
  current.cleanups.forEach((fn) => fn());
  current.shell?.destroy();
  current = null;
  store.reset();
  closeToast();
}

/**
 * Affiche l'écran de connexion.
 * @param {string|null} [notice] message (ex. session expirée)
 */
function showLogin(notice = null) {
  renderLogin(root, { notice, onLogin: () => startSession() });
}

/** Session expirée (401 de l'API ou échéance du jeton) : retour à l'écran de connexion. */
function expire() {
  if (!current) return;
  endSession();
  logout();
  clearSnapshots(SNAPSHOT_PREFIX);
  showLogin('Votre session a expiré. Reconnectez-vous pour reprendre la supervision.');
}

/** Ouvre une session : profil, données initiales, coquille, flux temps réel, page demandée. */
async function startSession() {
  if (!session.token || session.expired) {
    logout();
    showLogin();
    return;
  }
  renderSkeleton(root);
  let offline = false;
  try {
    const user = await refreshProfile();
    if (!user.roles?.some((r) => r === 'OPERATOR' || r === 'ADMIN')) {
      logout();
      showLogin('Ce compte n’a pas accès à l’espace de pilotage.');
      return;
    }
    await loadFromApi();
  } catch (e) {
    if (e.status === 401) {
      logout();
      showLogin('Votre session a expiré. Reconnectez-vous pour reprendre la supervision.');
      return;
    }
    // serveur injoignable : profil mémorisé et dernières données connues ; le flux temps réel réessaiera
    offline = !(await loadFromCache());
    if (offline) toast(`Chargement impossible : ${e.message}`, { kind: 'error', duration: 0 });
  }

  current = { cleanups: [], announced: new Set(), unmount: null, needsReload: !!store.state.cachedAt || offline };
  current.shell = createShell(root, ctx, PAGES.filter((p) => !p.admin || session.isAdmin));

  current.live = connectLive({
    onMessage: store.applyLive,
    onState: store.setLive,
    // jeton relu à chaque (re)connexion : un jeton échu ouvrirait silencieusement un flux sans alertes
    token: () => (session.expired ? null : session.token),
  });

  // Échéance du jeton (claim exp) vérifiée toutes les 30 s ; les 401 de l'API sont traités par onUnauthorized.
  const expiryTimer = setInterval(() => { if (session.expired) expire(); }, 30_000);
  // Durées relatives (« il y a 12 s ») mises à jour toutes les 5 s sans re-rendu.
  const agoTimer = setInterval(() => ctx.refreshAgo(current?.shell.main), 5000);
  // Mémorisation des dernières données (IndexedDB), au plus une écriture toutes les 5 s par sujet.
  const savers = [
    [createSaver(SNAPSHOT_KEYS.stations, () => [...store.state.stations.values()]), 'stations'],
    [createSaver(SNAPSHOT_KEYS.alerts, () => store.state.alerts.slice(0, 300)), 'alerts'],
    [createSaver(SNAPSHOT_KEYS.points, recentPoints, 15_000), 'measurement'],
  ];
  for (const [saver, topic] of savers) {
    current.cleanups.push(store.subscribe(topic, () => { if (!store.state.cachedAt) saver.schedule(); }), () => saver.cancel());
  }
  if (!store.state.cachedAt) savers.forEach(([saver]) => saver.schedule());

  current.cleanups.push(
    () => clearInterval(expiryTimer),
    () => clearInterval(agoTimer),
    store.subscribe('alerts', announceAlert),
    store.subscribe('live', reloadAfterReconnect),
    onUnauthorized(expire),
  );
  route();
}

/**
 * Charge stations et alertes depuis l'API.
 * @returns {Promise<void>}
 * @throws {import('../../shared/js/api.js').ApiError} si le serveur est injoignable ou refuse
 */
async function loadFromApi() {
  const [stations, alerts] = await Promise.all([api('/stations'), api('/alerts?limit=300')]);
  store.setStations(stations);
  store.setAlerts(alerts);
  store.setCachedAt(null);
}

/**
 * Affiche les dernières données mémorisées (mode hors connexion).
 * @returns {Promise<boolean>} vrai si des données ont été trouvées
 */
async function loadFromCache() {
  const [stations, alerts, points] = await Promise.all(Object.values(SNAPSHOT_KEYS).map((k) => loadSnapshot(k)));
  if (!stations) {
    store.setStations([]);
    store.setAlerts([]);
    return false;
  }
  store.setStations(stations.value ?? []);
  store.setAlerts(alerts?.value ?? []);
  for (const [code, list] of Object.entries(points?.value ?? {})) store.setPoints(code, list);
  store.setCachedAt(stations.savedAt);
  return true;
}

/**
 * Points récents de chaque station à mémoriser (30 dernières minutes, pour les courbes hors connexion).
 * @returns {Object<string, object[]>} points par code de station
 */
function recentPoints() {
  const since = Date.now() - POINTS_KEEP_MS;
  return Object.fromEntries([...store.state.points].map(([code, list]) => [code, list.filter((m) => Date.parse(m.ts) >= since)]));
}

/**
 * Au retour du flux temps réel après un démarrage hors connexion, recharge les alertes et le
 * profil (le snapshot WebSocket a déjà remplacé les stations).
 * @param {string} live état de la connexion temps réel
 */
async function reloadAfterReconnect(live) {
  if (live !== 'open' || !current?.needsReload) return;
  current.needsReload = false;
  try {
    await refreshProfile();
    store.setAlerts(await api('/alerts?limit=300'));
    // courbes : la période passée hors connexion est rechargée (le tableau de bord se redessine toutes les 5 s)
    await Promise.all([...store.state.stations.keys()].map(async (code) => {
      store.setPoints(code, await api(`/stations/${encodeURIComponent(code)}/measurements?minutes=30&limit=2000`).catch(() => []));
    }));
    toast('Connexion rétablie : données à jour.');
  } catch (e) {
    if (current) current.needsReload = e.status !== 401;
  }
}

// ============================================================================= démarrage
registerServiceWorker('sw.js');
startSession();

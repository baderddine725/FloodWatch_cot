/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : pilotage/sw.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-03
 *  Version   : 2.0
 * ============================================================================
 *  Service Worker de la PWA Pilotage (portée /pilotage/) :
 *   - met en cache l'enveloppe de l'application (HTML, CSS, JS, polices, icônes, Leaflet) ;
 *   - ne met JAMAIS en cache /api/ ni /ws/ (données temps réel et authentifiées) : les dernières
 *     données sont mémorisées par l'application dans IndexedDB (shared/js/offline.js) ;
 *   - tuiles OpenStreetMap en cache (nombre limité) pour garder un fond de carte hors connexion ;
 *   - notifications Web Push : « push » → showNotification, « notificationclick » → fiche station.
 *  Nginx sert ce fichier avec Cache-Control: no-cache : changer VERSION publie une mise à jour.
 * ============================================================================
 */
const VERSION = 'fw-pilotage-v2.0.0';
const TILES = 'fw-tiles-v1';
const MAX_TILES = 400;

/** Enveloppe de l'application (chemins relatifs à la portée /pilotage/). */
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/pilotage.css',
  'js/app.js', 'js/shell.js', 'js/ui.js', 'js/commands.js', 'js/station-form.js',
  'js/views/login.js', 'js/views/dashboard.js', 'js/views/alerts.js', 'js/views/station.js',
  'js/views/history.js', 'js/views/stations.js', 'js/views/users.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
  '../shared/css/base.css', '../shared/css/charte.css',
  '../shared/js/api.js', '../shared/js/auth.js', '../shared/js/config.js', '../shared/js/format.js',
  '../shared/js/icons.js', '../shared/js/offline.js', '../shared/js/platform.js', '../shared/js/prefs.js',
  '../shared/js/push.js', '../shared/js/realtime.js', '../shared/js/store.js', '../shared/js/demo.js',
  '../shared/js/components/badge.js', '../shared/js/components/chart.js', '../shared/js/components/map.js',
  '../shared/js/components/modal.js', '../shared/js/components/toast.js',
  '../shared/vendor/leaflet/leaflet.css', '../shared/vendor/leaflet/leaflet.js',
  '../shared/vendor/fonts/inter-latin-wght-normal.woff2',
];

/**
 * Installation : précache de l'enveloppe. Un fichier manquant n'empêche pas l'installation
 * (il sera mis en cache à sa première utilisation).
 */
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION)
    .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })))))
    .then(() => self.skipWaiting()));
});

/** Activation : suppression des anciennes versions du cache de cette PWA. */
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fw-pilotage-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/**
 * Indique si une requête vise les données (jamais mises en cache).
 * @param {URL} url adresse demandée
 * @returns {boolean} vrai pour /api/ et /ws/
 */
function isData(url) {
  return url.origin === self.location.origin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/'));
}

/**
 * Limite la taille du cache des tuiles (les plus anciennes sont retirées).
 * @param {Cache} cache cache des tuiles
 */
async function trimTiles(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_TILES)).map((k) => cache.delete(k)));
}

/**
 * Tuiles OpenStreetMap : cache d'abord, réseau sinon.
 * @param {Request} request requête de tuile
 * @returns {Promise<Response>} tuile
 */
async function tile(request) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
      await cache.put(request, response.clone());
      trimTiles(cache);
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Tuile indisponible hors connexion' });
  }
}

/** Au-delà de ce délai sans réponse du réseau, la copie en cache est servie (réseau lent ou coupé). */
const NETWORK_TIMEOUT_MS = 3000;

/**
 * Enveloppe : réseau d'abord (un « git pull » sur le serveur est visible immédiatement, sans
 * changer VERSION), copie en cache si le réseau est coupé ou trop lent. Les navigations hors
 * connexion retombent sur index.html (routage par hash).
 * @param {FetchEvent} event événement fetch
 * @returns {Promise<Response>} réponse
 */
async function shell(event) {
  const { request } = event;
  const cache = await caches.open(VERSION);
  const cached = () => cache.match(request, { ignoreSearch: request.mode === 'navigate' })
    .then((hit) => hit ?? (request.mode === 'navigate' ? cache.match('index.html') : undefined));
  const network = fetch(request).then((response) => {
    if (response.ok) event.waitUntil(cache.put(request, response.clone()));
    return response;
  });
  const timeout = new Promise((resolve) => { setTimeout(resolve, NETWORK_TIMEOUT_MS); });
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    return (await cached()) ?? (await network); // réseau lent : copie locale si elle existe
  } catch {
    return (await cached()) ?? Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (isData(url)) return; // laissé au réseau, jamais mis en cache
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(tile(request));
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(shell(event));
});

// ----------------------------------------------------------------------------- Web Push
/**
 * Réception d'une notification (charge utile JSON de PushManager côté serveur :
 * {title, body, tag, level, station, url}).
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'FloodWatch', body: event.data?.text() ?? '' };
  }
  const red = data.level === 'RED';
  // Le champ « url » du serveur vaut « / » (PWA Citoyen) : la Pilotage ouvre plutôt la fiche de la station.
  const target = data.station ? `./#station/${encodeURIComponent(data.station)}` : './#alerts';
  event.waitUntil(self.registration.showNotification(data.title || 'FloodWatch Pilotage', {
    body: data.body || '',
    tag: data.tag || 'fw-pilotage',
    renotify: true,
    requireInteraction: red,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    vibrate: red ? [300, 100, 300, 100, 300] : [200],
    timestamp: Date.now(),
    data: { url: target },
  }));
});

/** Clic sur une notification : la fenêtre ouverte de la PWA est réutilisée, sinon une nouvelle s'ouvre. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find((w) => w.url.startsWith(self.registration.scope));
    if (client) {
      await client.focus();
      return client.navigate(target).catch(() => null);
    }
    return self.clients.openWindow(target);
  })());
});

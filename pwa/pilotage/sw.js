/* =============================================================================
   FloodWatch – Service Worker de la PWA Pilotage : mise en cache de l'application,
   notifications Web Push des alertes opérateur.
   Équipe FloodWatch – Auteur : Kamoun Ahmed – v1.0 – 2026-11-02
   ============================================================================= */
const VERSION = 'fw-pilotage-v1.0.0';
const SHELL = [
  './', 'index.html', 'app.js', 'app.css', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png',
  '../shared/fw.js', '../shared/fw.css', '../shared/demo.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fw-pilotage-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return; // données toujours fraîches (réseau)
  if (url.hostname.endsWith('tile.openstreetmap.org')) {  // tuiles : cache d'abord
    e.respondWith(caches.open('fw-tiles').then((c) => c.match(req).then((hit) => hit || fetch(req).then((r) => { c.put(req, r.clone()); return r; }))));
    return;
  }
  // application : cache puis mise à jour en arrière-plan (stale-while-revalidate)
  e.respondWith(caches.open(VERSION).then((c) => c.match(req).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  })));
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'FloodWatch', body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'FloodWatch', {
    body: data.body || '', tag: data.tag || 'floodwatch', renotify: true,
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    requireInteraction: data.level === 'RED', vibrate: data.level === 'RED' ? [300, 100, 300, 100, 300] : [200],
    data: { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    const w = wins.find((c) => c.url.startsWith(self.registration.scope));
    return w ? w.focus() : self.clients.openWindow(target);
  }));
});

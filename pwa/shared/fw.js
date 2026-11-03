/* =============================================================================
   FloodWatch – couche commune des PWA : API REST, flux temps réel (WebSocket),
   notifications Web Push, mode démonstration et utilitaires d'affichage.
   Équipe FloodWatch – Auteur : Kamoun Ahmed – v1.0 – 2026-11-02
   ============================================================================= */
import { DemoBackend } from './demo.js';

/** Niveaux d'alerte (Table 1 du cahier des charges). */
export const LEVELS = {
  GREEN: { label: 'Vert', color: '#1f9d55', citizen: 'Praticable' },
  YELLOW: { label: 'Jaune', color: '#c99a06', citizen: 'Surveillance renforcée' },
  ORANGE: { label: 'Orange', color: '#e0680b', citizen: 'Prudence : montée des eaux' },
  RED: { label: 'Rouge', color: '#d0263a', citizen: 'FERMÉ – ne pas s’engager' },
};
export const TYPES = { UNDERPASS: 'Passage souterrain', WADI: 'Oued / gué', LOW_ROAD: 'Route en contrebas', FORD: 'Gué', OTHER: 'Point critique' };

/** Stockage local tolérant aux erreurs (navigation privée, iframe...) avec repli en mémoire. */
const memory = new Map();
export const store = {
  get(k) {
    try { const v = localStorage.getItem(k); if (v != null) return v; } catch { /* stockage indisponible */ }
    return memory.has(k) ? memory.get(k) : null;
  },
  set(k, v) {
    if (v == null) memory.delete(k); else memory.set(k, String(v));
    try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignoré */ }
  },
};

const params = new URLSearchParams(location.search);
if (params.has('demo')) store.set('fw.demo', params.get('demo') === '0' ? null : '1');
/** Mode démonstration : backend simulé dans le navigateur (aucun serveur requis).
 *  window.FW_DEMO = true force ce mode (page de démonstration hébergée). */
export const demo = { forced: window.FW_DEMO === true, active: window.FW_DEMO === true || store.get('fw.demo') === '1' };
if (demo.active) demo.backend = new DemoBackend();
export function setDemo(on) { store.set('fw.demo', on ? '1' : null); location.reload(); }

/** Session de l'opérateur (jeton JWT). */
export const auth = {
  get token() { return store.get('fw.token'); },
  get user() { try { return JSON.parse(store.get('fw.user') || 'null'); } catch { return null; } },
  hasRole(r) { return !!this.user?.roles?.includes(r); },
  save(resp) { store.set('fw.token', resp.token); store.set('fw.user', JSON.stringify(resp.user)); },
  clear() { store.set('fw.token', null); store.set('fw.user', null); },
};

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Appel REST JSON vers /api (même origine, derrière Nginx). */
export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  if (demo.active) return demo.backend.request(path, { method, body, token: auth.token });
  const h = { Accept: 'application/json', ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (auth.token) h.Authorization = `Bearer ${auth.token}`;
  let r;
  try {
    r = await fetch(`/api${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'Serveur injoignable');
  }
  if (r.status === 204) return null;
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 401 && auth.token) { auth.clear(); window.dispatchEvent(new Event('fw:unauthorized')); }
    throw new ApiError(r.status, data?.error || r.statusText || `Erreur ${r.status}`);
  }
  return data;
}

/** Flux temps réel avec reconnexion exponentielle. @return fonction de fermeture */
export function connectLive(onMessage, onStatus) {
  if (demo.active) return demo.backend.subscribe(onMessage, onStatus, auth.token);
  let ws; let closed = false; let delay = 1000; let timer;
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = auth.token ? `?token=${encodeURIComponent(auth.token)}` : '';
    ws = new WebSocket(`${proto}://${location.host}/ws/live${q}`);
    ws.onopen = () => { delay = 1000; onStatus?.(true); };
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* message ignoré */ } };
    ws.onclose = () => {
      onStatus?.(false);
      if (!closed) { timer = setTimeout(open, delay); delay = Math.min(delay * 2, 30000); }
    };
    ws.onerror = () => ws.close();
  };
  open();
  return () => { closed = true; clearTimeout(timer); ws?.close(); };
}

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Abonnement Web Push (citoyen : géolocalisé ; opérateur : jeton requis). */
export async function subscribePush({ latitude, longitude, radiusKm } = {}) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('Notifications push non prises en charge par ce navigateur (sur iPhone : installez d’abord l’application).');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Autorisation de notification refusée.');
  const reg = await navigator.serviceWorker.ready;
  if (demo.active) {
    await reg.showNotification('FloodWatch (démo)', { body: 'Notifications activées. Les alertes simulées s’afficheront ici.', icon: 'icons/icon-192.png' });
    return { audience: auth.token ? 'OPERATOR' : 'CITIZEN', radiusKm };
  }
  const { publicKey } = await api('/push/public-key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  return api('/push/subscriptions', { method: 'POST', body: { subscription: sub.toJSON(), latitude, longitude, radiusKm } });
}

export async function unsubscribePush() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager?.getSubscription();
  if (!sub) return;
  if (!demo.active) await api(`/push/subscriptions?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' }).catch(() => {});
  await sub.unsubscribe();
}

export async function pushEnabled() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager?.getSubscription());
}

/** Géolocalisation sous forme de promesse. */
export function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Géolocalisation indisponible')); return; }
    navigator.geolocation.getCurrentPosition((p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => reject(new Error('Position refusée ou indisponible')), { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });
}

// ----------------------------------------------------------------------------- affichage
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = (v, d = 1) => (v == null || Number.isNaN(v) ? '–' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d }));
export function time(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function dateTime(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function ago(iso) {
  if (!iso) return 'jamais';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  return `il y a ${Math.round(s / 3600)} h`;
}
export function ttfText(m) {
  if (m == null) return null;
  if (m < 1) return 'débordement imminent';
  return `débordement estimé dans ${Math.round(m)} min`;
}
export function levelChip(level, label) {
  const l = LEVELS[level] ? level : 'OFF';
  return `<span class="chip lvl-${l}"><span class="dot"></span>${esc(label ?? LEVELS[level]?.label ?? 'Inconnu')}</span>`;
}

let toastTimer;
export function toast(msg, error = false) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast${error ? ' err' : ''}`;
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3800);
}

/** Logo FloodWatch (goutte + vague) en SVG. */
export const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#fff" fill-opacity=".14"/>
<path d="M16 5c4.5 5.4 7 9.3 7 12.4A7 7 0 0 1 9 17.4C9 14.3 11.5 10.4 16 5z" fill="#fff"/>
<path d="M10.4 19.6c1.4.9 2.5.9 3.9 0s2.5-.9 3.9 0 2.5.9 3.9 0" stroke="#0b4f8a" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`;

/**
 * Courbe temporelle sur canvas (sans dépendance) : niveau d'eau, seuils et pluie.
 * @param {HTMLCanvasElement} canvas
 * @param {{ts:string, levelCm:number, rain:number}[]} points
 * @param {{criticalCm:number, yellowPct:number, orangePct:number, redPct:number}} t
 */
export function drawLevelChart(canvas, points, t) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth; const h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 40, r: 12, t: 12, b: 24 };
  const maxY = Math.max(t.criticalCm * 1.1, ...points.map((p) => p.levelCm)) || 1;
  const now = Date.now();
  const t0 = points.length ? Math.min(new Date(points[0].ts).getTime(), now - 60000) : now - 3600000;
  const x = (ts) => pad.l + ((new Date(ts).getTime() - t0) / Math.max(1, now - t0)) * (w - pad.l - pad.r);
  const y = (v) => h - pad.b - (v / maxY) * (h - pad.t - pad.b);
  ctx.font = '11px system-ui, sans-serif';
  // seuils
  [['yellowPct', '#c99a06'], ['orangePct', '#e0680b'], ['redPct', '#d0263a']].forEach(([k, c]) => {
    const yy = y((t[k] / 100) * t.criticalCm);
    ctx.strokeStyle = c; ctx.globalAlpha = 0.55; ctx.setLineDash([4, 4]); ctx.beginPath();
    ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  });
  // axe Y
  ctx.fillStyle = '#7a889b'; ctx.textAlign = 'right';
  for (let v = 0; v <= maxY; v += Math.max(1, Math.round(maxY / 4))) {
    ctx.fillText(`${v}`, pad.l - 6, y(v) + 4);
    ctx.strokeStyle = '#eef2f6'; ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(w - pad.r, y(v)); ctx.stroke();
  }
  ctx.textAlign = 'left'; ctx.fillText('cm', 4, pad.t + 4);
  [[t0, 'left'], [(t0 + now) / 2, 'center'], [now, 'right']].forEach(([tt, al]) => (ctx.textAlign = al) && ctx.fillText(new Date(tt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), x(new Date(tt).toISOString()), h - 6));
  if (!points.length) { ctx.fillText('Aucune mesure sur la période', w / 2, h / 2); return; }
  // pluie (barres)
  ctx.fillStyle = 'rgba(19, 113, 194, .12)';
  points.forEach((p) => { if (p.rain > 0) { const bh = p.rain * (h - pad.t - pad.b) * 0.35; ctx.fillRect(x(p.ts) - 1, h - pad.b - bh, 3, bh); } });
  // niveau (aire + courbe)
  const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
  grad.addColorStop(0, 'rgba(19, 113, 194, .28)'); grad.addColorStop(1, 'rgba(19, 113, 194, .02)');
  ctx.beginPath(); ctx.moveTo(x(points[0].ts), y(0));
  points.forEach((p) => ctx.lineTo(x(p.ts), y(p.levelCm)));
  ctx.lineTo(x(points[points.length - 1].ts), y(0)); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); points.forEach((p, i) => (i ? ctx.lineTo(x(p.ts), y(p.levelCm)) : ctx.moveTo(x(p.ts), y(p.levelCm))));
  ctx.strokeStyle = '#1371c2'; ctx.lineWidth = 2; ctx.stroke();
}

/** Enregistrement du Service Worker. */
export function registerSW(path = 'sw.js') {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(path).catch(() => {});
}

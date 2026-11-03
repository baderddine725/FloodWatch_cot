/* =============================================================================
   FloodWatch – PWA Citoyen : carte des routes praticables/fermées, temps réel,
   notifications push géolocalisées, consultation hors connexion.
   Équipe FloodWatch – Auteur : Kamoun Ahmed – v1.0 – 2026-11-02
   ============================================================================= */
import { api, connectLive, subscribePush, unsubscribePush, pushEnabled, locate, registerSW,
  LEVELS, TYPES, esc, num, ago, ttfText, levelChip, toast, demo, store, LOGO } from './shared/fw.js';

const state = { stations: new Map(), markers: new Map(), map: null, updated: null };
document.getElementById('logo').innerHTML = LOGO;
if (demo.active) document.getElementById('demo-banner').classList.remove('hidden');
if (demo.forced) document.querySelector('#demo-banner a')?.remove();

/** Statut citoyen d'une station : libellé, classe de couleur, praticabilité. */
function status(s) {
  if (!s.online) return { key: 'OFF', label: 'Indisponible', color: '#8592a3', text: 'Station hors ligne : information indisponible, prudence.' };
  if (!s.roadOpen || s.alertLevel === 'RED') return { key: 'RED', label: 'Fermé', color: LEVELS.RED.color, text: LEVELS.RED.citizen };
  const l = LEVELS[s.alertLevel] || LEVELS.GREEN;
  return { key: s.alertLevel, label: s.alertLevel === 'GREEN' ? 'Praticable' : s.alertLevel === 'YELLOW' ? 'Surveillance' : 'Prudence', color: l.color, text: l.citizen };
}

// ----------------------------------------------------------------------------- carte
function initMap() {
  if (!window.L) { document.getElementById('map').innerHTML = '<div class="empty">Carte indisponible hors connexion.</div>'; return; }
  state.map = L.map('map', { zoomControl: true, attributionControl: true }).setView([36.87, 10.18], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; contributeurs OpenStreetMap',
  }).addTo(state.map);
}

function upsertMarker(s) {
  if (!state.map) return;
  const st = status(s);
  const html = `<div class="marker${st.key === 'RED' ? ' pulse' : ''}" style="background:${st.color}"></div>`;
  const icon = L.divIcon({ html, className: '', iconSize: [22, 22], iconAnchor: [11, 11] });
  const popup = `<strong>${esc(s.name)}</strong><br>${levelChip(st.key, st.label)}<br><span class="small">${esc(st.text)}</span>`;
  let m = state.markers.get(s.code);
  if (!m) {
    m = L.marker([s.latitude, s.longitude], { icon, title: s.name }).addTo(state.map).bindPopup(popup);
    state.markers.set(s.code, m);
  } else {
    m.setIcon(icon); m.setLatLng([s.latitude, s.longitude]); m.setPopupContent(popup);
  }
}

function fitMap() {
  if (!state.map || !state.stations.size) return;
  const b = L.latLngBounds([...state.stations.values()].map((s) => [s.latitude, s.longitude]));
  state.map.fitBounds(b.pad(0.35), { maxZoom: 14 });
}

// ----------------------------------------------------------------------------- liste
function render() {
  const list = [...state.stations.values()].sort((a, b) => {
    const r = (s) => ({ RED: 0, OFF: 1, ORANGE: 2, YELLOW: 3, GREEN: 4 }[status(s).key]);
    return r(a) - r(b) || a.name.localeCompare(b.name);
  });
  const closed = list.filter((s) => status(s).key === 'RED').length;
  const hl = document.getElementById('headline');
  hl.style.color = closed ? 'var(--red)' : '';
  hl.textContent = closed
    ? `${closed} passage${closed > 1 ? 's' : ''} fermé${closed > 1 ? 's' : ''}`
    : list.length ? 'Tous les passages surveillés sont ouverts' : 'Aucun point surveillé';
  document.getElementById('subline').textContent = `${list.length} point${list.length > 1 ? 's' : ''} critique${list.length > 1 ? 's' : ''} surveillé${list.length > 1 ? 's' : ''} en temps réel`;
  document.getElementById('list').innerHTML = list.map((s) => {
    const st = status(s);
    const ttf = s.online && s.alertLevel !== 'GREEN' ? ttfText(s.minutesToOverflow) : null;
    const pct = Math.max(0, Math.min(100, s.levelPct ?? 0));
    return `<li class="pt card${st.key === 'RED' ? ' closed' : ''}" data-code="${esc(s.code)}" tabindex="0">
      <div class="stripe" style="background:${st.color}"></div>
      <div class="body">
        <div class="row between"><h2>${esc(s.name)}</h2>${levelChip(st.key, st.label)}</div>
        <div class="meta"><span>${esc(TYPES[s.type] || 'Point critique')}</span>${s.address ? `<span>· ${esc(s.address)}</span>` : ''}</div>
        ${st.key === 'RED' ? `<div class="warn">⛔ ${esc(st.text)}</div>` : `<div class="small">${esc(st.text)}</div>`}
        ${s.online ? `<div class="bar" title="Niveau d'eau : ${num(pct, 0)} % du seuil critique"><i style="width:${pct}%;background:${st.color}"></i></div>` : ''}
        <div class="meta"><span>Niveau ${num(s.levelPct, 0)} %</span>${ttf ? `<span>· ${esc(ttf)}</span>` : ''}<span>· mis à jour ${ago(s.lastSeenAt)}</span></div>
      </div></li>`;
  }).join('') || '<li class="empty">Aucune station.</li>';
  list.forEach(upsertMarker);
  document.getElementById('updated').textContent = state.updated ? `Dernière mise à jour ${ago(state.updated)}` : '';
}

document.getElementById('list').addEventListener('click', (e) => {
  const li = e.target.closest('[data-code]');
  const s = li && state.stations.get(li.dataset.code);
  if (s && state.map) { state.map.setView([s.latitude, s.longitude], 15); state.markers.get(s.code)?.openPopup(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
});

function setStations(arr) {
  arr.forEach((s) => state.stations.set(s.code, s));
  state.updated = new Date().toISOString();
  store.set('fw.citizen.cache', JSON.stringify({ at: state.updated, stations: arr }));
  render();
}

// ----------------------------------------------------------------------------- notifications
async function refreshNotifyState() {
  const on = await pushEnabled();
  const btn = document.getElementById('notify');
  btn.textContent = on ? '🔕 Désactiver les alertes' : '🔔 Recevoir les alertes près de moi';
  btn.dataset.on = on ? '1' : '';
  document.getElementById('notify-state').textContent = on
    ? `Alertes actives dans un rayon de ${store.get('fw.radius') || 5} km autour de votre position.` : '';
}

document.getElementById('notify').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    if (btn.dataset.on) {
      await unsubscribePush();
      toast('Alertes désactivées');
    } else {
      const radiusKm = Number(document.getElementById('radius').value);
      let pos = {};
      try { pos = await locate(); } catch (err) { toast(`${err.message} : alertes pour tous les points.`, true); pos = { latitude: null, longitude: null }; }
      await subscribePush({ ...pos, radiusKm: pos.latitude == null ? 100 : radiusKm });
      store.set('fw.radius', pos.latitude == null ? 100 : radiusKm);
      toast('Alertes activées : vous serez prévenu en cas de fermeture.');
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    refreshNotifyState();
  }
});

// ----------------------------------------------------------------------------- démarrage
function setOnline(on) {
  const live = document.getElementById('live');
  live.classList.toggle('on', on);
  live.textContent = on ? 'En direct' : 'Reconnexion…';
}

async function load() {
  try {
    setStations(await api('/stations'));
    fitMap();
    document.getElementById('offline').classList.add('hidden');
  } catch {
    const cached = JSON.parse(store.get('fw.citizen.cache') || 'null');
    if (cached) {
      cached.stations.forEach((s) => state.stations.set(s.code, s));
      state.updated = cached.at;
      render(); fitMap();
    }
    document.getElementById('offline').classList.remove('hidden');
  }
}

initMap();
registerSW('sw.js');
load().then(() => {
  connectLive((m) => {
    if (m.type === 'snapshot') setStations(m.data);
    else if (m.type === 'station') { state.stations.set(m.data.code, m.data); state.updated = new Date().toISOString(); render(); }
    else if (m.type === 'stationDeleted') { state.stations.delete(m.data.code); state.markers.get(m.data.code)?.remove(); state.markers.delete(m.data.code); render(); }
  }, setOnline);
});
refreshNotifyState();
setInterval(render, 15000); // rafraîchit les « il y a … »
window.addEventListener('online', load);
window.addEventListener('offline', () => document.getElementById('offline').classList.remove('hidden'));

/* =============================================================================
   FloodWatch – PWA Pilotage (back-office) : supervision temps réel, carte, alertes et
   acquittement, commande des actionneurs, configuration des stations, KPI, comptes.
   Équipe FloodWatch – Auteur : Kamoun Ahmed – v1.0 – 2026-11-02
   ============================================================================= */
import { api, auth, connectLive, subscribePush, unsubscribePush, pushEnabled, registerSW, demo,
  LEVELS, TYPES, esc, num, time, dateTime, ago, levelChip, toast, drawLevelChart, LOGO } from '../shared/fw.js';

const S = {
  stations: new Map(), alerts: [], feed: [], online: false, view: null, param: null,
  detail: { code: null, points: [], commands: [] }, map: null, markers: new Map(), closeLive: null,
};
const app = document.getElementById('app');
const isAdmin = () => auth.hasRole('ADMIN');
const ACT_LABEL = { barrier: 'Barrière', light: 'Feu', siren: 'Sirène', sampling: 'Période' };
const VAL_LABEL = { OPEN: 'ouverte', CLOSE: 'fermée', CLOSED: 'fermée', GREEN: 'vert', ORANGE: 'orange', RED: 'rouge', OFF: 'éteint',
  ON: 'activée', NORMAL: 'normale', WATCH: 'renforcée', UNKNOWN: 'inconnu' };
const ALERT_TYPE = { LEVEL: 'Niveau d’eau', OFFLINE: 'Station muette', SENSOR_FAULT: 'Capteur défaillant', LOCAL_SAFETY: 'Sécurité locale' };

registerSW('sw.js');
window.addEventListener('fw:unauthorized', () => { toast('Session expirée, reconnectez-vous.', true); start(); });

// ============================================================================= authentification
function renderLogin() {
  S.closeLive?.();
  app.innerHTML = `<div class="login"><form class="card" id="login">
    <div class="brand">${LOGO}<div>FloodWatch<small>Pilotage</small></div></div>
    <p class="muted small">Espace réservé aux opérateurs municipaux, à la protection civile et aux administrateurs.</p>
    <div class="field"><label for="u">Identifiant</label><input id="u" class="input" autocomplete="username" required></div>
    <div class="field"><label for="p">Mot de passe</label><input id="p" type="password" class="input" autocomplete="current-password" required></div>
    <button class="btn primary" type="submit">Se connecter</button>
    <p id="login-err" class="small" style="color:var(--red)"></p>
    <p class="small muted">${demo.active ? `Mode démonstration : <b>operator / operator123!</b> ou <b>admin / admin123!</b>${demo.forced ? '' : ' · <a href="?demo=0">quitter</a>'}`
      : 'Serveur indisponible ? <a href="?demo=1">Essayer le mode démonstration</a>'}</p>
  </form></div>`;
  document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      auth.save(await api('/auth/login', { method: 'POST', body: { username: document.getElementById('u').value.trim(), password: document.getElementById('p').value } }));
      start();
    } catch (err) {
      document.getElementById('login-err').textContent = err.status === 401 ? 'Identifiant ou mot de passe incorrect.' : err.message;
    } finally { btn.disabled = false; }
  });
  document.getElementById('u').focus();
}

// ============================================================================= coquille
function renderShell() {
  const u = auth.user;
  app.innerHTML = `
    <header class="topbar">
      <div class="brand">${LOGO}<div>FloodWatch<small>Pilotage</small></div></div>
      <div class="spacer"></div>
      <span id="live" class="live">Connexion…</span>
      <span class="small" style="opacity:.85">${esc(u?.fullName || u?.username)}</span>
      <button class="btn sm" id="logout" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.3)">Déconnexion</button>
    </header>
    ${demo.active ? `<div class="banner demo">Mode démonstration : stations et événements simulés dans le navigateur.${demo.forced ? '' : ' <a href="?demo=0">Quitter</a>'}</div>` : ''}
    <div class="shell">
      <nav class="nav" id="nav">
        <a href="#/" data-v="dash"><span class="ico">◉</span><span>Supervision</span></a>
        <a href="#/carte" data-v="map"><span class="ico">⌖</span><span>Carte</span></a>
        <a href="#/alertes" data-v="alerts"><span class="ico">⚠</span><span>Alertes</span><span class="badge hidden" id="badge"></span></a>
        <a href="#/kpi" data-v="kpi"><span class="ico">▤</span><span>KPI</span></a>
        ${isAdmin() ? '<a href="#/utilisateurs" data-v="users"><span class="ico">☺</span><span>Comptes</span></a>' : ''}
        <a href="#/parametres" data-v="settings"><span class="ico">⚙</span><span>Réglages</span></a>
      </nav>
      <main class="main" id="main"></main>
    </div>`;
  document.getElementById('logout').addEventListener('click', () => { auth.clear(); start(); });
}

function setLive(on) {
  S.online = on;
  const el = document.getElementById('live');
  if (el) { el.classList.toggle('on', on); el.textContent = on ? 'Temps réel' : 'Reconnexion…'; }
}

function updateBadge() {
  const n = S.alerts.filter((a) => a.active && !a.acknowledgedAt).length;
  const b = document.getElementById('badge');
  if (b) { b.textContent = n; b.classList.toggle('hidden', !n); }
}

function pushFeed(html, level) {
  S.feed.unshift({ at: new Date().toISOString(), html, level });
  S.feed.length = Math.min(S.feed.length, 60);
  const ul = document.getElementById('feed');
  if (ul) ul.innerHTML = feedItems();
}
const feedItems = () => S.feed.map((f) => `<li><span class="t">${time(f.at)}</span><span>${f.html}</span></li>`).join('') || '<li class="empty">En attente d’événements…</li>';

// ============================================================================= temps réel
function onLive(m) {
  switch (m.type) {
    case 'snapshot':
      m.data.forEach((s) => S.stations.set(s.code, s));
      refresh();
      break;
    case 'station': {
      const prev = S.stations.get(m.data.code);
      S.stations.set(m.data.code, m.data);
      if (prev && prev.alertLevel !== m.data.alertLevel) {
        pushFeed(`${levelChip(m.data.alertLevel)} <b>${esc(m.data.name)}</b> : ${esc(LEVELS[prev.alertLevel]?.label)} → ${esc(LEVELS[m.data.alertLevel]?.label)}`);
      }
      if (prev && prev.online !== m.data.online) pushFeed(`<b>${esc(m.data.name)}</b> ${m.data.online ? 'de nouveau en ligne' : '<span style="color:var(--red)">hors ligne</span>'}`);
      refresh(m.data.code);
      break;
    }
    case 'stationDeleted':
      S.stations.delete(m.data.code); refresh();
      break;
    case 'measurement':
      if (S.view === 'station' && S.detail.code === m.data.stationCode) {
        S.detail.points.push(m.data.measurement);
        if (S.detail.points.length > 3000) S.detail.points.shift();
        drawDetailChart();
      }
      break;
    case 'alert': {
      const i = S.alerts.findIndex((a) => a.id === m.data.id);
      if (i >= 0) S.alerts[i] = m.data; else S.alerts.unshift(m.data);
      if (i < 0) pushFeed(`⚠ <b>${esc(ALERT_TYPE[m.data.type] || m.data.type)}</b> ${levelChip(m.data.level)} ${esc(m.data.stationName)}`);
      else if (!m.data.active && m.data.resolvedAt) pushFeed(`✓ Alerte résolue – ${esc(m.data.stationName)} (${esc(ALERT_TYPE[m.data.type] || m.data.type)})`);
      updateBadge();
      if (S.view === 'alerts') viewAlerts();
      if (S.view === 'dash') renderDashAlerts();
      break;
    }
    case 'command':
      if (m.data.status === 'PENDING' || m.data.status === 'FAILED') {
        pushFeed(`${m.data.origin === 'AUTO' ? '⚙' : '👤'} ${esc(ACT_LABEL[m.data.actuator] || m.data.actuator)} ${esc(VAL_LABEL[m.data.value] || m.data.value)} – ${esc(m.data.stationCode)}${m.data.status === 'FAILED' ? ` <span style="color:var(--red)">échec : ${esc(m.data.detail || '')}</span>` : ''}`);
      }
      if (S.view === 'station' && S.detail.code === m.data.stationCode) {
        const i = S.detail.commands.findIndex((c) => c.id === m.data.id);
        if (i >= 0) S.detail.commands[i] = m.data; else S.detail.commands.unshift(m.data);
        renderCommands();
      }
      break;
    case 'gateway':
      pushFeed(`Passerelle ${esc(m.data.gateway)} : <span class="mono">${esc(m.data.event)}</span>`);
      break;
    default:
  }
}

/** Rafraîchit la vue courante après un changement de station. */
function refresh(code) {
  if (S.view === 'dash') renderDashboardBody();
  else if (S.view === 'map') updateMapMarkers();
  else if (S.view === 'station' && (!code || code === S.detail.code)) renderStationHeader();
}

// ============================================================================= vues
function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [v, p] = hash.split('/');
  const views = { '': 'dash', carte: 'map', alertes: 'alerts', station: 'station', kpi: 'kpi', utilisateurs: 'users', parametres: 'settings' };
  S.view = views[v] ?? 'dash';
  S.param = p ? decodeURIComponent(p) : null;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === S.view || (S.view === 'station' && a.dataset.v === 'dash')));
  S.map?.remove(); S.map = null; S.markers.clear();
  ({ dash: viewDashboard, map: viewMap, alerts: viewAlerts, station: viewStation, kpi: viewKpi, users: viewUsers, settings: viewSettings })[S.view]();
  window.scrollTo(0, 0);
}

const main = () => document.getElementById('main');

// ----------------------------------------------------------------------------- supervision
function viewDashboard() {
  main().innerHTML = `
    <div class="page-head"><div><h1>Supervision</h1><p class="muted small">État temps réel des points critiques</p></div>
      <button class="btn sm" data-goto="#/carte">Voir la carte</button></div>
    <div class="tiles" id="tiles"></div>
    <div class="cols">
      <div class="grid"><div class="stations" id="stations"></div><div id="dash-alerts"></div></div>
      <div class="card feed"><h2>Événements en direct</h2><ul id="feed">${feedItems()}</ul></div>
    </div>`;
  renderDashboardBody();
  renderDashAlerts();
}

function tank(s) {
  const t = s.thresholds;
  const pct = Math.max(0, Math.min(110, s.levelPct ?? 0));
  const tick = (p, c) => `<div class="tick" style="bottom:${(p / 110) * 100}%;border-color:${c}"></div>`;
  return `<div class="tank" title="${num(s.levelPct, 0)} % du niveau critique">
    <div class="water" style="height:${(pct / 110) * 100}%"></div>
    ${tick(t.yellowPct, LEVELS.YELLOW.color)}${tick(t.orangePct, LEVELS.ORANGE.color)}${tick(t.redPct, LEVELS.RED.color)}${tick(100, '#0f1d2e')}</div>`;
}

function stationCard(s) {
  const ttf = s.minutesToOverflow;
  return `<article class="card st l-${s.online ? s.alertLevel : 'OFF'}${s.online ? '' : ' offline'}" data-goto="#/station/${encodeURIComponent(s.code)}" tabindex="0">
    ${tank(s)}
    <div>
      <div class="row between"><h3>${esc(s.name)}</h3>${s.online ? levelChip(s.alertLevel) : levelChip('OFF', 'Hors ligne')}</div>
      <div class="small muted">${esc(TYPES[s.type] || s.type)} · ${esc(s.code)} · ${s.controlMode === 'MANUAL' ? '<b style="color:var(--orange)">MANUEL</b>' : 'auto'}</div>
      <dl class="kv">
        <dt>Niveau</dt><dd>${num(s.levelCm)} cm · ${num(s.levelPct, 0)} %</dd>
        <dt>Tendance</dt><dd>${s.slopeCmPerMin == null ? '–' : `${s.slopeCmPerMin > 0 ? '↗' : s.slopeCmPerMin < 0 ? '↘' : '→'} ${num(s.slopeCmPerMin)} cm/min`}</dd>
        <dt>Débordement</dt><dd>${ttf == null ? '–' : ttf < 1 ? '<span style="color:var(--red)">imminent</span>' : `${num(ttf, 0)} min`}</dd>
        <dt>Risque</dt><dd>${s.riskIndex ?? '–'}/100 · pluie ${num((s.rain ?? 0) * 100, 0)} %</dd>
      </dl>
      <div class="acts">
        <span class="act ${s.barrier === 'CLOSED' ? 'on' : s.barrier === 'OPEN' ? 'ok' : ''}">Barrière ${esc(VAL_LABEL[s.barrier] || s.barrier)}</span>
        <span class="act" style="color:${LEVELS[s.light]?.color || 'inherit'}">● Feu ${esc(VAL_LABEL[s.light] || s.light)}</span>
        ${s.siren ? '<span class="act on">Sirène</span>' : ''}
        ${s.localSafety ? '<span class="act on">Sécurité locale</span>' : ''}
        ${s.sensorFault ? '<span class="act on">Capteur ?</span>' : ''}
      </div>
      <div class="small muted" style="margin-top:6px">Dernier message ${ago(s.lastSeenAt)}</div>
    </div></article>`;
}

function renderDashboardBody() {
  const list = [...S.stations.values()].sort((a, b) => (b.riskIndex ?? 0) - (a.riskIndex ?? 0));
  const tiles = document.getElementById('tiles');
  if (!tiles) return;
  const online = list.filter((s) => s.online).length;
  const closed = list.filter((s) => s.barrier === 'CLOSED').length;
  const active = S.alerts.filter((a) => a.active).length;
  tiles.innerHTML = `
    <div class="card tile"><div class="k">Stations en ligne</div><div class="v">${online}<small> / ${list.length}</small></div></div>
    <div class="card tile ${closed ? 'alert' : ''}"><div class="k">Barrières fermées</div><div class="v">${closed}</div></div>
    <div class="card tile ${active ? 'alert' : ''}"><div class="k">Alertes actives</div><div class="v">${active}</div></div>
    <div class="card tile"><div class="k">Risque max.</div><div class="v">${list.length ? Math.max(...list.map((s) => s.riskIndex ?? 0)) : 0}<small>/100</small></div></div>`;
  document.getElementById('stations').innerHTML = list.map(stationCard).join('') || '<div class="card empty">Aucune station configurée.</div>';
}

function renderDashAlerts() {
  const el = document.getElementById('dash-alerts');
  if (!el) return;
  const act = S.alerts.filter((a) => a.active).slice(0, 5);
  el.innerHTML = act.length ? `<div class="card"><div class="pad row between"><h2>Alertes actives</h2><a href="#/alertes" class="small">Tout voir</a></div>${alertTable(act)}</div>` : '';
}

// ----------------------------------------------------------------------------- carte
function viewMap() {
  main().innerHTML = '<div class="page-head"><h1>Carte des stations</h1></div><div id="bigmap" class="bigmap card"></div>';
  if (!window.L) { document.getElementById('bigmap').innerHTML = '<div class="empty">Carte indisponible (hors connexion).</div>'; return; }
  S.map = L.map('bigmap').setView([36.87, 10.18], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; contributeurs OpenStreetMap' }).addTo(S.map);
  updateMapMarkers();
  const pts = [...S.stations.values()].map((s) => [s.latitude, s.longitude]);
  if (pts.length) S.map.fitBounds(L.latLngBounds(pts).pad(0.4), { maxZoom: 15 });
}

function updateMapMarkers() {
  if (!S.map) return;
  for (const s of S.stations.values()) {
    const color = s.online ? LEVELS[s.alertLevel].color : '#8592a3';
    const icon = L.divIcon({ html: `<div class="marker${s.alertLevel === 'RED' && s.online ? ' pulse' : ''}" style="background:${color}"></div>`, className: '', iconSize: [22, 22], iconAnchor: [11, 11] });
    const html = `<b>${esc(s.name)}</b><br>${levelChip(s.online ? s.alertLevel : 'OFF', s.online ? null : 'Hors ligne')}<br>Niveau ${num(s.levelPct, 0)} % · barrière ${esc(VAL_LABEL[s.barrier])}<br><a href="#/station/${encodeURIComponent(s.code)}">Ouvrir la fiche</a>`;
    let m = S.markers.get(s.code);
    if (!m) { m = L.marker([s.latitude, s.longitude], { icon }).addTo(S.map).bindPopup(html); S.markers.set(s.code, m); } else { m.setIcon(icon); m.setPopupContent(html); }
  }
}

// ----------------------------------------------------------------------------- alertes
function alertTable(list) {
  return `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Levée</th><th>Station</th><th>Type</th><th>Niveau</th><th>Message</th><th>État</th><th></th></tr></thead><tbody>
    ${list.map((a) => `<tr>
      <td class="tabular">${dateTime(a.raisedAt)}</td>
      <td><a href="#/station/${encodeURIComponent(a.stationCode)}">${esc(a.stationName)}</a></td>
      <td>${esc(ALERT_TYPE[a.type] || a.type)}</td>
      <td>${levelChip(a.level)}</td>
      <td class="small">${esc(a.message)}</td>
      <td class="small">${a.active ? '<b style="color:var(--red)">active</b>' : `résolue ${time(a.resolvedAt)}`}${a.acknowledgedAt ? `<br><span class="muted">acquittée par ${esc(a.acknowledgedBy)}</span>` : ''}</td>
      <td>${!a.acknowledgedAt ? `<button class="btn sm" data-ack="${esc(a.id)}">Acquitter</button>` : ''}</td></tr>`).join('')}
  </tbody></table></div>`;
}

async function viewAlerts() {
  const showAll = S.param === 'toutes';
  main().innerHTML = `<div class="page-head"><div><h1>Alertes</h1><p class="muted small">Acquittez les alertes pour signaler leur prise en charge.</p></div>
    <div class="seg"><a class="btn sm ${!showAll ? 'active' : ''}" href="#/alertes">Actives</a><a class="btn sm ${showAll ? 'active' : ''}" href="#/alertes/toutes">Historique</a></div></div>
    <div class="card" id="alert-list"><div class="empty">Chargement…</div></div>`;
  try {
    const list = await api(`/alerts?limit=200${showAll ? '' : '&active=true'}`);
    if (showAll) list.forEach((a) => { if (!S.alerts.some((x) => x.id === a.id)) S.alerts.push(a); });
    document.getElementById('alert-list').innerHTML = list.length ? alertTable(list) : '<div class="empty">Aucune alerte active. ✓</div>';
  } catch (e) { document.getElementById('alert-list').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

// ----------------------------------------------------------------------------- fiche station
async function viewStation() {
  const code = S.param;
  S.detail = { code, points: [], commands: [] };
  main().innerHTML = `
    <div class="page-head"><div><a href="#/" class="small">← Supervision</a><h1 id="st-title">${esc(code)}</h1><div class="status-line" id="st-status"></div></div>
      <div class="seg" id="range"><button class="btn sm" data-min="15">15 min</button><button class="btn sm active" data-min="60">1 h</button><button class="btn sm" data-min="360">6 h</button><button class="btn sm" data-min="1440">24 h</button></div></div>
    <div class="tiles" id="st-tiles"></div>
    <div class="cols">
      <div class="grid">
        <div class="card pad"><div class="row between"><h2>Niveau d’eau et pluie</h2><span class="small muted">pointillés : seuils jaune / orange / rouge</span></div><canvas id="chart" class="chart"></canvas></div>
        <div class="card pad"><h2>Commandes envoyées</h2><div id="cmds" class="small" style="margin-top:8px"></div></div>
        ${isAdmin() ? '<div class="card pad" id="config"></div>' : ''}
      </div>
      <div class="grid">
        <div class="card pad controls" id="controls"></div>
        <div class="card pad small" id="st-info"></div>
      </div>
    </div>`;
  document.getElementById('range').addEventListener('click', (e) => {
    const b = e.target.closest('[data-min]');
    if (!b) return;
    document.querySelectorAll('#range .btn').forEach((x) => x.classList.toggle('active', x === b));
    loadPoints(Number(b.dataset.min));
  });
  if (!S.stations.has(code)) {
    try { const s = await api(`/stations/${encodeURIComponent(code)}`); S.stations.set(s.code, s); } catch (e) { main().innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return; }
  }
  renderStationHeader();
  if (isAdmin()) renderConfig();
  loadPoints(60);
  api(`/stations/${encodeURIComponent(code)}/commands?limit=30`).then((c) => { S.detail.commands = c; renderCommands(); }).catch(() => {});
  window.addEventListener('resize', drawDetailChart, { once: true });
}

async function loadPoints(minutes) {
  S.detail.points = await api(`/stations/${encodeURIComponent(S.detail.code)}/measurements?minutes=${minutes}&limit=5000`).catch(() => []);
  drawDetailChart();
}

function drawDetailChart() {
  const c = document.getElementById('chart');
  const s = S.stations.get(S.detail.code);
  if (c && s) drawLevelChart(c, S.detail.points, s.thresholds);
}

function renderStationHeader() {
  const s = S.stations.get(S.detail.code);
  if (!s || !document.getElementById('st-title')) return;
  document.getElementById('st-title').textContent = s.name;
  document.getElementById('st-status').innerHTML = `${s.online ? levelChip(s.alertLevel) : levelChip('OFF', 'Hors ligne')}
    <span class="small muted">${esc(TYPES[s.type] || s.type)} · ${esc(s.address || '')} · dernier message ${ago(s.lastSeenAt)}</span>`;
  const ttf = s.minutesToOverflow;
  document.getElementById('st-tiles').innerHTML = `
    <div class="card tile"><div class="k">Niveau</div><div class="v">${num(s.levelCm)}<small> cm · ${num(s.levelPct, 0)} %</small></div></div>
    <div class="card tile"><div class="k">Vitesse de montée</div><div class="v">${num(s.slopeCmPerMin)}<small> cm/min</small></div></div>
    <div class="card tile ${ttf != null && ttf < 10 ? 'alert' : ''}"><div class="k">Avant débordement</div><div class="v">${ttf == null ? '–' : ttf < 1 ? '< 1' : num(ttf, 0)}<small>${ttf == null ? '' : ' min'}</small></div></div>
    <div class="card tile ${s.riskIndex >= 70 ? 'alert' : ''}"><div class="k">Indice de risque</div><div class="v">${s.riskIndex ?? '–'}<small>/100</small></div></div>`;
  const seg = (act, opts, current) => `<div class="seg">${opts.map(([v, l]) => `<button class="btn sm ${current === v ? 'active' : ''}" data-cmd="${act}" data-val="${v}">${l}</button>`).join('')}</div>`;
  document.getElementById('controls').innerHTML = `
    <div class="row between"><h2>Commande à distance</h2>
      <div class="seg"><button class="btn sm ${s.controlMode === 'AUTO' ? 'active' : ''}" data-mode="AUTO">Auto</button><button class="btn sm ${s.controlMode === 'MANUAL' ? 'active' : ''}" data-mode="MANUAL">Manuel</button></div></div>
    <p class="small muted">${s.controlMode === 'AUTO' ? 'Les actionneurs suivent automatiquement le niveau d’alerte. Toute commande manuelle fait passer la station en mode manuel.'
      : '<b style="color:var(--orange)">Mode manuel</b> : l’automatisme Cloud est suspendu. La règle de sécurité locale de la station reste active.'}</p>
    <div class="ctl"><span>Barrière</span>${seg('barrier', [['OPEN', 'Ouvrir'], ['CLOSE', 'Fermer']], s.barrier === 'CLOSED' ? 'CLOSE' : s.barrier === 'OPEN' ? 'OPEN' : '')}</div>
    <div class="ctl"><span>Feu</span>${seg('light', [['GREEN', 'Vert'], ['ORANGE', 'Orange'], ['RED', 'Rouge'], ['OFF', 'Éteint']], s.light)}</div>
    <div class="ctl"><span>Sirène</span>${seg('siren', [['ON', 'Activer'], ['OFF', 'Couper']], s.siren ? 'ON' : 'OFF')}</div>
    <div class="ctl"><span>Mesure</span>${seg('sampling', [['NORMAL', 'Normale (30 s)'], ['WATCH', 'Renforcée (5 s)']], s.sampling)}</div>
    ${!s.online ? '<p class="small" style="color:var(--red)">Station hors ligne : les commandes seront refusées ou expireront.</p>' : ''}`;
  document.getElementById('st-info').innerHTML = `<h3>Diagnostic</h3><dl class="kv">
    <dt>Code</dt><dd class="mono">${esc(s.code)}</dd><dt>Firmware</dt><dd>${esc(s.firmware || '–')}</dd><dt>Wi-Fi</dt><dd>${s.rssi ?? '–'} dBm</dd>
    <dt>Capteur</dt><dd>${s.sensorFault ? '<span style="color:var(--red)">défaillant</span>' : 'OK'}</dd>
    <dt>Motif</dt><dd style="font-weight:500">${esc(s.alertReasons || '–')}</dd></dl>
    <p style="margin-top:10px"><a href="${demo.active ? '#' : `/api/stations/${encodeURIComponent(s.code)}/td`}" target="_blank" rel="noopener">Thing Description W3C WoT ↗</a></p>`;
}

function renderCommands() {
  const el = document.getElementById('cmds');
  if (!el) return;
  const st = { PENDING: '<span style="color:var(--orange)">en attente</span>', ACKED: '<span style="color:var(--green)">acquittée</span>', FAILED: '<span style="color:var(--red)">échec</span>' };
  el.innerHTML = S.detail.commands.length ? `<table class="tbl"><thead><tr><th>Heure</th><th>Commande</th><th>Origine</th><th>Statut</th></tr></thead><tbody>${S.detail.commands.slice(0, 15).map((c) => `<tr>
    <td class="tabular">${time(c.issuedAt)}</td><td>${esc(ACT_LABEL[c.actuator] || c.actuator)} → ${esc(VAL_LABEL[c.value] || c.value)}</td>
    <td>${c.origin === 'AUTO' ? 'automatisme' : esc(c.issuedBy)}</td><td>${st[c.status] || c.status}${c.detail ? `<br><span class="muted">${esc(c.detail)}</span>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Aucune commande.</div>';
}

function renderConfig() {
  const s = S.stations.get(S.detail.code);
  const t = s.thresholds;
  const f = (k, label, step = 'any') => `<div class="field"><label for="c-${k}">${label}</label><input class="input" type="number" step="${step}" id="c-${k}" name="${k}" value="${t[k]}"></div>`;
  document.getElementById('config').innerHTML = `<form id="cfg" class="grid">
    <div class="row between"><h2>Configuration de la station</h2><span class="small muted">Envoyée à la station (topic config retenu)</span></div>
    <div class="form-grid">
      <div class="field"><label for="c-name">Nom</label><input class="input" id="c-name" value="${esc(s.name)}"></div>
      <div class="field"><label for="c-address">Adresse</label><input class="input" id="c-address" value="${esc(s.address || '')}"></div>
    </div>
    <div class="form-grid">
      ${f('criticalCm', 'Niveau critique (cm)')}${f('sensorHeightCm', 'Hauteur capteur (cm)')}
      ${f('yellowPct', 'Seuil jaune (%)')}${f('orangePct', 'Seuil orange (%)')}${f('redPct', 'Seuil rouge (%)')}
      ${f('rainThreshold', 'Seuil pluie (0..1)')}${f('rapidRiseCmPerMin', 'Montée rapide (cm/min)')}${f('forecastRedMinutes', 'Rouge si débordement < (min)')}
      ${f('reopenDelaySec', 'Temporisation réouverture (s)', 1)}${f('periodNormalSec', 'Période normale (s)', 1)}${f('periodWatchSec', 'Période renforcée (s)', 1)}
    </div>
    <div class="row"><button class="btn primary" type="submit">Enregistrer et envoyer</button><span class="small muted" id="cfg-msg"></span></div>
  </form>`;
  document.getElementById('cfg').addEventListener('submit', async (e) => {
    e.preventDefault();
    const thresholds = {};
    e.target.querySelectorAll('input[name]').forEach((i) => { thresholds[i.name] = Number(i.value); });
    try {
      const s2 = await api(`/stations/${encodeURIComponent(s.code)}`, { method: 'PUT', body: { name: document.getElementById('c-name').value, address: document.getElementById('c-address').value, thresholds } });
      S.stations.set(s2.code, s2); renderStationHeader(); toast('Configuration enregistrée et publiée vers la station.');
    } catch (err) { toast(err.message, true); }
  });
}

// ----------------------------------------------------------------------------- KPI
async function viewKpi() {
  const days = Number(S.param || 7);
  main().innerHTML = `<div class="page-head"><div><h1>Indicateurs de performance</h1><p class="muted small">Délais, disponibilité, alertes et inondations par zone</p></div>
    <div class="seg">${[1, 7, 30].map((d) => `<a class="btn sm ${d === days ? 'active' : ''}" href="#/kpi/${d}">${d === 1 ? '24 h' : `${d} jours`}</a>`).join('')}</div></div>
    <div id="kpi"><div class="card empty">Chargement…</div></div>`;
  try {
    const k = await api(`/kpi?days=${days}`);
    const bars = (obj, max, unit, color) => Object.entries(obj || {}).map(([code, v]) => `<div class="hbar"><span>${esc(S.stations.get(code)?.name || code)}</span>
      <div class="bar"><i style="width:${max ? Math.min(100, (100 * (v ?? 0)) / max) : 0}%;background:${color}"></i></div><b class="tabular">${v ?? '–'}${unit}</b></div>`).join('') || '<div class="empty">–</div>';
    const maxFloods = Math.max(1, ...Object.values(k.floodsByStation || {}));
    document.getElementById('kpi').innerHTML = `
      <div class="tiles">
        <div class="card tile"><div class="k">Délai détection → fermeture</div><div class="v">${k.closureDelaySecAvg == null ? '–' : num(k.closureDelaySecAvg)}<small> s moy.</small></div><div class="small muted">objectif &lt; 5 s · max ${k.closureDelaySecMax == null ? '–' : `${num(k.closureDelaySecMax)} s`}</div></div>
        <div class="card tile"><div class="k">Durée de fermeture</div><div class="v">${k.closureDurationMinAvg == null ? '–' : num(k.closureDurationMinAvg)}<small> min moy.</small></div><div class="small muted">${k.closures} fermeture(s)</div></div>
        <div class="card tile"><div class="k">Disponibilité</div><div class="v">${k.availabilityPctAvg == null ? '–' : num(k.availabilityPctAvg)}<small> %</small></div><div class="small muted">${k.stationsOnline}/${k.stationsTotal} en ligne</div></div>
        <div class="card tile"><div class="k">Alertes</div><div class="v">${k.alertsTotal}</div><div class="small muted">${k.alertsActive} active(s)</div></div>
        <div class="card tile"><div class="k">Commandes acquittées</div><div class="v">${k.commandsAckedPct == null ? '–' : num(k.commandsAckedPct, 0)}<small> %</small></div><div class="small muted">${k.commandsTotal} commande(s)</div></div>
        <div class="card tile"><div class="k">Mesures reçues</div><div class="v">${Number(k.measurements).toLocaleString('fr-FR')}</div></div>
      </div>
      <div class="cols">
        <div class="grid">
          <div class="card pad"><h2>Inondations (alertes rouges) par station</h2>${bars(k.floodsByStation, maxFloods, '', LEVELS.RED.color)}</div>
          <div class="card pad"><h2>Disponibilité par station</h2>${bars(k.availabilityPct, 100, ' %', LEVELS.GREEN.color)}</div>
        </div>
        <div class="card pad"><h2>Alertes par niveau et par type</h2>
          ${Object.entries(k.alertsByLevel || {}).map(([l, n]) => `<div class="row between" style="margin:8px 0">${levelChip(l)}<b>${n}</b></div>`).join('') || '<div class="empty">Aucune alerte</div>'}
          <hr style="border:0;border-top:1px solid var(--line)">
          ${Object.entries(k.alertsByType || {}).map(([t, n]) => `<div class="row between" style="margin:8px 0"><span>${esc(ALERT_TYPE[t] || t)}</span><b>${n}</b></div>`).join('')}
        </div>
      </div>`;
  } catch (e) { document.getElementById('kpi').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}

// ----------------------------------------------------------------------------- comptes
async function viewUsers() {
  if (!isAdmin()) { location.hash = '#/'; return; }
  main().innerHTML = `<div class="page-head"><h1>Comptes utilisateurs</h1></div>
    <div class="cols"><div class="card" id="users"><div class="empty">Chargement…</div></div>
    <form class="card pad grid" id="new-user"><h2>Nouveau compte</h2>
      <div class="field"><label for="nu-u">Identifiant</label><input class="input" id="nu-u" required></div>
      <div class="field"><label for="nu-n">Nom complet</label><input class="input" id="nu-n"></div>
      <div class="field"><label for="nu-p">Mot de passe (8 caractères min.)</label><input class="input" id="nu-p" type="password" minlength="8" required></div>
      <div class="field"><label for="nu-r">Rôle</label><select class="input" id="nu-r"><option value="OPERATOR">Opérateur</option><option value="ADMIN">Administrateur</option></select></div>
      <button class="btn primary">Créer</button></form></div>`;
  const load = async () => {
    const users = await api('/users');
    document.getElementById('users').innerHTML = `<table class="tbl"><thead><tr><th>Identifiant</th><th>Nom</th><th>Rôles</th><th>État</th><th></th></tr></thead><tbody>${users.map((u) => `<tr>
      <td class="mono">${esc(u.username)}</td><td>${esc(u.fullName || '')}</td><td class="small">${u.roles.map(esc).join(', ')}</td>
      <td>${u.enabled ? '<span class="chip lvl-GREEN">actif</span>' : '<span class="chip lvl-OFF">désactivé</span>'}</td>
      <td class="row">${u.username === auth.user?.username ? '<span class="small muted">vous</span>' : `<button class="btn sm" data-toggle-user="${u.id}" data-enabled="${u.enabled}">${u.enabled ? 'Désactiver' : 'Activer'}</button><button class="btn sm danger" data-del-user="${u.id}">Supprimer</button>`}</td></tr>`).join('')}</tbody></table>`;
  };
  load().catch((e) => toast(e.message, true));
  document.getElementById('new-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    const role = document.getElementById('nu-r').value;
    try {
      await api('/users', { method: 'POST', body: { username: document.getElementById('nu-u').value.trim(), fullName: document.getElementById('nu-n').value, password: document.getElementById('nu-p').value, roles: role === 'ADMIN' ? ['ADMIN', 'OPERATOR'] : ['OPERATOR'] } });
      e.target.reset(); toast('Compte créé.'); load();
    } catch (err) { toast(err.message, true); }
  });
  S.reloadUsers = load;
}

// ----------------------------------------------------------------------------- réglages
async function viewSettings() {
  const on = await pushEnabled();
  main().innerHTML = `<div class="page-head"><h1>Réglages</h1></div>
    <div class="cols"><div class="grid">
      <div class="card pad grid"><h2>Notifications d’alerte sur cet appareil</h2>
        <p class="small muted">Recevez toutes les alertes (niveau, station muette, capteur, sécurité locale) même lorsque l’application est fermée.</p>
        <div class="row"><button class="btn ${on ? '' : 'primary'}" id="push-toggle">${on ? 'Désactiver les notifications' : 'Activer les notifications'}</button>
        <button class="btn" id="push-test">Envoyer une notification de test</button></div></div>
      <div class="card pad grid"><h2>Session</h2><p class="small">Connecté en tant que <b>${esc(auth.user?.username)}</b> (${(auth.user?.roles || []).map(esc).join(', ')}).</p>
        <div class="row"><button class="btn" id="logout2">Se déconnecter</button></div></div>
    </div>
    <div class="card pad grid small"><h2>À propos</h2><p>FloodWatch Pilotage 1.0 – Sup’Com, module Cloud of Things 2026-2027.</p>
      <p class="muted">Équipe : Guesmi Baderddine (middleware), Ksontini Amine (back-end &amp; IoT), Kamoun Ahmed (PWA).</p>
      <p><a href="${demo.active ? '#' : '/api/openapi'}" target="_blank" rel="noopener">Spécification OpenAPI de l’API ↗</a></p>
      <p>${demo.forced ? '' : demo.active ? '<a href="?demo=0">Quitter le mode démonstration</a>' : '<a href="?demo=1">Ouvrir le mode démonstration</a>'}</p></div></div>`;
  document.getElementById('logout2').addEventListener('click', () => { auth.clear(); start(); });
  document.getElementById('push-toggle').addEventListener('click', async () => {
    try { if (on) { await unsubscribePush(); toast('Notifications désactivées.'); } else { await subscribePush({}); toast('Notifications activées pour toutes les alertes.'); } viewSettings(); } catch (err) { toast(err.message, true); }
  });
  document.getElementById('push-test').addEventListener('click', async () => {
    try { const r = await api('/push/test', { method: 'POST', body: {} }); toast(`Notification envoyée à ${r.sent} abonné(s).`); } catch (err) { toast(err.message, true); }
  });
}

// ============================================================================= actions globales
document.addEventListener('click', async (e) => {
  const go = e.target.closest('[data-goto]');
  if (go && !e.target.closest('a,button:not([data-goto])')) { location.hash = go.dataset.goto; return; }
  const ack = e.target.closest('[data-ack]');
  if (ack) {
    ack.disabled = true;
    try { const a = await api(`/alerts/${ack.dataset.ack}/ack`, { method: 'POST' }); onLive({ type: 'alert', data: a }); toast('Alerte acquittée.'); } catch (err) { toast(err.message, true); ack.disabled = false; }
    return;
  }
  const cmd = e.target.closest('[data-cmd]');
  if (cmd && S.detail.code) {
    const s = S.stations.get(S.detail.code);
    if (cmd.dataset.cmd === 'barrier' && cmd.dataset.val === 'OPEN' && s?.alertLevel === 'RED'
      && !confirm('Le niveau est ROUGE. Ouvrir la barrière expose les usagers à un danger. Confirmer ?')) return;
    cmd.disabled = true;
    try {
      const c = await api(`/stations/${encodeURIComponent(S.detail.code)}/commands`, { method: 'POST', body: { actuator: cmd.dataset.cmd, value: cmd.dataset.val } });
      toast(`Commande envoyée : ${ACT_LABEL[c.actuator]} ${VAL_LABEL[c.value] || c.value}`);
    } catch (err) { toast(err.message, true); } finally { cmd.disabled = false; }
    return;
  }
  const tog = e.target.closest('[data-toggle-user]');
  const del = e.target.closest('[data-del-user]');
  if (tog || del) {
    try {
      if (tog) await api(`/users/${tog.dataset.toggleUser}`, { method: 'PUT', body: { enabled: tog.dataset.enabled !== 'true' } });
      if (del) { if (!confirm('Supprimer ce compte ?')) return; await api(`/users/${del.dataset.delUser}`, { method: 'DELETE' }); }
      S.reloadUsers?.();
    } catch (err) { toast(err.message, true); }
    return;
  }
  const mode = e.target.closest('[data-mode]');
  if (mode && S.detail.code) {
    try { const s = await api(`/stations/${encodeURIComponent(S.detail.code)}/mode`, { method: 'PUT', body: { mode: mode.dataset.mode } }); S.stations.set(s.code, s); renderStationHeader(); toast(`Mode ${mode.dataset.mode === 'AUTO' ? 'automatique' : 'manuel'}`); } catch (err) { toast(err.message, true); }
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-goto]')) location.hash = e.target.dataset.goto; });

// ============================================================================= démarrage
async function start() {
  if (!auth.token) { renderLogin(); return; }
  renderShell();
  try {
    const [stations, alerts] = await Promise.all([api('/stations'), api('/alerts?active=true&limit=200')]);
    stations.forEach((s) => S.stations.set(s.code, s));
    S.alerts = alerts;
  } catch (e) {
    if (e.status === 401) return;
    toast(`Chargement impossible : ${e.message}`, true);
  }
  updateBadge();
  route();
  S.closeLive?.();
  S.closeLive = connectLive(onLive, setLive);
}

window.addEventListener('hashchange', () => { if (auth.token) route(); });
setInterval(() => { if (S.view === 'dash') renderDashboardBody(); }, 15000);
start();

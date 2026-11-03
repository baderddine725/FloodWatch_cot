/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : pilotage/js/views/dashboard.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { api } from '../../../shared/js/api.js';
import { session } from '../../../shared/js/auth.js';
import { LEVELS, bySeverity, esc, levelOf, longDate, num, time } from '../../../shared/js/format.js';
import { icon } from '../../../shared/js/icons.js';
import { badge } from '../../../shared/js/components/badge.js';
import { createLineChart, toPoints } from '../../../shared/js/components/chart.js';
import { createMap } from '../../../shared/js/components/map.js';
import { openModal } from '../../../shared/js/components/modal.js';
import { kpiCard, livePill, onFrame, pageHeading, redBanner } from '../ui.js';

/**
 * Tableau de bord (page « dashboard » de la maquette) : indicateurs, carte du réseau,
 * état des stations classées par criticité et courbes de niveau en direct.
 * Les valeurs affichées (niveaux, alertes, indicateurs) sont celles calculées par le serveur.
 */

/** Filtres de la légende de la carte. */
const MAP_FILTERS = [
  ['all', 'Toutes'], ['GREEN', 'Normal'], ['YELLOW', 'Vigilance'], ['ORANGE', 'Orange'], ['RED', 'Rouge'], ['OFFLINE', 'Hors ligne'],
];

/** Fréquence de rafraîchissement des indicateurs (GET /api/kpi). */
const KPI_REFRESH_MS = 60_000;

/**
 * Raccourcit un nom de station pour la légende des courbes (comme la maquette).
 * @param {string} name nom complet
 * @returns {string} nom court
 */
const shortName = (name) => name.replace('Passage souterrain', 'P. souterrain');

/**
 * Affiche le tableau de bord.
 * @param {HTMLElement} main zone principale
 * @param {object} ctx contexte de l'application
 * @returns {() => void} nettoyage à la sortie de la page
 */
export function mountDashboard(main, ctx) {
  const { store } = ctx;
  const stations = () => [...store.state.stations.values()];
  let mapFilter = 'all';
  let minutes = 30;
  let kpi = null;
  let kpiYesterday = null;

  main.innerHTML = `${pageHeading({
    eyebrow: 'SUPERVISION EN TEMPS RÉEL', title: 'Tableau de bord',
    subtitle: 'Anticiper les crues. Protéger les citoyens. Garder le contrôle.',
    actions: `${livePill(store.state.live)}<span class="current-date">${esc(longDate(Date.now()))}
      <span><span data-clock>${time(Date.now())}</span> <span class="timezone">Tunis (UTC+1)</span></span></span>`,
  })}
    <div data-banner></div>
    <section class="kpi-grid" data-kpis aria-label="Indicateurs clés"></section>
    <div class="dashboard-middle">
      <section class="card map-card">
        <div class="card-header"><div><h2>${icon('MapPin', 17)}Vue d’ensemble du réseau</h2><p>Localisation et état des stations</p></div>
          <button type="button" class="subtle-icon" data-map-expand title="Agrandir la carte" aria-label="Agrandir la carte">${icon('Expand', 16)}</button></div>
        <div class="map" data-map></div>
        <div class="map-legend" data-legend role="group" aria-label="Filtrer la carte par niveau"></div>
      </section>
      <section class="card station-list">
        <div class="card-header"><div><h2>État des stations <span class="neutral-count" data-count></span></h2><p>Classées par niveau de criticité</p></div>
          ${icon('SlidersHorizontal', 16)}</div>
        <div class="station-list-rows" data-rows></div>
        <button type="button" class="list-footer" data-all-stations>Consulter toutes les stations ${icon('ArrowRight', 14)}</button>
      </section>
    </div>
    <section class="card chart-card">
      <div class="card-header"><div><h2>${icon('Activity', 17)}Évolution des niveaux d’eau <span class="live-text"><span></span>EN DIRECT</span></h2>
        <p>Anticipez les tendances sur l’ensemble du réseau</p></div>
        <div class="segmented" role="group" aria-label="Période affichée">
          <button type="button" class="active" data-minutes="30" aria-pressed="true">30 dernières min</button>
          <button type="button" data-minutes="15" aria-pressed="false">15 dernières min</button></div></div>
      <div data-chart></div>
    </section>
    <div class="page-foot">${icon('ShieldCheck', 13)} Des décisions éclairées, des routes plus sûres.
      <span>Mises à jour en temps réel (WebSocket) <span class="tiny-dot"></span></span></div>`;

  const $ = (sel) => main.querySelector(sel);

  // ------------------------------------------------------------------- indicateurs
  /** Affiche les cinq indicateurs (stations, alertes, délai de fermeture, durée de fermeture, alertes 24 h). */
  function renderKpis() {
    const list = stations();
    const online = list.filter((s) => s.online).length;
    const red = list.filter((s) => levelOf(s) === 'RED').length;
    const active = store.state.alerts.filter((a) => a.active);
    const unread = active.filter((a) => !a.acknowledgedAt).length;
    const availability = list.length ? (online / list.length) * 100 : null;
    const delay = kpi?.closureDelaySecAvg;
    // ÉCART API : la maquette affiche une durée cumulée ; l'API fournit la durée moyenne et le nombre de fermetures.
    const closureMin = kpi?.closureDurationMinAvg != null ? kpi.closureDurationMinAvg * (kpi.closures ?? 0) : null;
    const alerts24 = kpi?.alertsTotal;
    const diff = alerts24 != null && kpiYesterday?.alertsTotal != null ? alerts24 - kpiYesterday.alertsTotal : null;

    $('[data-kpis]').innerHTML = [
      kpiCard({
        icon: 'Radio', title: 'Stations en ligne', trend: 'Réseau de stations',
        value: `${online}<small> / ${list.length}</small>`,
        foot: `<span class="green-text"><span class="tiny-dot"></span>${num(availability, 0)} %</span> de disponibilité`,
      }),
      kpiCard({
        icon: 'BellRing', title: 'Alertes actives', tone: 'red', trend: 'Vigilance renforcée',
        value: String(active.length).padStart(2, '0'),
        foot: `<span class="red-text">${red} critique${red > 1 ? 's' : ''}</span><span class="foot-separator">·</span>${unread} à acquitter`,
      }),
      kpiCard({
        icon: 'Zap', title: 'Détection → fermeture', trend: 'Délai moyen sur 24 h',
        value: delay == null ? '—' : `${num(delay, 1)} <small>s</small>`,
        foot: kpi?.closureDelaySecMax != null ? `<span class="small-icon">${icon('Clock3', 12)}</span>Maximum ${num(kpi.closureDelaySecMax, 1)} s · objectif &lt; 5 s`
          : `<span class="small-icon">${icon('Clock3', 12)}</span>Aucune fermeture sur 24 h`,
      }),
      kpiCard({
        icon: 'Clock3', title: 'Fermeture sur 24 h', trend: 'Protection des axes',
        value: closureMin == null ? '—' : `${Math.floor(closureMin / 60)} <small>h</small> ${Math.round(closureMin % 60)} <small>min</small>`,
        foot: `<span class="small-icon">${icon('ShieldCheck', 12)}</span>${kpi?.closures ?? 0} fermeture${(kpi?.closures ?? 0) > 1 ? 's' : ''} · durée cumulée estimée`,
      }),
      kpiCard({
        icon: 'Activity', title: 'Alertes sur 24 h', trend: 'Sur les dernières 24 h',
        value: alerts24 == null ? '—' : String(alerts24),
        foot: diff == null ? 'Comparaison indisponible'
          : `<span class="${diff > 0 ? 'red-text' : 'green-text'}">${icon(diff > 0 ? 'ArrowUpRight' : 'ArrowDown', 12)} ${Math.abs(diff)} alerte${Math.abs(diff) > 1 ? 's' : ''}</span> vs. hier`,
      }),
    ].join('');
  }

  /** Charge les indicateurs des dernières 24 h et ceux de la veille (comparaison). */
  async function loadKpis() {
    const now = Date.now();
    const iso = (t) => new Date(t).toISOString();
    try {
      [kpi, kpiYesterday] = await Promise.all([
        api('/kpi?days=1'),
        api(`/kpi?from=${encodeURIComponent(iso(now - 2 * 86_400_000))}&to=${encodeURIComponent(iso(now - 86_400_000))}`).catch(() => null),
      ]);
    } catch {
      kpi = null; // indicateurs serveur indisponibles : seules les valeurs temps réel s'affichent
    }
    renderKpis();
  }

  // ------------------------------------------------------------------- carte et légende
  const map = createMap($('[data-map]'), { onSelect: (s) => s && ctx.openStation(s.code) });

  /** Met à jour les marqueurs (filtre de niveau appliqué) et les compteurs de la légende. */
  function renderMap() {
    const list = stations();
    map.update(list.filter((s) => mapFilter === 'all' || levelOf(s) === mapFilter));
    $('[data-legend]').innerHTML = MAP_FILTERS.map(([key, label]) => {
      const n = key === 'all' ? list.length : list.filter((s) => levelOf(s) === key).length;
      return `<button type="button" data-filter="${key}" class="${mapFilter === key ? 'selected' : ''}" aria-pressed="${mapFilter === key}">
        ${key === 'all' ? '<span class="all-dot"></span>' : `<span class="legend-status ${LEVELS[key].css}"></span>`}<span>${label}</span><b>${n}</b></button>`;
    }).join('');
  }

  // ------------------------------------------------------------------- liste des stations
  /**
   * Ligne de station (bouton .station-row de la maquette).
   * @param {object} s StationDto
   * @returns {string} HTML
   */
  function stationRow(s) {
    const level = levelOf(s);
    const css = LEVELS[level].css;
    const state = !s.online ? `Dernier message <span data-ago="${esc(s.lastSeenAt ?? '')}"></span>`
      : s.sensorFault ? 'Capteur défaillant'
        : s.barrier === 'CLOSED' ? 'Barrière fermée' : s.barrier === 'OPEN' ? 'Barrière ouverte' : 'Barrière : état inconnu';
    return `<button type="button" class="station-row" data-open-station="${esc(s.code)}">
      <span class="station-icon ${css}">${icon(s.online ? 'Waves' : 'WifiOff', 18)}</span>
      <div class="station-row-main"><strong>${esc(s.name)}</strong>
        <span><span class="status-small ${css}"></span>${esc(LEVELS[level].label)}<span class="row-separator">·</span>${state}
        ${s.controlMode === 'MANUAL' ? '<span class="row-separator">·</span><span class="manual-tag">Manuel</span>' : ''}</span></div>
      <div class="station-value">${s.online && s.levelPct != null
    ? `<strong>${num(s.levelPct, 0)}<small> %</small></strong><span>${num(s.levelCm)} cm</span>` : '<span>—</span>'}</div>
      ${icon('ChevronRight', 14, 'row-chevron')}</button>`;
  }

  /** Affiche la liste triée par criticité. */
  function renderRows() {
    const list = stations().sort(bySeverity);
    $('[data-count]').textContent = list.length;
    $('[data-rows]').innerHTML = list.map(stationRow).join('')
      || `<p class="list-empty">Aucune station configurée.</p>`;
    ctx.refreshAgo(main);
  }

  // ------------------------------------------------------------------- courbes
  const chart = createLineChart($('[data-chart]'), { unit: 'Niveau d’eau (%)', label: 'Évolution en temps réel du niveau d’eau' });

  /** Redessine les courbes à partir des points mémorisés dans le store. */
  function renderChart() {
    const series = stations().filter((s) => s.online || store.state.points.get(s.code)?.length)
      .map((s) => ({ key: s.code, name: shortName(s.name), points: toPoints(store.state.points.get(s.code) ?? []) }));
    chart.update({ series, minutes });
  }

  /** Charge les 30 dernières minutes de mesures de chaque station (GET /stations/{code}/measurements). */
  async function loadPoints() {
    await Promise.all(stations().map(async (s) => {
      if (store.state.points.has(s.code)) return;
      try {
        store.setPoints(s.code, await api(`/stations/${encodeURIComponent(s.code)}/measurements?minutes=30&limit=2000`));
      } catch {
        store.setPoints(s.code, []);
      }
    }));
    renderChart();
  }

  // ------------------------------------------------------------------- rendu complet et abonnements
  const renderStations = onFrame(() => {
    $('[data-banner]').innerHTML = redBanner(stations());
    renderKpis();
    renderMap();
    renderRows();
  });
  const renderChartLater = onFrame(renderChart);

  renderStations();
  renderChart();
  loadKpis();
  loadPoints();

  const unsubscribers = [
    store.subscribe('stations', (code) => {
      renderStations();
      if (code && !store.state.points.has(code)) loadPoints();
    }),
    store.subscribe('alerts', () => {
      renderKpis();
      loadKpisSoon();
    }),
    store.subscribe('measurement', renderChartLater),
    store.subscribe('live', (live) => {
      const pill = main.querySelector('[data-live-pill]');
      if (pill) pill.outerHTML = livePill(live, pill.dataset.livePill);
    }),
  ];

  // Les indicateurs serveur sont rechargés périodiquement et peu après chaque alerte (regroupé).
  let kpiSoonTimer = null;
  /** Recharge les indicateurs 3 s après la dernière alerte reçue. */
  function loadKpisSoon() {
    clearTimeout(kpiSoonTimer);
    kpiSoonTimer = setTimeout(loadKpis, 3000);
  }
  const kpiTimer = setInterval(loadKpis, KPI_REFRESH_MS);
  // l'axe du temps glisse même sans nouvelle mesure ; l'horloge suit
  const tick = setInterval(() => {
    renderChart();
    const clock = $('[data-clock]');
    if (clock) clock.textContent = time(Date.now());
  }, 5000);

  // ------------------------------------------------------------------- interactions
  main.addEventListener('click', (e) => {
    const filter = e.target.closest('[data-filter]');
    if (filter) {
      mapFilter = filter.dataset.filter;
      renderMap();
    }
    const period = e.target.closest('[data-minutes]');
    if (period) {
      minutes = Number(period.dataset.minutes);
      main.querySelectorAll('[data-minutes]').forEach((b) => {
        b.classList.toggle('active', b === period);
        b.setAttribute('aria-pressed', String(b === period));
      });
      renderChart();
    }
    if (e.target.closest('[data-map-expand]')) {
      openModal({
        title: 'Réseau du Grand Tunis', wide: true, html: '<div class="map" data-big-map></div>',
        onMount: (root, close) => {
          const big = createMap(root.querySelector('[data-big-map]'), { onSelect: (s) => { close(); if (s) ctx.openStation(s.code); } });
          big.update(stations());
          requestAnimationFrame(() => { big.invalidate(); big.fit(); });
        },
      });
    }
    if (e.target.closest('[data-all-stations]') && session.isAdmin) ctx.navigate('stations');
    else if (e.target.closest('[data-all-stations]')) {
      openModal({
        title: 'Toutes les stations',
        html: stations().sort(bySeverity).map((s) => `<button type="button" class="modal-station" data-open-station="${esc(s.code)}" data-close>
          ${esc(s.name)}${badge(levelOf(s))}${icon('ChevronRight', 15)}</button>`).join(''),
      });
    }
  });

  return () => {
    unsubscribers.forEach((fn) => fn());
    clearInterval(kpiTimer);
    clearInterval(tick);
    clearTimeout(kpiSoonTimer);
    map.destroy();
  };
}

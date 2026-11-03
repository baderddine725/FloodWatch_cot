/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : pilotage/js/views/history.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { api } from '../../../shared/js/api.js';
import { ALERT_TYPES, LEVELS, duration, esc, num } from '../../../shared/js/format.js';
import { icon } from '../../../shared/js/icons.js';
import { badge } from '../../../shared/js/components/badge.js';
import { toast, toastError } from '../../../shared/js/components/toast.js';
import { emptyState, isoDay, kpiCard, pageHeading } from '../ui.js';

/**
 * Page « Historique » de la maquette, complétée des indicateurs de performance (GET /api/kpi).
 *
 * ÉCART API (TEMPORAIRE) : il n'existe pas d'endpoint des épisodes de crue. Ils sont reconstitués
 * ici à partir des alertes rouges (GET /api/alerts, types LEVEL et LOCAL_SAFETY) : début = levée,
 * fin = résolution, fermeture = barrierClosedAt → barrierReopenedAt. Le niveau maximal est lu à la
 * demande dans les mesures de la période (GET /stations/{code}/measurements?from&to).
 * À remplacer par un endpoint serveur (/api/episodes) s'il est ajouté.
 */

/** Périodes des indicateurs (jours). */
const PERIODS = [[1, '24 h'], [7, '7 jours'], [30, '30 jours']];
/** Nombre maximal d'épisodes affichés et de chargements de pic simultanés. */
const MAX_ROWS = 100;
const PEAK_CONCURRENCY = 4;

/**
 * Reconstitue les épisodes de crue à partir des alertes.
 * @param {object[]} alerts AlertDto
 * @returns {object[]} épisodes {id, alert, stationCode, stationName, start, end, closedAt, reopenedAt, active}
 */
function episodesFrom(alerts) {
  return alerts
    .filter((a) => a.level === 'RED' && (a.type === 'LEVEL' || a.type === 'LOCAL_SAFETY'))
    .map((a) => ({
      id: a.id, type: a.type, stationCode: a.stationCode, stationName: a.stationName, start: a.raisedAt,
      end: a.resolvedAt, closedAt: a.barrierClosedAt, reopenedAt: a.barrierReopenedAt, active: a.active,
    }))
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
}

/**
 * Durée de fermeture d'un épisode en minutes (barrière fermée → rouverte, ou jusqu'à maintenant).
 * @param {object} e épisode
 * @returns {number|null} minutes, ou null si la barrière n'a pas été fermée
 */
function closureMinutes(e) {
  if (!e.closedAt) return null;
  const end = e.reopenedAt ?? e.end ?? new Date().toISOString();
  return Math.max(0, (Date.parse(end) - Date.parse(e.closedAt)) / 60_000);
}

/**
 * Barres horizontales (disponibilité, inondations par station).
 * @param {object} values valeurs par code de station
 * @param {Map<string, object>} stations StationDto par code
 * @param {number} max valeur pleine échelle
 * @param {string} unit unité affichée
 * @param {string} color couleur des barres
 * @returns {string} HTML
 */
function bars(values, stations, max, unit, color) {
  const entries = Object.entries(values ?? {});
  if (!entries.length) return '<p class="list-empty">Aucune donnée sur la période.</p>';
  return entries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([code, v]) => `<div class="bar-row">
    <span>${esc(stations.get(code)?.name ?? code)}</span>
    <div class="bar-track"><i style="width:${max ? Math.min(100, (100 * (v ?? 0)) / max) : 0}%;background:${color}"></i></div>
    <b>${v == null ? '—' : `${num(v, 1)}${unit}`}</b></div>`).join('');
}

/**
 * Affiche la page Historique.
 * @param {HTMLElement} main zone principale
 * @param {object} ctx contexte de l'application
 * @returns {() => void} nettoyage
 */
export function mountHistory(main, ctx) {
  const { store } = ctx;
  let days = 7;
  let episodes = [];
  let from = '';
  let to = '';
  let destroyed = false;
  const peaks = new Map(); // id d'épisode → niveau maximal (%), null si inconnu
  const loading = new Set();

  main.innerHTML = `${pageHeading({
    eyebrow: 'ESPACE DE PILOTAGE', title: 'Historique', subtitle: 'Retrouvez les épisodes de crue, les interventions et les indicateurs du réseau.',
    actions: `<button type="button" class="button" data-csv>${icon('ArrowDownToLine', 16)} Exporter CSV</button>`,
  })}
    <section class="card table-card kpi-section">
      <div class="table-toolbar"><div><h2>${icon('Gauge', 17)} Indicateurs de performance</h2><p class="muted" data-kpi-range>Chargement…</p></div>
        <div class="segmented" role="group" aria-label="Période des indicateurs">${PERIODS.map(([d, l]) => `<button type="button" data-days="${d}"
          class="${d === days ? 'active' : ''}" aria-pressed="${d === days}">${l}</button>`).join('')}</div></div>
      <div class="kpi-body"><div class="kpi-grid" data-kpis></div>
        <div class="kpi-details" data-kpi-details></div></div>
    </section>
    <section class="card table-card">
      <div class="table-toolbar"><div><h2>Épisodes passés</h2><p class="muted">Alertes rouges du réseau (niveau d’eau et sécurité locale)</p></div>
        <div class="filters"><input type="date" aria-label="Date de début" data-from><span>au</span><input type="date" aria-label="Date de fin" data-to></div></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Date de l’épisode</th><th>Station</th><th>Niveau maximal</th><th>Durée de fermeture</th><th>État</th></tr></thead>
        <tbody data-rows></tbody></table><div data-empty></div></div>
      <div class="table-bottom" data-count></div>
    </section>`;

  const $ = (sel) => main.querySelector(sel);

  // ------------------------------------------------------------------- indicateurs
  /** Charge et affiche les indicateurs de la période (GET /api/kpi?days=). */
  async function loadKpis() {
    $('[data-kpi-range]').textContent = 'Chargement…';
    let k;
    try {
      k = await api(`/kpi?days=${days}`);
    } catch (e) {
      if (!destroyed) $('[data-kpi-range]').textContent = e.message;
      return;
    }
    if (destroyed) return;
    const fmtDate = (v) => new Date(v).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Tunis' });
    $('[data-kpi-range]').textContent = `Du ${fmtDate(k.from)} au ${fmtDate(k.to)}`;
    $('[data-kpis]').innerHTML = [
      kpiCard({ icon: 'Zap', title: 'Détection → fermeture', trend: 'Objectif < 5 s',
        value: k.closureDelaySecAvg == null ? '—' : `${num(k.closureDelaySecAvg, 1)} <small>s</small>`,
        foot: k.closureDelaySecMax == null ? 'Aucune fermeture' : `Maximum ${num(k.closureDelaySecMax, 1)} s · ${k.closures} fermeture${k.closures > 1 ? 's' : ''}` }),
      kpiCard({ icon: 'Clock3', title: 'Durée moyenne de fermeture', trend: 'Barrière fermée → rouverte',
        value: k.closureDurationMinAvg == null ? '—' : `${num(k.closureDurationMinAvg, 1)} <small>min</small>`, foot: 'Par épisode de fermeture' }),
      kpiCard({ icon: 'Radio', title: 'Disponibilité', trend: 'Moyenne des stations',
        value: k.availabilityPctAvg == null ? '—' : `${num(k.availabilityPctAvg, 1)} <small>%</small>`, foot: `${k.stationsOnline} / ${k.stationsTotal} stations en ligne` }),
      kpiCard({ icon: 'BellRing', title: 'Alertes', tone: 'red', trend: 'Levées sur la période',
        value: String(k.alertsTotal), foot: `<span class="red-text">${k.alertsActive} active${k.alertsActive > 1 ? 's' : ''}</span>` }),
      kpiCard({ icon: 'CheckCheck', title: 'Commandes acquittées', trend: 'Acquittement par la station',
        value: k.commandsAckedPct == null ? '—' : `${num(k.commandsAckedPct, 0)} <small>%</small>`,
        foot: `${k.commandsTotal} commande${k.commandsTotal > 1 ? 's' : ''} · ${Number(k.measurements ?? 0).toLocaleString('fr-FR')} mesures` }),
    ].join('');
    const floodsMax = Math.max(1, ...Object.values(k.floodsByStation ?? {}).map(Number));
    $('[data-kpi-details]').innerHTML = `
      <div><h3>Disponibilité par station</h3>${bars(k.availabilityPct, store.state.stations, 100, ' %', LEVELS.GREEN.color)}</div>
      <div><h3>Inondations (alertes rouges) par station</h3>${bars(k.floodsByStation, store.state.stations, floodsMax, '', LEVELS.RED.color)}</div>
      <div><h3>Alertes par niveau et par type</h3>
        ${Object.entries(k.alertsByLevel ?? {}).map(([l, n]) => `<div class="count-row">${badge(LEVELS[l] ? l : 'OFFLINE')}<b>${n}</b></div>`).join('') || '<p class="list-empty">Aucune alerte.</p>'}
        ${Object.entries(k.alertsByType ?? {}).map(([t, n]) => `<div class="count-row"><span>${esc(ALERT_TYPES[t] ?? t)}</span><b>${n}</b></div>`).join('')}</div>`;
  }

  // ------------------------------------------------------------------- épisodes
  /** @returns {object[]} épisodes filtrés par dates */
  const filtered = () => episodes.filter((e) => (!from || isoDay(e.start) >= from) && (!to || isoDay(e.start) <= to));

  /**
   * Charge le niveau maximal d'un épisode (mesures de la période).
   * @param {object} e épisode
   * @returns {Promise<void>}
   */
  async function loadPeak(e) {
    if (peaks.has(e.id) || loading.has(e.id)) return;
    loading.add(e.id);
    const q = `from=${encodeURIComponent(e.start)}&to=${encodeURIComponent(e.end ?? new Date().toISOString())}&limit=5000`;
    try {
      const list = await api(`/stations/${encodeURIComponent(e.stationCode)}/measurements?${q}`);
      peaks.set(e.id, list.length ? Math.max(...list.map((m) => m.levelPct ?? 0)) : null);
    } catch {
      peaks.set(e.id, null); // station supprimée ou mesures purgées
    }
    loading.delete(e.id);
  }

  /**
   * Charge les pics manquants, quelques requêtes à la fois.
   * @param {object[]} list épisodes concernés
   * @returns {Promise<void>}
   */
  async function loadPeaks(list) {
    const queue = list.filter((e) => !peaks.has(e.id));
    const worker = async () => {
      while (queue.length && !destroyed) {
        await loadPeak(queue.shift());
        renderRows();
      }
    };
    await Promise.all(Array.from({ length: PEAK_CONCURRENCY }, worker));
  }

  /** Affiche le tableau des épisodes. */
  function renderRows() {
    if (destroyed) return;
    const list = filtered();
    $('[data-rows]').innerHTML = list.slice(0, MAX_ROWS).map((e) => {
      const peak = peaks.get(e.id);
      const minutes = closureMinutes(e);
      const known = store.state.stations.has(e.stationCode);
      return `<tr><td>${new Date(e.start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Tunis' })}
          <small>${new Date(e.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Tunis' })} · ${e.end ? `durée ${duration(e.start, e.end)}` : 'en cours'}</small></td>
        <td>${known ? `<button type="button" class="table-link" data-open-station="${esc(e.stationCode)}">${esc(e.stationName)}</button>` : `<span class="table-link">${esc(e.stationName)}</span>`}
          <small>${esc(ALERT_TYPES[e.type])}</small></td>
        <td>${peaks.has(e.id) ? (peak == null ? '<span class="muted">—</span>' : `<span class="red-text">${num(peak, 0)} %</span>`) : '<span class="muted">…</span>'}</td>
        <td>${icon('Clock3', 13, 'inline-icon')}${minutes == null ? 'Barrière non fermée' : `${num(minutes, minutes < 10 ? 1 : 0)} min`}</td>
        <td>${e.active ? badge('RED', 'Épisode en cours') : `<span class="badge green">${icon('Check', 12)}Épisode terminé</span>`}</td></tr>`;
    }).join('');
    $('[data-empty]').innerHTML = list.length ? '' : emptyState('Aucun épisode enregistré sur cette période.', 'Aucun épisode');
    $('[data-count]').textContent = `${list.length} épisode${list.length > 1 ? 's' : ''}${list.length > MAX_ROWS ? ` (${MAX_ROWS} affichés)` : ''} · Export au format CSV disponible`;
  }

  /** Charge les alertes et reconstitue les épisodes. */
  async function loadEpisodes() {
    try {
      episodes = episodesFrom(await api('/alerts?limit=1000'));
    } catch (e) {
      toastError(e);
    }
    if (destroyed) return;
    renderRows();
    loadPeaks(filtered().slice(0, MAX_ROWS));
  }

  /** Exporte les épisodes filtrés au format CSV (séparateur « ; », UTF-8 avec BOM pour Excel). */
  async function exportCsv() {
    const list = filtered();
    if (!list.length) {
      toast('Aucun épisode à exporter sur cette période.');
      return;
    }
    await loadPeaks(list);
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = list.map((e) => [e.start, e.end ?? '', e.stationCode, e.stationName, ALERT_TYPES[e.type],
      peaks.get(e.id) == null ? '' : num(peaks.get(e.id), 1), closureMinutes(e) == null ? '' : num(closureMinutes(e), 1), e.active ? 'en cours' : 'terminé']
      .map(cell).join(';'));
    const csv = `﻿${['Début (UTC)', 'Fin (UTC)', 'Code station', 'Station', 'Type', 'Niveau maximal (%)', 'Fermeture (min)', 'État'].map(cell).join(';')}\n${rows.join('\n')}`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `floodwatch-episodes-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast(`Export CSV téléchargé (${list.length} épisode${list.length > 1 ? 's' : ''}).`);
  }

  main.addEventListener('click', (e) => {
    const period = e.target.closest('[data-days]');
    if (period) {
      days = Number(period.dataset.days);
      main.querySelectorAll('[data-days]').forEach((b) => {
        b.classList.toggle('active', b === period);
        b.setAttribute('aria-pressed', String(b === period));
      });
      loadKpis();
    }
    if (e.target.closest('[data-csv]')) exportCsv();
  });
  main.addEventListener('change', (e) => {
    if (e.target.matches('[data-from]')) from = e.target.value;
    if (e.target.matches('[data-to]')) to = e.target.value;
    renderRows();
    loadPeaks(filtered().slice(0, MAX_ROWS));
  });

  loadKpis();
  loadEpisodes();
  return () => { destroyed = true; };
}

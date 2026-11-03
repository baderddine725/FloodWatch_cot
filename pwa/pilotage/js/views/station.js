/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : pilotage/js/views/station.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { api } from '../../../shared/js/api.js';
import { session } from '../../../shared/js/auth.js';
import { demo } from '../../../shared/js/config.js';
import {
  ACTUATORS, ALERT_TYPES, COMMAND_STATES, LEVELS, STATION_TYPES, VALUES, commandState, esc, levelOf, num, rainText, time,
} from '../../../shared/js/format.js';
import { icon } from '../../../shared/js/icons.js';
import { badge } from '../../../shared/js/components/badge.js';
import { createLineChart, toPoints } from '../../../shared/js/components/chart.js';
import { toast, toastError } from '../../../shared/js/components/toast.js';
import { ACTUATOR_DEFS, latestCommand, openCommandModal, stateLabel } from '../commands.js';
import { openStationForm } from '../station-form.js';
import { alertTypeChip, emptyState, onFrame, pageHeading, redBanner } from '../ui.js';

/**
 * Fiche d'une station (page « detail » de la maquette) : état de la liaison, mode de pilotage,
 * courbes de niveau et de pluie, prévision de débordement, commandes des actionneurs et
 * journal (commandes et alertes de la station).
 */

/** Périodes proposées pour les courbes (minutes). */
const PERIODS = [[30, '30 min'], [120, '2 h'], [360, '6 h'], [1440, '24 h']];

/**
 * Affiche la fiche d'une station.
 * @param {HTMLElement} main zone principale
 * @param {object} ctx contexte de l'application
 * @param {string} code code de la station (paramètre de l'URL)
 * @returns {() => void} nettoyage
 */
export function mountStation(main, ctx, code) {
  const { store } = ctx;
  let minutes = 30;
  let points = [];
  let destroyed = false;
  const station = () => store.state.stations.get(code);

  if (!station()) {
    main.innerHTML = `<div class="card">${emptyState('Cette station n’existe pas ou a été supprimée.', 'Station introuvable')}</div>`;
    return () => {};
  }

  main.innerHTML = `<div data-head></div><div data-banner></div>
    <div class="detail-status-bar" data-status></div>
    <div class="detail-grid">
      <div class="detail-charts">
        <section class="card"><div class="card-header"><div><h2>${icon('Waves', 17)}Niveau d’eau</h2>
          <p>Mesures en temps réel · Seuils de vigilance</p></div>
          <div class="chart-head-right"><div class="segmented" role="group" aria-label="Période affichée">${PERIODS.map(([m, l]) => `<button type="button"
            data-minutes="${m}" class="${m === minutes ? 'active' : ''}" aria-pressed="${m === minutes}">${l}</button>`).join('')}</div>
          <strong class="large-stat" data-level></strong></div></div>
          <div data-chart-level></div></section>
        <section class="card"><div class="card-header"><div><h2>${icon('Droplets', 17)}Précipitations</h2>
          <p>Intensité de pluie mesurée par la station (0 à 100 %)</p></div><strong class="large-stat" data-rain></strong></div>
          <div data-chart-rain></div></section>
      </div>
      <div class="detail-side">
        <section class="card prediction" data-prediction></section>
        <section class="card commands" data-commands></section>
        <section class="card diagnostic" data-diagnostic></section>
      </div>
    </div>
    <section class="card event-log"><div class="card-header"><div><h2>${icon('History', 17)}Journal de la station</h2>
      <p>Traçabilité des alertes et des interventions</p></div><span class="live-pill"><span></span>En direct</span></div>
      <div data-log></div></section>`;

  const $ = (sel) => main.querySelector(sel);
  const levelChart = createLineChart($('[data-chart-level]'), { unit: 'Niveau d’eau (%)', label: 'Évolution du niveau d’eau de la station', legend: false });
  const rainChart = createLineChart($('[data-chart-rain]'), { unit: 'Intensité de pluie (%)', label: 'Évolution de la pluie', legend: false, area: false });

  // ------------------------------------------------------------------- en-tête et état de la liaison
  /** En-tête de page : retour, code, type, adresse, niveau. */
  function renderHead() {
    const s = station();
    $('[data-head]').innerHTML = pageHeading({
      back: `<a class="back-link" href="#dashboard">${icon('ArrowLeft', 14)} Tableau de bord</a>`,
      eyebrow: `${s.code} · ${(STATION_TYPES[s.type] ?? s.type).toUpperCase()}${s.address ? ` · ${s.address.toUpperCase()}` : ''}`,
      title: s.name,
      subtitle: 'Mesures en direct, prévisions et pilotage des équipements.',
      actions: `${session.isAdmin ? `<button type="button" class="button" data-configure>${icon('Settings2', 15)} Configurer</button>` : ''}${badge(levelOf(s))}`,
    });
    document.title = `${s.name} · FloodWatch Pilotage`;
  }

  /** Barre d'état : liaison, dernier message, mode de pilotage, sécurité locale, capteur, échantillonnage. */
  function renderStatus() {
    const s = station();
    const period = s.sampling === 'WATCH' ? s.thresholds?.periodWatchSec : s.thresholds?.periodNormalSec;
    $('[data-status]').innerHTML = `
      <span class="${s.online ? 'heartbeat' : 'offline-heartbeat'}">${icon(s.online ? 'Wifi' : 'WifiOff', 15)} ${s.online ? 'Station connectée' : 'Station hors ligne'} <span class="tiny-dot"></span></span>
      <span>Dernier message de vie <span data-ago="${esc(s.lastSeenAt ?? '')}"></span></span>
      <span class="mode-badge ${s.controlMode === 'MANUAL' ? 'local' : ''}" title="Mode de pilotage">${icon(s.controlMode === 'MANUAL' ? 'SlidersHorizontal' : 'Cloud', 14)}
        ${s.controlMode === 'MANUAL' ? 'Pilotage manuel' : 'Pilotage automatique'}</span>
      ${s.localSafety ? `<span class="mode-badge local" title="La station a fermé sa barrière d’elle-même">${icon('ShieldCheck', 14)} Sécurité locale</span>` : ''}
      ${s.sensorFault ? `<span class="mode-badge fault">${icon('Gauge', 14)} Capteur défaillant</span>` : ''}
      <span class="muted">Mesure ${s.sampling === 'WATCH' ? 'renforcée' : 'normale'}${period ? ` · toutes les ${period} s` : ''}</span>`;
    ctx.refreshAgo($('[data-status]'));
  }

  // ------------------------------------------------------------------- prévision
  /** Carte « Prévision de débordement » (valeurs calculées par le serveur). */
  function renderPrediction() {
    const s = station();
    const ttf = s.minutesToOverflow;
    const forecast = s.thresholds?.forecastRedMinutes ?? 10;
    const risk = s.riskIndex;
    $('[data-prediction]').innerHTML = `<div class="card-header"><h2>${icon('TrendingUp', 17)}Prévision de débordement</h2><span class="neutral-count">ESTIMATION</span></div>
      <div class="prediction-time"><span>Temps estimé avant débordement</span>
        <strong class="${ttf != null && ttf <= forecast ? 'red-text' : ''} ${ttf == null || ttf < 1 ? 'text-value' : ''}">${ttf == null ? 'Aucune montée détectée' : ttf < 1 ? 'Imminent' : `${num(ttf, 0)} <small>min</small>`}</strong></div>
      <div class="risk-meter"><div><span>Indice de risque</span><strong>${risk ?? '—'} / 100</strong></div>
        <div class="progress-track"><span style="width:${Math.max(0, Math.min(100, risk ?? 0))}%;background:${LEVELS[levelOf(s)].color}"></span></div></div>
      <div class="prediction-bottom"><span>${icon('TrendingUp', 15)} Vitesse de montée</span><strong>${num(s.slopeCmPerMin)} cm/min</strong></div>
      ${s.alertReasons ? `<p class="prediction-reasons">${icon('Info', 13)}${esc(s.alertReasons)}</p>` : ''}
      <p class="prediction-note">Estimation indicative calculée par le serveur à partir de la vitesse de montée (alerte rouge si débordement prévu en ${forecast} min ou moins).</p>`;
  }

  // ------------------------------------------------------------------- commandes et mode
  /**
   * Groupe de commandes d'un actionneur : état remonté par la station, boutons, commande en cours.
   * @param {object} s StationDto
   * @param {string} actuator actionneur
   * @param {boolean} enabled commandes possibles
   * @returns {string} HTML
   */
  function commandGroup(s, actuator, enabled) {
    const def = ACTUATOR_DEFS[actuator];
    const current = def.current(s);
    const last = latestCommand(store.state.commands, s.code, actuator);
    const state = last ? commandState(last) : null;
    const pending = state === 'pending' || state === 'stale';
    let line = '';
    if (pending) {
      line = `<div class="command-pending">${icon('RefreshCw', 13, 'spin')} ${esc(COMMAND_STATES[state])} : ${esc(stateLabel(actuator, last.value))}
        · <span data-ago="${esc(last.issuedAt)}"></span></div>`;
    } else if (state === 'failed' || state === 'expired') {
      line = `<div class="command-failed">${icon('TriangleAlert', 13)} ${esc(stateLabel(actuator, last.value))} : ${esc(COMMAND_STATES[state])}${last.detail && state === 'failed' ? ` (${esc(last.detail)})` : ''}</div>`;
    } else if (state === 'acked' && Date.now() - Date.parse(last.ackedAt ?? last.issuedAt) < 15_000) {
      line = `<div class="command-acked">${icon('CheckCheck', 13)} ${esc(stateLabel(actuator, last.value))} : acquittée par la station</div>`;
    }
    return `<div class="command-group" data-group="${actuator}">
      <div><span>${esc(def.label)}</span><strong>${esc(stateLabel(actuator, current))}</strong></div>
      <div class="command-buttons">${def.options.map(([value, label]) => `<button type="button" class="button ${current === value ? 'chosen' : ''}"
        data-command="${actuator}" data-value="${value}" ${enabled && !pending ? '' : 'disabled'}
        aria-pressed="${current === value}">${esc(label)}</button>`).join('')}</div>${line}</div>`;
  }

  /** Carte « Commandes » (mode de pilotage + actionneurs). */
  function renderCommands() {
    const s = station();
    const online = ctx.canAct();
    const enabled = s.online && online;
    const notice = !online ? 'Hors connexion : commandes indisponibles jusqu’au retour du réseau.'
      : !s.online ? 'Station hors ligne : commandes indisponibles.'
        : s.controlMode === 'MANUAL' ? 'Mode manuel : l’automatisme est suspendu, les actionneurs ne changent que sur commande.'
          : 'Chaque action nécessite une confirmation et l’acquittement de la station.';
    $('[data-commands]').innerHTML = `<div class="card-header"><h2>${icon('Settings2', 17)}Commandes</h2>
        <div class="segmented" role="group" aria-label="Mode de pilotage">
          <button type="button" data-mode="AUTO" class="${s.controlMode === 'AUTO' ? 'active' : ''}" aria-pressed="${s.controlMode === 'AUTO'}" ${online ? '' : 'disabled'}>Automatique</button>
          <button type="button" data-mode="MANUAL" class="${s.controlMode === 'MANUAL' ? 'active' : ''}" aria-pressed="${s.controlMode === 'MANUAL'}" ${online ? '' : 'disabled'}>Manuel</button></div></div>
      <p class="command-notice">${esc(notice)}</p>
      ${['barrier', 'light', 'siren', 'sampling'].map((a) => commandGroup(s, a, enabled)).join('')}`;
    ctx.refreshAgo($('[data-commands]'));
  }

  /**
   * Bascule du mode de pilotage (PUT /stations/{code}/mode).
   * @param {'AUTO'|'MANUAL'} mode mode demandé
   */
  async function setMode(mode) {
    if (station().controlMode === mode) return;
    try {
      store.upsertStation(await api(`/stations/${encodeURIComponent(code)}/mode`, { method: 'PUT', body: { mode } }));
      toast(mode === 'AUTO' ? 'Mode automatique rétabli : les actionneurs suivent à nouveau le niveau d’alerte.'
        : 'Mode manuel activé : l’automatisme du Cloud est suspendu pour cette station.');
    } catch (e) {
      toastError(e);
    }
  }

  // ------------------------------------------------------------------- diagnostic
  /** Carte « Diagnostic » (informations remontées par la station, absentes de la maquette). */
  function renderDiagnostic() {
    const s = station();
    const td = demo.active ? null : `/api/stations/${encodeURIComponent(s.code)}/td`;
    $('[data-diagnostic]').innerHTML = `<div class="card-header"><h2>${icon('Radio', 17)}Diagnostic</h2></div>
      <dl class="diag-list">
        <div><dt>Code</dt><dd class="mono">${esc(s.code)}</dd></div>
        <div><dt>Micrologiciel</dt><dd>${esc(s.firmware || '—')}</dd></div>
        <div><dt>Signal Wi-Fi</dt><dd>${s.rssi == null ? '—' : `${s.rssi} dBm`}</dd></div>
        <div><dt>Capteur de niveau</dt><dd class="${s.sensorFault ? 'red-text' : ''}">${s.sensorFault ? 'Défaillant' : 'Opérationnel'}</dd></div>
        <div><dt>Hauteur critique</dt><dd>${num(s.thresholds?.criticalCm)} cm</dd></div>
        <div><dt>Seuils J / O / R</dt><dd>${num(s.thresholds?.yellowPct, 0)} / ${num(s.thresholds?.orangePct, 0)} / ${num(s.thresholds?.redPct, 0)} %</dd></div>
        <div><dt>Route</dt><dd>${s.roadOpen ? 'Praticable' : '<span class="red-text">Fermée</span>'}</dd></div>
      </dl>
      ${td ? `<a class="text-button diag-link" href="${td}" target="_blank" rel="noopener">${icon('ExternalLink', 13)} Thing Description (W3C WoT)</a>` : ''}`;
  }

  // ------------------------------------------------------------------- journal
  /** Journal : commandes (avec leur statut réel) et alertes de la station, les plus récentes d'abord. */
  function renderLog() {
    const commands = [...store.state.commands.values()].filter((c) => c.stationCode === code).map((c) => {
      const state = commandState(c);
      const who = c.origin === 'AUTO' ? 'Automatisme' : c.issuedBy;
      return {
        at: c.issuedAt, css: state === 'acked' ? 'ok' : state === 'failed' || state === 'expired' ? 'ko' : 'wait',
        text: `${esc(ACTUATORS[c.actuator] ?? c.actuator)} → ${esc(VALUES[c.value] ?? c.value)} · ${esc(who)}`,
        tail: `<span class="log-state ${state}">${esc(COMMAND_STATES[state])}${c.detail && state === 'failed' ? ` : ${esc(c.detail)}` : ''}</span>`,
      };
    });
    const alerts = store.state.alerts.filter((a) => a.stationCode === code).flatMap((a) => {
      const rows = [{ at: a.raisedAt, css: 'alert', text: `${alertTypeChip(a.type)} ${esc(a.message ?? ALERT_TYPES[a.type] ?? '')}`, tail: badge(a.type === 'OFFLINE' ? 'OFFLINE' : a.level) }];
      if (a.acknowledgedAt) rows.push({ at: a.acknowledgedAt, css: 'ok', text: `Alerte acquittée par ${esc(a.acknowledgedBy)}`, tail: icon('CheckCheck', 15) });
      if (a.resolvedAt) rows.push({ at: a.resolvedAt, css: 'ok', text: `Fin d’alerte : ${esc(ALERT_TYPES[a.type] ?? a.type)}`, tail: icon('CircleCheck', 15) });
      return rows;
    });
    const rows = [...commands, ...alerts].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 15);
    $('[data-log]').innerHTML = rows.map((r) => `<div class="event-row ${r.css}"><span class="event-dot"></span>
      <strong>${time(r.at, true)}</strong><span>${r.text}</span>${r.tail}</div>`).join('')
      || '<p class="log-empty">Aucune intervention récente sur cette station.</p>';
  }

  // ------------------------------------------------------------------- courbes
  /** Redessine les deux courbes. */
  function renderCharts() {
    const s = station();
    const t = s.thresholds ?? {};
    levelChart.update({ series: [{ key: code, name: s.name, points: toPoints(points) }], minutes, thresholds: [t.yellowPct, t.orangePct, t.redPct].filter((v) => v != null) });
    rainChart.update({ series: [{ key: code, name: s.name, points: toPoints(points, 'rain') }], minutes });
    $('[data-level]').innerHTML = s.levelPct == null ? '—' : `${num(s.levelPct)} <small>%</small>`;
    $('[data-rain]').innerHTML = rainText(s.rain);
  }

  /** Charge les mesures de la période choisie (GET /stations/{code}/measurements). */
  async function loadPoints() {
    try {
      const list = await api(`/stations/${encodeURIComponent(code)}/measurements?minutes=${minutes}&limit=5000`);
      if (!destroyed) points = list;
    } catch (e) {
      toastError(e);
    }
    if (!destroyed) renderCharts();
  }

  /** Charge l'historique des commandes de la station (GET /stations/{code}/commands). */
  async function loadCommands() {
    try {
      store.setCommands(await api(`/stations/${encodeURIComponent(code)}/commands?limit=30`));
    } catch {
      /* journal limité aux événements reçus en direct */
    }
  }

  // ------------------------------------------------------------------- rendu et abonnements
  const renderAll = onFrame(() => {
    if (destroyed) return;
    if (!station()) {
      main.innerHTML = `<div class="card">${emptyState('Cette station vient d’être supprimée du réseau.', 'Station supprimée')}</div>`;
      return;
    }
    renderHead();
    $('[data-banner]').innerHTML = redBanner([...store.state.stations.values()]);
    renderStatus();
    renderPrediction();
    renderCommands();
    renderDiagnostic();
    renderCharts();
    renderLog();
  });
  const renderCommandsLater = onFrame(() => { if (!destroyed && station()) { renderCommands(); renderLog(); } });
  const renderChartsLater = onFrame(() => { if (!destroyed && station()) renderCharts(); });

  renderAll();
  loadPoints();
  loadCommands();

  const unsubscribers = [
    store.subscribe('stations', (c) => { if (!c || c === code) renderAll(); else $('[data-banner]').innerHTML = redBanner([...store.state.stations.values()]); }),
    store.subscribe('commands', renderCommandsLater),
    store.subscribe('alerts', renderCommandsLater),
    store.subscribe('live', renderCommandsLater),
    store.subscribe('measurement', (m) => {
      if (m.stationCode !== code) return;
      points.push(m.measurement);
      if (points.length > 6000) points.splice(0, points.length - 6000);
      renderChartsLater();
    }),
  ];
  // les états « en attente » vieillissent même sans message (compte à rebours, expiration côté client)
  const tick = setInterval(() => { renderCommandsLater(); renderChartsLater(); }, 2000);

  main.addEventListener('click', (e) => {
    const cmd = e.target.closest('[data-command]');
    if (cmd && !cmd.disabled) openCommandModal(station(), cmd.dataset.command, cmd.dataset.value, ctx);
    if (e.target.closest('[data-configure]')) openStationForm(ctx, station());
    const mode = e.target.closest('[data-mode]');
    if (mode && !mode.disabled) setMode(mode.dataset.mode);
    const period = e.target.closest('[data-minutes]');
    if (period) {
      minutes = Number(period.dataset.minutes);
      main.querySelectorAll('[data-minutes]').forEach((b) => {
        b.classList.toggle('active', b === period);
        b.setAttribute('aria-pressed', String(b === period));
      });
      loadPoints();
    }
  });

  return () => {
    destroyed = true;
    clearInterval(tick);
    unsubscribers.forEach((fn) => fn());
  };
}

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : pilotage/js/views/alerts.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { api } from '../../../shared/js/api.js';
import { session } from '../../../shared/js/auth.js';
import { ALERT_TYPES, LEVELS, alertStatus, esc, time } from '../../../shared/js/format.js';
import { icon } from '../../../shared/js/icons.js';
import { badge } from '../../../shared/js/components/badge.js';
import { openModal } from '../../../shared/js/components/modal.js';
import { toast, toastError } from '../../../shared/js/components/toast.js';
import { alertLevelKey, alertTypeChip, dayLabel, emptyState, isoDay, livePill, onFrame, pageHeading, redBanner } from '../ui.js';

/**
 * Page « Alertes » de la maquette : synthèse, filtres et tableau des alertes, acquittement
 * (POST /api/alerts/{id}/ack). La liste est chargée par REST puis tenue à jour par le flux
 * temps réel (messages « alert » réservés aux opérateurs).
 *
 * ÉCARTS API : pas de commentaire d'acquittement ni de résolution manuelle côté serveur ;
 * une alerte est résolue automatiquement au retour à la normale.
 */

/** Libellés des statuts d'alerte. */
const STATUS_LABELS = { new: 'Nouvelle', acknowledged: 'Acquittée', resolved: 'Résolue' };

/** Nombre d'alertes chargées à l'ouverture de la page (historique récent). */
const ALERTS_LIMIT = 500;

/**
 * Ouvre la confirmation d'acquittement (composant AckModal de la maquette, sans commentaire :
 * l'API n'en enregistre pas).
 * @param {object} alert AlertDto
 * @param {object} ctx contexte de l'application
 */
export function openAckModal(alert, ctx) {
  const user = session.user;
  openModal({
    title: 'Acquitter l’alerte',
    html: `<div class="modal-info">${icon('ShieldCheck', 22)}<p>Vous confirmez avoir pris connaissance de cette alerte.
        L’acquittement sera enregistré au nom de <strong>${esc(user?.fullName || user?.username)}</strong>.</p></div>
      <div class="ack-summary">${badge(alertLevelKey(alert))}<div><strong>${esc(alert.stationName)}</strong>
        <span>${esc(ALERT_TYPES[alert.type] ?? alert.type)} · ${esc(alert.message ?? '')}</span>
        <span>Levée à ${time(alert.raisedAt)} (${esc(dayLabel(alert.raisedAt).toLowerCase())})</span></div></div>
      <p class="red-text" data-error hidden></p>
      <div class="modal-actions"><button type="button" class="button" data-close>Annuler</button>
        <button type="button" class="button primary" data-confirm>${icon('Check', 16)} Confirmer l’acquittement</button></div>`,
    onMount: (root, close) => {
      const confirm = root.querySelector('[data-confirm]');
      const error = root.querySelector('[data-error]');
      confirm.addEventListener('click', async () => {
        if (!ctx.canAct()) {
          error.textContent = 'Hors connexion : l’acquittement sera possible au retour du réseau.';
          error.hidden = false;
          return;
        }
        confirm.disabled = true;
        try {
          ctx.store.upsertAlert(await api(`/alerts/${encodeURIComponent(alert.id)}/ack`, { method: 'POST' }));
          close();
          toast('Alerte acquittée. Merci pour votre vigilance.');
        } catch (e) {
          error.textContent = e.message;
          error.hidden = false;
          confirm.disabled = false;
        }
      });
    },
  });
}

/**
 * Affiche la page des alertes.
 * @param {HTMLElement} main zone principale
 * @param {object} ctx contexte de l'application
 * @returns {() => void} nettoyage
 */
export function mountAlerts(main, ctx) {
  const { store } = ctx;
  const filters = { level: 'all', type: 'all', station: 'all', date: '', status: 'all' };

  main.innerHTML = `${pageHeading({
    eyebrow: 'ESPACE DE PILOTAGE', title: 'Alertes',
    subtitle: 'Centralisez, qualifiez et acquittez les événements de votre réseau.',
    actions: livePill(store.state.live, 'Mise à jour en direct'),
  })}
    <div data-banner></div>
    <div class="summary-strip" data-summary></div>
    <section class="card table-card">
      <div class="table-toolbar"><div class="filters">
        <span>${icon('SlidersHorizontal', 16)}Filtrer</span>
        <select aria-label="Filtrer par niveau" data-f="level"><option value="all">Tous les niveaux</option>
          ${['YELLOW', 'ORANGE', 'RED'].map((l) => `<option value="${l}">${LEVELS[l].label}</option>`).join('')}</select>
        <select aria-label="Filtrer par type" data-f="type"><option value="all">Tous les types</option>
          ${Object.entries(ALERT_TYPES).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
        <select aria-label="Filtrer par station" data-f="station"></select>
        <select aria-label="Filtrer par statut" data-f="status"><option value="all">Tous les statuts</option>
          <option value="new">À acquitter</option><option value="acknowledged">Acquittées</option><option value="resolved">Résolues</option></select>
        <input type="date" aria-label="Filtrer par date" data-f="date">
        <button type="button" class="text-button" data-reset hidden>Réinitialiser</button>
      </div></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Niveau</th><th>Station / Événement</th><th>Heure</th><th>Statut</th><th>Action</th></tr></thead>
        <tbody data-rows></tbody></table>
        <div data-empty></div></div>
      <div class="table-bottom">${icon('ShieldCheck', 14)} Chaque acquittement est enregistré au nom de l’opérateur.
        Les alertes se résolvent automatiquement au retour à la normale.</div>
    </section>`;

  const $ = (sel) => main.querySelector(sel);

  /** Remplit la liste des stations du filtre (en conservant le choix courant). */
  function renderStationOptions() {
    const select = $('[data-f="station"]');
    const codes = new Map([...store.state.stations.values()].map((s) => [s.code, s.name]));
    store.state.alerts.forEach((a) => { if (!codes.has(a.stationCode)) codes.set(a.stationCode, a.stationName); });
    select.innerHTML = `<option value="all">Toutes les stations</option>${[...codes]
      .sort((a, b) => a[1].localeCompare(b[1], 'fr')).map(([code, name]) => `<option value="${esc(code)}">${esc(name)}</option>`).join('')}`;
    select.value = codes.has(filters.station) ? filters.station : 'all';
  }

  /** Bandeau de synthèse (alertes actives, critiques, à acquitter, résolues). */
  function renderSummary() {
    const alerts = store.state.alerts;
    const active = alerts.filter((a) => a.active);
    $('[data-summary]').innerHTML = `
      <span>${icon('BellRing', 17)}<strong>${active.length}</strong> alerte${active.length > 1 ? 's' : ''} active${active.length > 1 ? 's' : ''}</span>
      <span><span class="status-small red"></span><strong>${active.filter((a) => a.level === 'RED').length}</strong> critiques</span>
      <span>${icon('Clock3', 16)}<strong>${active.filter((a) => !a.acknowledgedAt).length}</strong> à acquitter</span>
      <span>${icon('CircleCheck', 16)}${alerts.filter((a) => !a.active).length} résolues</span>`;
  }

  /**
   * Indique si une alerte passe les filtres.
   * @param {object} a AlertDto
   * @returns {boolean} vrai si l'alerte doit être affichée
   */
  const matches = (a) => (filters.level === 'all' || a.level === filters.level)
    && (filters.type === 'all' || a.type === filters.type)
    && (filters.station === 'all' || a.stationCode === filters.station)
    && (filters.status === 'all' || alertStatus(a) === filters.status)
    && (!filters.date || isoDay(a.raisedAt) === filters.date);

  /**
   * Ligne du tableau.
   * @param {object} a AlertDto
   * @returns {string} HTML
   */
  function row(a) {
    const status = alertStatus(a);
    const known = store.state.stations.has(a.stationCode);
    const action = status === 'new'
      ? `<button type="button" class="button" data-ack="${esc(a.id)}" ${ctx.canAct() ? '' : 'disabled title="Indisponible hors connexion"'}>${icon('Check', 14)} Acquitter</button>`
      : status === 'acknowledged' ? `<span class="muted small-text">Résolution automatique</span>`
        : icon('CheckCheck', 17, 'green-text');
    return `<tr data-alert="${esc(a.id)}">
      <td>${badge(alertLevelKey(a))}</td>
      <td>${known ? `<button type="button" class="table-link" data-open-station="${esc(a.stationCode)}">${esc(a.stationName)}</button>`
    : `<span class="table-link">${esc(a.stationName || 'Station supprimée')}</span>`}
        <small>${alertTypeChip(a.type)} ${esc(a.message ?? '')}</small>
        ${a.barrierClosedAt ? `<small class="comment-text">Barrière fermée à ${time(a.barrierClosedAt, true)}${a.barrierReopenedAt ? ` · rouverte à ${time(a.barrierReopenedAt, true)}` : ''}</small>` : ''}</td>
      <td>${time(a.raisedAt)}<small>${esc(dayLabel(a.raisedAt))}</small></td>
      <td><span class="alert-status ${status}"><span></span>${STATUS_LABELS[status]}</span>
        ${a.acknowledgedAt ? `<small>par ${esc(a.acknowledgedBy)} à ${time(a.acknowledgedAt)}</small>` : ''}
        ${a.resolvedAt ? `<small>résolue à ${time(a.resolvedAt)}</small>` : ''}</td>
      <td>${action}</td></tr>`;
  }

  /** Affiche le tableau filtré. */
  function renderRows() {
    const list = store.state.alerts.filter(matches);
    $('[data-rows]').innerHTML = list.map(row).join('');
    $('[data-empty]').innerHTML = list.length ? '' : emptyState(store.state.alerts.length
      ? 'Aucune alerte ne correspond à ces filtres.' : 'Aucune alerte enregistrée sur le réseau.');
    $('[data-reset]').hidden = filters.level === 'all' && filters.type === 'all' && filters.station === 'all' && filters.status === 'all' && !filters.date;
  }

  const render = onFrame(() => {
    $('[data-banner]').innerHTML = redBanner([...store.state.stations.values()]);
    renderSummary();
    renderRows();
  });

  renderStationOptions();
  render();

  // Historique récent (les alertes actives sont déjà dans le store depuis le démarrage).
  api(`/alerts?limit=${ALERTS_LIMIT}`).then((list) => {
    const live = new Map(store.state.alerts.map((a) => [a.id, a]));
    store.setAlerts(list.map((a) => live.get(a.id) ?? a).concat(store.state.alerts.filter((a) => !list.some((x) => x.id === a.id))));
    renderStationOptions();
  }).catch(toastError);

  const unsubscribers = [
    store.subscribe('alerts', render),
    store.subscribe('stations', render),
    store.subscribe('live', (live) => {
      const pill = main.querySelector('[data-live-pill]');
      if (pill) pill.outerHTML = livePill(live, pill.dataset.livePill);
      render();
    }),
  ];

  main.addEventListener('change', (e) => {
    const key = e.target.dataset?.f;
    if (!key) return;
    filters[key] = e.target.value;
    renderRows();
  });
  main.addEventListener('click', (e) => {
    const ack = e.target.closest('[data-ack]');
    if (ack) {
      const alert = store.state.alerts.find((a) => a.id === ack.dataset.ack);
      if (alert) openAckModal(alert, ctx);
    }
    if (e.target.closest('[data-reset]')) {
      Object.assign(filters, { level: 'all', type: 'all', station: 'all', date: '', status: 'all' });
      main.querySelectorAll('[data-f]').forEach((el) => { el.value = filters[el.dataset.f]; });
      renderRows();
    }
  });

  return () => unsubscribers.forEach((fn) => fn());
}

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : pilotage/js/views/stations.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { api } from '../../../shared/js/api.js';
import { STATION_TYPES, esc, levelOf, num } from '../../../shared/js/format.js';
import { icon } from '../../../shared/js/icons.js';
import { badge } from '../../../shared/js/components/badge.js';
import { confirmDialog } from '../../../shared/js/components/modal.js';
import { toast, toastError } from '../../../shared/js/components/toast.js';
import { openStationForm } from '../station-form.js';
import { emptyState, onFrame, pageHeading } from '../ui.js';

/**
 * Page « Stations » de la maquette (administrateurs) : réseau de stations, seuils, création,
 * configuration (PUT avec If-Match), renvoi de la configuration (POST config/publish), suppression.
 */

/**
 * Affiche la page des stations.
 * @param {HTMLElement} main zone principale
 * @param {object} ctx contexte de l'application
 * @returns {() => void} nettoyage
 */
export function mountStations(main, ctx) {
  const { store } = ctx;
  main.innerHTML = `${pageHeading({
    eyebrow: 'ESPACE DE PILOTAGE', title: 'Stations', subtitle: 'Configurez les stations et les seuils de votre réseau.',
    actions: `<button type="button" class="button primary" data-add>${icon('Plus', 16)} Ajouter une station</button>`,
  })}
    <section class="card table-card">
      <div class="table-toolbar"><div><h2>Réseau de stations <span class="neutral-count" data-total></span></h2>
        <p class="muted">Grand Tunis · Configuration et supervision</p></div>
        <span class="sync-label">${icon('CheckCheck', 15)} Toute modification est envoyée à la station (configuration retenue MQTT)</span></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Station</th><th>État</th><th>Hauteur critique</th><th>Seuils J / O / R</th><th>Mesure</th><th>Actions</th></tr></thead>
        <tbody data-rows></tbody></table><div data-empty></div></div>
    </section>`;

  /** Affiche le tableau. */
  const render = onFrame(() => {
    const list = [...store.state.stations.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    main.querySelector('[data-total]').textContent = list.length;
    main.querySelector('[data-rows]').innerHTML = list.map((s) => {
      const t = s.thresholds ?? {};
      return `<tr>
        <td><button type="button" class="table-link" data-open-station="${esc(s.code)}">${esc(s.name)}</button>
          <small><span class="mono">${esc(s.code)}</span> · ${esc(STATION_TYPES[s.type] ?? s.type)}${s.address ? ` · ${esc(s.address)}` : ''}</small></td>
        <td>${badge(levelOf(s))}${s.controlMode === 'MANUAL' ? '<small class="manual-tag">Mode manuel</small>' : ''}</td>
        <td>${num(t.criticalCm)} cm</td>
        <td><span class="threshold-values"><b>${num(t.yellowPct, 0)} %</b> / <b>${num(t.orangePct, 0)} %</b> / <b>${num(t.redPct, 0)} %</b></span></td>
        <td>${t.periodNormalSec ?? '—'} s<small>renforcée ${t.periodWatchSec ?? '—'} s</small></td>
        <td><div class="table-actions">
          <button type="button" class="button" data-edit="${esc(s.code)}">Configurer</button>
          <button type="button" class="icon-button" data-publish="${esc(s.code)}" aria-label="Renvoyer la configuration à ${esc(s.name)}" title="Renvoyer la configuration">${icon('RefreshCw', 15)}</button>
          <button type="button" class="icon-button" data-delete="${esc(s.code)}" aria-label="Supprimer ${esc(s.name)}" title="Supprimer">${icon('Trash2', 15)}</button>
        </div></td></tr>`;
    }).join('');
    main.querySelector('[data-empty]').innerHTML = list.length ? '' : emptyState('Ajoutez une première station pour commencer la supervision.', 'Aucune station');
  });

  /**
   * Supprime une station après confirmation (DELETE /stations/{code}).
   * @param {object} s StationDto
   */
  async function remove(s) {
    const ok = await confirmDialog({
      title: 'Supprimer la station ?', danger: true, confirmLabel: 'Supprimer la station',
      message: `La station « ${s.name} » sera retirée du réseau, avec son historique de mesures. Cette action est irréversible.`,
    });
    if (!ok) return;
    try {
      await api(`/stations/${encodeURIComponent(s.code)}`, { method: 'DELETE' });
      store.applyLive({ type: 'stationDeleted', data: { code: s.code } });
      toast('Station supprimée du réseau.');
    } catch (e) {
      toastError(e);
    }
  }

  main.addEventListener('click', async (e) => {
    if (e.target.closest('[data-add]')) openStationForm(ctx, null);
    const code = e.target.closest('[data-edit],[data-publish],[data-delete]');
    if (!code) return;
    const s = store.state.stations.get(code.dataset.edit ?? code.dataset.publish ?? code.dataset.delete);
    if (!s) return;
    if (code.dataset.edit) openStationForm(ctx, s);
    if (code.dataset.delete) remove(s);
    if (code.dataset.publish) {
      try {
        const r = await api(`/stations/${encodeURIComponent(s.code)}/config/publish`, { method: 'POST' });
        toast(r?.published === false ? 'Broker MQTT indisponible : configuration non envoyée.' : `Configuration renvoyée à « ${s.name} ».`, { kind: r?.published === false ? 'error' : 'info' });
      } catch (err) {
        toastError(err);
      }
    }
  });

  render();
  const unsubscribe = store.subscribe('stations', render);
  return unsubscribe;
}

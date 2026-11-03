/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : pilotage/js/commands.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { api } from '../../shared/js/api.js';
import { CONFIG } from '../../shared/js/config.js';
import { COMMAND_STATES, commandState, esc, time } from '../../shared/js/format.js';
import { icon } from '../../shared/js/icons.js';
import { openModal } from '../../shared/js/components/modal.js';

/**
 * Commandes des actionneurs (composant CommandModal de la maquette), sur le cycle réel du serveur :
 *  1. POST /api/stations/{code}/commands → 202 + CommandDto (statut PENDING), publiée en MQTT ;
 *  2. la station acquitte (ACKED) ou refuse (FAILED + motif), ou le serveur la passe en FAILED
 *     « délai d'acquittement dépassé » après 15 s (contrôle toutes les 5 s, donc 15 à 20 s) ;
 *  3. l'état réel des actionneurs n'arrive que par le message « station » (topic state retenu).
 * Le nouvel état n'est donc JAMAIS affiché comme acquis avant le retour de la station : la
 * modale suit la commande via les messages « command » du WebSocket, et la fiche station
 * n'affiche que l'état remonté par la station.
 */

/** Actionneurs pilotables, valeurs possibles (valeur API → libellés) et lecture de l'état courant. */
export const ACTUATOR_DEFS = {
  barrier: {
    label: 'Barrière',
    options: [['OPEN', 'Ouvrir', 'Ouverte'], ['CLOSE', 'Fermer', 'Fermée']],
    current: (s) => ({ OPEN: 'OPEN', CLOSED: 'CLOSE' }[s.barrier] ?? null),
    unknown: 'Inconnu',
  },
  light: {
    label: 'Feu de signalisation',
    options: [['GREEN', 'Vert', 'Vert'], ['ORANGE', 'Orange', 'Orange'], ['RED', 'Rouge', 'Rouge'], ['OFF', 'Éteint', 'Éteint']],
    current: (s) => (s.light === 'UNKNOWN' ? null : s.light),
    unknown: 'Inconnu',
  },
  siren: {
    label: 'Sirène',
    options: [['ON', 'Activer', 'Activée'], ['OFF', 'Désactiver', 'Désactivée']],
    current: (s) => (s.siren ? 'ON' : 'OFF'),
    unknown: 'Inconnue',
  },
  sampling: {
    label: 'Fréquence de mesure',
    options: [['NORMAL', 'Normale', 'Normale'], ['WATCH', 'Renforcée', 'Renforcée']],
    current: (s) => s.sampling ?? null,
    unknown: 'Inconnue',
  },
};

/**
 * Libellé de l'état d'un actionneur (« Fermée », « Vert »…).
 * @param {string} actuator actionneur
 * @param {string|null} value valeur API
 * @returns {string} libellé
 */
export function stateLabel(actuator, value) {
  const def = ACTUATOR_DEFS[actuator];
  return def.options.find(([v]) => v === value)?.[2] ?? def.unknown;
}

/**
 * Dernière commande récente d'un actionneur d'une station (pour afficher l'attente ou l'échec).
 * @param {Map<string, object>} commands CommandDto par id (store)
 * @param {string} code code de la station
 * @param {string} actuator actionneur
 * @param {number} [withinSec=60] ancienneté maximale
 * @returns {object|null} CommandDto ou null
 */
export function latestCommand(commands, code, actuator, withinSec = 60) {
  let latest = null;
  for (const c of commands.values()) {
    if (c.stationCode !== code || c.actuator !== actuator) continue;
    if (Date.now() - Date.parse(c.issuedAt) > withinSec * 1000) continue;
    if (!latest || Date.parse(c.issuedAt) > Date.parse(latest.issuedAt)) latest = c;
  }
  return latest;
}

/**
 * Ouvre la modale de commande d'un actionneur.
 * @param {object} station StationDto au moment du clic
 * @param {string} actuator 'barrier' | 'light' | 'siren' | 'sampling'
 * @param {string} value valeur API demandée
 * @param {object} ctx contexte de l'application (store, canAct)
 */
export function openCommandModal(station, actuator, value, ctx) {
  const { store } = ctx;
  const def = ACTUATOR_DEFS[actuator];
  const code = station.code;
  const latest = () => store.state.stations.get(code) ?? station;
  let commandId = null;
  let unsubscribe = null;
  let countdown = null;
  let fallback = null;

  /** Arrête le suivi de la commande (fermeture de la modale ou état final). */
  const stopTracking = () => {
    unsubscribe?.();
    unsubscribe = null;
    clearInterval(countdown);
    clearTimeout(fallback);
  };

  /** @returns {string} HTML de l'étape de confirmation */
  function confirmStep() {
    const s = latest();
    const unsafe = actuator === 'barrier' && value === 'OPEN' && s.alertLevel === 'RED' && s.online;
    const toManual = actuator !== 'sampling' && s.controlMode === 'AUTO';
    return `<p>Vous êtes sur le point de commander un équipement de <strong>${esc(s.name)}</strong>.</p>
      <div class="command-summary"><span>${esc(def.label)}</span>
        <strong>${esc(stateLabel(actuator, def.current(s)))} ${icon('ArrowRight', 16)} ${esc(stateLabel(actuator, value))}</strong></div>
      ${unsafe ? `<div class="warning-note">${icon('TriangleAlert', 18)}Ouverture interdite : le niveau d’eau est critique. Attendez le retour sous le seuil rouge.</div>` : ''}
      ${toManual ? `<div class="warning-note info">${icon('Info', 18)}<span>Cette commande fait passer la station en <strong>mode manuel</strong> :
        l’automatisme du Cloud est suspendu jusqu’au retour en mode automatique. La sécurité locale de la station reste active.</span></div>` : ''}
      ${s.localSafety && actuator === 'barrier' ? `<div class="warning-note">${icon('ShieldCheck', 18)}Sécurité locale active : la station a fermé sa barrière d’elle-même et peut refuser l’ouverture.</div>` : ''}
      <p class="red-text command-error" data-error hidden></p>
      <div class="modal-actions"><button type="button" class="button" data-close>Annuler</button>
        <button type="button" class="button primary" data-send ${unsafe ? 'disabled' : ''}>Envoyer la commande ${icon('ArrowRight', 15)}</button></div>`;
  }

  /**
   * Étape de suivi : attente, acquittée, échouée ou expirée.
   * @param {object} command CommandDto
   * @returns {string} HTML
   */
  function progressStep(command) {
    const state = commandState(command);
    const what = `${esc(def.label)} : ${esc(stateLabel(actuator, value))}`;
    if (state === 'pending' || state === 'stale') {
      const elapsed = Math.max(0, Math.round((Date.now() - Date.parse(command.issuedAt)) / 1000));
      return `<div class="command-progress" aria-live="polite"><div class="spinner"></div>
        <h3>Commande envoyée…</h3>
        <p>${state === 'stale' ? 'Toujours sans nouvelle de la station : vérification auprès du serveur.'
    : `En attente de l’acquittement de la station (${elapsed} s / ${CONFIG.commandAckTimeoutSec} s).`}<br>
          <span class="muted">L’état affiché ne change qu’après confirmation par la station.</span></p>
        <button type="button" class="button" data-close>Fermer (le suivi continue sur la fiche)</button></div>`;
    }
    if (state === 'acked') {
      return `<div class="command-progress" aria-live="polite"><span class="success-circle">${icon('CheckCheck', 30)}</span>
        <h3>Confirmée par la station</h3><p>${what}. Acquittée à ${time(command.ackedAt ?? Date.now(), true)}.</p>
        <button type="button" class="button primary" data-close>Terminer</button></div>`;
    }
    return `<div class="command-progress" aria-live="assertive"><span class="failure-circle">${icon(state === 'expired' ? 'Clock3' : 'X', 30)}</span>
      <h3>${state === 'expired' ? 'Aucune réponse de la station' : 'Commande refusée'}</h3>
      <p>${what} · ${esc(COMMAND_STATES[state])}${command.detail ? `<br><span class="muted">Motif : ${esc(command.detail)}</span>` : ''}</p>
      <div class="modal-actions centered"><button type="button" class="button" data-close>Fermer</button>
        <button type="button" class="button primary" data-retry>Réessayer</button></div></div>`;
  }

  const modal = openModal({ title: 'Confirmer la commande', html: confirmStep(), onClose: stopTracking });

  /** Met à jour la modale à partir de la version courante de la commande. */
  function renderProgress() {
    const command = store.state.commands.get(commandId);
    if (!command || modal.closed) return;
    const state = commandState(command);
    const done = state === 'acked' || state === 'failed' || state === 'expired';
    modal.update(progressStep(command), done ? (state === 'acked' ? 'Commande confirmée' : 'Commande non exécutée') : 'Commande en cours');
    if (done) stopTracking();
  }

  /**
   * Repli si le flux temps réel n'apporte pas l'issue (coupure WebSocket) : relit les dernières
   * commandes de la station par REST après l'échéance serveur (15 s + 5 s de contrôle + marge).
   */
  function scheduleFallback() {
    fallback = setTimeout(async () => {
      try {
        store.setCommands(await api(`/stations/${encodeURIComponent(code)}/commands?limit=10`));
      } catch {
        /* le compte à rebours affiche « sans réponse » ; rien d'autre à faire */
      }
      renderProgress();
    }, (CONFIG.commandAckTimeoutSec + 8) * 1000);
  }

  /** Envoie la commande puis suit son statut. */
  async function send() {
    const s = latest();
    const error = modal.root.querySelector('[data-error]');
    const button = modal.root.querySelector('[data-send]');
    const fail = (message) => {
      error.textContent = message;
      error.hidden = false;
      button.disabled = false;
    };
    if (!ctx.canAct()) return fail('Connexion temps réel indisponible : la commande ne peut pas être suivie. Réessayez au retour du réseau.');
    if (!s.online) return fail('La station est hors ligne. La commande ne peut pas être envoyée.');
    button.disabled = true;
    try {
      const command = await api(`/stations/${encodeURIComponent(code)}/commands`, { method: 'POST', body: { actuator, value } });
      commandId = command.id;
      // le message WebSocket « command » a pu arriver avant la réponse : on garde la version la plus avancée
      if (!store.state.commands.has(command.id)) store.upsertCommand(command);
      unsubscribe = store.subscribe('commands', (c) => { if (!c || c.id === commandId) renderProgress(); });
      countdown = setInterval(renderProgress, 1000);
      scheduleFallback();
      renderProgress();
    } catch (e) {
      fail(e.message);
    }
  }

  modal.root.addEventListener('click', (e) => {
    if (e.target.closest('[data-send]')) send();
    if (e.target.closest('[data-retry]')) {
      stopTracking();
      commandId = null;
      modal.update(confirmStep(), 'Confirmer la commande');
    }
  });
}

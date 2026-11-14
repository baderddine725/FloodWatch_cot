/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : shared/js/components/toast.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { esc } from '../format.js';
import { icon } from '../icons.js';

/**
 * Notification éphémère dans la page (classes .toast / .toast.urgent / .toast.error de la maquette).
 */

let current = null;
let timer = null;

/** Ferme le toast affiché. */
export function closeToast() {
  clearTimeout(timer);
  current?.remove();
  current = null;
}

/**
 * Affiche un toast.
 * @param {string} message texte principal
 * @param {object} [options]
 * @param {'info'|'urgent'|'error'} [options.kind='info'] style (urgent : alerte rouge, error : échec d'action)
 * @param {string} [options.title] titre (par défaut selon le style)
 * @param {number} [options.duration=4500] durée d'affichage en ms (0 = jusqu'à fermeture)
 */
export function toast(message, { kind = 'info', title, duration = 4500 } = {}) {
  closeToast();
  const titles = { info: 'Centre de supervision', urgent: 'Nouvel événement critique', error: 'Action impossible' };
  const icons = { info: 'CircleCheck', urgent: 'Volume2', error: 'TriangleAlert' };
  const el = document.createElement('div');
  el.className = `toast ${kind === 'info' ? '' : kind}`.trim();
  el.setAttribute('role', kind === 'info' ? 'status' : 'alert');
  el.innerHTML = `<span>${icon(icons[kind], 20)}</span>
    <div><strong>${esc(title ?? titles[kind])}</strong><p>${esc(message)}</p></div>
    <button type="button" aria-label="Fermer la notification">${icon('X', 16)}</button>`;
  el.querySelector('button').addEventListener('click', closeToast);
  document.body.append(el);
  current = el;
  if (duration) timer = setTimeout(closeToast, duration);
}

/**
 * Raccourci pour signaler l'échec d'une action.
 * @param {Error|string} error erreur (ApiError : message déjà en français)
 */
export function toastError(error) {
  toast(typeof error === 'string' ? error : error.message, { kind: 'error', duration: 6000 });
}

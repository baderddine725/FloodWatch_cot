/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : shared/js/components/modal.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { esc } from '../format.js';
import { icon } from '../icons.js';

/**
 * Fenêtre modale accessible (reprise du composant Modal de la maquette) : piège du focus,
 * fermeture par Échap, clic hors fenêtre ou bouton, restauration du focus à la fermeture.
 */

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';

/**
 * Ouvre une modale.
 * @param {object} options
 * @param {string} options.title titre (également nom accessible)
 * @param {string} options.html contenu HTML (déjà échappé par l'appelant)
 * @param {boolean} [options.wide=false] largeur étendue (.modal.wide)
 * @param {(root: HTMLElement, close: () => void) => void} [options.onMount] branche les événements du contenu
 * @param {() => void} [options.onClose] appelé après la fermeture
 * @returns {{root: HTMLElement, close: () => void, update: (html: string, title?: string) => void, closed: boolean}} la modale ouverte
 */
export function openModal({ title, html, wide = false, onMount, onClose }) {
  const previousFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${esc(title)}</h2>
      <button type="button" class="icon-button" data-close aria-label="Fermer" title="Fermer">${icon('X', 20)}</button></header>
    ${html}</section>`;
  const dialog = backdrop.firstElementChild;
  let closed = false;

  /** Ferme la modale et restaure le focus. */
  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey);
    backdrop.remove();
    previousFocus?.focus?.();
    onClose?.();
  };

  /**
   * Gère Échap et le piège du focus (Tab / Maj+Tab).
   * @param {KeyboardEvent} e événement clavier
   */
  function onKey(e) {
    if (e.key === 'Escape') close();
    if (e.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) close();
  });
  window.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  onMount?.(dialog, close);
  (dialog.querySelector('[autofocus]') ?? dialog.querySelectorAll(FOCUSABLE)[1] ?? dialog.querySelector(FOCUSABLE))?.focus();
  /**
   * Remplace le contenu de la modale (étapes successives d'une même action).
   * @param {string} newHtml nouveau contenu HTML (déjà échappé par l'appelant)
   * @param {string} [newTitle] nouveau titre
   */
  const update = (newHtml, newTitle) => {
    if (closed) return;
    const header = dialog.querySelector(':scope > header');
    while (header.nextSibling) header.nextSibling.remove();
    header.insertAdjacentHTML('afterend', newHtml);
    if (newTitle) {
      header.querySelector('h2').textContent = newTitle;
      dialog.setAttribute('aria-label', newTitle);
    }
  };

  return { root: dialog, close, update, get closed() { return closed; } };
}

/**
 * Demande de confirmation (remplace window.confirm, avec le style de l'application).
 * @param {object} options
 * @param {string} options.title titre
 * @param {string} options.message texte (échappé ici)
 * @param {string} [options.confirmLabel='Confirmer'] libellé du bouton de validation
 * @param {boolean} [options.danger=false] bouton de validation en rouge
 * @returns {Promise<boolean>} vrai si l'utilisateur confirme
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    openModal({
      title,
      html: `<p>${esc(message)}</p>
        <div class="modal-actions"><button type="button" class="button" data-close>Annuler</button>
        <button type="button" class="button ${danger ? 'danger' : 'primary'}" data-confirm>${esc(confirmLabel)}</button></div>`,
      onMount: (root, close) => root.querySelector('[data-confirm]').addEventListener('click', () => { answer = true; close(); }),
      onClose: () => resolve(answer),
    });
  });
}

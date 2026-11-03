/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : citoyen/js/views/onboarding.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { esc } from '../../../shared/js/format.js';
import { icon } from '../../../shared/js/icons.js';
import { locate } from '../../../shared/js/platform.js';
import { pushSupport } from '../../../shared/js/push.js';
import { subscribeCitizen } from '../notifications.js';
import { savePrefs } from '../preferences.js';
import { brand } from '../ui.js';

/**
 * Parcours d'accueil (composant Onboarding de la maquette) : présentation, autorisation de
 * géolocalisation, puis abonnement réel aux notifications Web Push (position et rayon).
 * Chaque étape peut être passée : l'application reste consultable sans compte ni autorisation.
 */

/** Contenu des trois écrans. */
const PAGES = [
  {
    eyebrow: 'VOTRE SÉCURITÉ, NOTRE PRIORITÉ', title: 'Les bons réflexes.<br>Avant de prendre la route.',
    copy: 'Repérez les routes inondées, anticipez les risques et déplacez-vous plus sereinement dans le Grand Tunis.',
    main: 'ShieldCheck', float: 'Waves',
  },
  {
    eyebrow: 'LES BONNES INFORMATIONS, AU BON ENDROIT', title: 'Les risques autour de vous,<br>pas à l’autre bout de la ville.',
    copy: 'Votre position permet de trouver les points de vigilance les plus proches. Elle reste sur votre appareil.',
    main: 'MapPin', float: 'Navigation',
  },
  {
    eyebrow: 'UNE LONGUEUR D’AVANCE', title: 'Quand la situation change,<br>restez informé.',
    copy: 'Recevez les alertes orange et rouge à proximité, même application fermée.',
    main: 'BellRing', float: 'TriangleAlert',
  },
];

/**
 * Affiche le parcours d'accueil.
 * @param {HTMLElement} root conteneur de l'application
 * @param {() => void} onDone appelé à la fin (ou si le citoyen passe)
 */
export function renderOnboarding(root, onDone) {
  let step = 0;
  let message = '';
  let busy = false;
  let touchX = 0;

  /** Termine le parcours. */
  const finish = () => {
    savePrefs({ onboarded: true });
    onDone();
  };

  /** Dessine l'étape courante. */
  function render() {
    const page = PAGES[step];
    const action = step === 0 ? `<button type="button" class="c-button" data-next>C’est parti ${icon('ArrowRight', 18)}</button>`
      : `<button type="button" class="c-button" data-allow ${busy ? 'disabled' : ''}>${busy ? 'Demande en cours…'
        : step === 1 ? `${icon('LocateFixed', 18)} Activer ma position` : `${icon('Bell', 18)} Autoriser les notifications`}</button>
        <button type="button" class="c-text-action" data-skip-step>${step === 1 ? 'Continuer sans localisation' : 'Découvrir la carte'} ${icon('ArrowRight', 15)}</button>`;
    root.innerHTML = `<div class="citizen-shell"><div class="c-onboarding">
      <header>${brand()}<button type="button" class="c-skip" data-finish>Passer ${icon('ArrowRight', 15)}</button></header>
      <div class="c-onboarding-slides">
        <div class="c-permission-art step-${step}"><div class="c-orbit orbit-1"></div><div class="c-orbit orbit-2"></div><div class="c-orbit orbit-3"></div>
          <span class="c-permission-main">${icon(page.main, 65).replace('stroke-width="2"', 'stroke-width="1.4"')}</span>
          <span class="c-art-float float-one">${icon(page.float, 22)}</span><span class="c-art-float float-two">${icon('Check', 20)}</span></div>
        <div class="c-onboarding-copy"><span class="c-eyebrow">${page.eyebrow}</span><h1>${page.title}</h1><p>${page.copy}</p>
          ${message ? `<div class="c-permission-result" role="status">${icon('Info', 16)}${esc(message)}</div>` : ''}</div>
      </div>
      <div class="c-onboarding-bottom">
        <div class="c-slide-dots">${PAGES.map((_, i) => `<button type="button" data-step="${i}" aria-label="Étape ${i + 1}"
          ${i === step ? 'aria-current="step" class="active"' : ''}></button>`).join('')}</div>
        ${action}
        <p class="c-onboarding-note">${icon('ShieldCheck', 13)} Un service de prévention, pas une garantie de passage.</p>
      </div></div></div>`;
  }

  /**
   * Change d'étape.
   * @param {number} next numéro de l'étape
   */
  const go = (next) => {
    step = Math.max(0, Math.min(PAGES.length - 1, next));
    message = '';
    render();
  };

  /** Demande l'autorisation de l'étape courante (position ou notifications). */
  async function allow() {
    busy = true;
    render();
    if (step === 1) {
      try {
        const p = await locate();
        savePrefs({ position: { lat: p.latitude, lng: p.longitude, source: 'device' } });
        message = 'Position activée. Elle reste sur votre appareil.';
      } catch (e) {
        message = `${e.message} Le centre de Tunis sera utilisé comme point de référence.`;
      }
    } else {
      const support = pushSupport();
      if (!support.supported) {
        message = support.reason;
      } else {
        try {
          await subscribeCitizen();
          message = 'Notifications activées : alertes orange et rouge dans votre rayon.';
        } catch (e) {
          message = `${e.message} Les alertes restent consultables dans l’application.`;
        }
      }
    }
    busy = false;
    render();
  }

  root.addEventListener('click', function onClick(e) {
    if (!root.querySelector('.c-onboarding')) {
      root.removeEventListener('click', onClick);
      return;
    }
    if (e.target.closest('[data-finish]')) finish();
    else if (e.target.closest('[data-next]')) go(1);
    else if (e.target.closest('[data-allow]')) allow();
    else if (e.target.closest('[data-skip-step]')) { if (step === 1) go(2); else finish(); }
    else if (e.target.closest('[data-step]')) go(Number(e.target.closest('[data-step]').dataset.step));
  });
  root.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  root.addEventListener('touchend', (e) => {
    if (!root.querySelector('.c-onboarding')) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 45 && !busy) go(step + (dx < 0 ? 1 : -1));
  });
  render();
}

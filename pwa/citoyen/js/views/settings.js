/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : citoyen/js/views/settings.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { esc } from '../../../shared/js/format.js';
import { icon } from '../../../shared/js/icons.js';
import { locate } from '../../../shared/js/platform.js';
import { pushEnabled, pushSupport } from '../../../shared/js/push.js';
import { badge } from '../../../shared/js/components/badge.js';
import { refreshSubscription, subscribeCitizen, unsubscribeCitizen } from '../notifications.js';
import { RADIUS, savePrefs } from '../preferences.js';
import { pageTitle, toggle } from '../ui.js';

/**
 * Onglet « Paramètres » de la maquette : rayon d'alerte, notifications Web Push, position.
 *
 * ÉCART MAQUETTE / SERVEUR : la maquette laissait choisir les niveaux notifiés (jaune, orange,
 * rouge). Le serveur n'envoie aux citoyens que l'orange, le rouge et la fin du rouge, sans
 * réglage possible : l'écran présente donc cette règle (lecture seule) et un seul interrupteur
 * d'abonnement. Ajouter un choix des niveaux demanderait un champ « levels » côté back-end.
 * Le bouton « Simuler hors connexion » de la maquette est retiré : le mode hors connexion est réel.
 */

/** Ce que le serveur notifie au public (PushManager). */
const NOTIFIED = [
  ['YELLOW', false, 'Affichée dans l’application uniquement'],
  ['ORANGE', true, 'Notification dans votre rayon'],
  ['RED', true, 'Notification dans votre rayon, puis fin d’alerte'],
];

/**
 * Affiche l'onglet Paramètres.
 * @param {HTMLElement} content zone de contenu
 * @param {object} ctx contexte de l'application
 * @returns {() => void} nettoyage
 */
export function mountSettings(content, ctx) {
  let subscribed = false;
  let busy = false;
  let about = false;
  let destroyed = false;

  /** Dessine la page. */
  function render() {
    const { radiusKm, position } = ctx.prefs;
    const support = pushSupport();
    content.innerHTML = `<div class="c-page c-settings">
      ${pageTitle('UNE VIGILANCE À VOTRE MESURE', 'Paramètres', 'Gardez le contrôle sur les informations reçues.', icon('Settings', 22))}
      <section class="c-panel c-radius-settings">
        <h2>${icon('LocateFixed', 19)}Mon rayon d’alerte <strong data-radius-value>${radiusKm} km</strong></h2>
        <p>Être informé des risques autour de ma position.</p>
        <input type="range" aria-label="Rayon d’alerte en kilomètres" min="${RADIUS.min}" max="${RADIUS.max}" step="1" value="${radiusKm}" data-radius>
        <div class="c-range-labels"><span>${RADIUS.min} km</span><span>${RADIUS.max} km</span></div>
      </section>
      <section class="c-panel c-notification-settings">
        <h2>${icon('Bell', 19)}Mes notifications</h2>
        <div class="c-toggle-row"><span><strong>Recevoir les alertes</strong></span>
          ${toggle({ checked: subscribed, label: 'Recevoir les alertes sur cet appareil', action: 'push', disabled: busy || !support.supported || !navigator.onLine })}</div>
        <p>${!navigator.onLine ? 'Hors connexion : l’abonnement pourra être modifié au retour du réseau.' : support.supported ? (subscribed ? 'Actives sur cet appareil, même application fermée.' : 'Désactivées : les alertes restent visibles dans l’application ouverte.')
    : esc(support.reason)}</p>
        ${NOTIFIED.map(([level, on, text]) => `<div class="c-toggle-row c-rule-row">${badge(level)}
          <span class="c-rule ${on ? 'on' : ''}">${icon(on ? 'Check' : 'Minus', 14)}${esc(text)}</span></div>`).join('')}
      </section>
      <section class="c-panel c-position-settings">
        <h2>${icon('MapPin', 19)}Ma position</h2>
        <p>${position.source === 'device' ? 'Position de l’appareil · transmise au serveur seulement pour filtrer vos notifications'
    : 'Position par défaut · centre de Tunis'}</p>
        <button type="button" data-locate ${busy ? 'disabled' : ''}>${icon('LocateFixed', 17)} Actualiser ma position ${icon('ChevronRight', 17)}</button>
      </section>
      <button type="button" class="c-about-button" data-about>${icon('Info', 20)}<span>À propos de FloodWatch</span>${icon('ChevronRight', 18)}</button>
      <a class="c-about-button" href="/pilotage/">${icon('LayoutGrid', 20)}<span>Espace opérateurs (Pilotage)</span>${icon('ChevronRight', 18)}</a>
      <div class="c-settings-footer">${icon('ShieldCheck', 20)}<strong>Ensemble, anticipons les crues.</strong><span>FloodWatch Citoyen · Version 1.0</span></div>
    </div>
    ${about ? `<div class="c-about-backdrop" data-about-close><section class="c-about-dialog" role="dialog" aria-modal="true" aria-label="À propos de FloodWatch">
      <button type="button" class="c-about-close" aria-label="Fermer" data-about-close>${icon('X', 22)}</button>${icon('ShieldCheck', 40)}
      <h2>Anticiper. Protéger. Agir.</h2>
      <p>FloodWatch Citoyen est le compagnon public de FloodWatch Pilotage. Les deux espaces partagent les mêmes stations et alertes dans le Grand Tunis.</p>
      <p>Les informations proviennent des stations de mesure en temps réel. Elles ne remplacent ni la signalisation routière, ni les consignes des autorités.</p>
      <a href="tel:198">${icon('Phone', 18)} Protection civile : 198</a>
      <button type="button" class="c-button" data-about-close>C’est compris ${icon('Check', 17)}</button></section></div>` : ''}`;
    if (about) content.querySelector('.c-about-close')?.focus();
  }

  /** Lit l'état réel de l'abonnement push de l'appareil. */
  async function readSubscription() {
    subscribed = await pushEnabled();
    if (!destroyed) render();
  }

  /** Active ou désactive les notifications. */
  async function togglePush() {
    busy = true;
    render();
    try {
      if (subscribed) {
        await unsubscribeCitizen();
        ctx.notice('Notifications désactivées sur cet appareil.');
      } else {
        await subscribeCitizen();
        ctx.notice(`Notifications activées : alertes orange et rouge à moins de ${ctx.prefs.radiusKm} km.`);
      }
    } catch (e) {
      ctx.notice(e.message);
    }
    busy = false;
    await readSubscription();
  }

  /** Met à jour la position puis l'abonnement. */
  async function updatePosition() {
    busy = true;
    render();
    try {
      const p = await locate();
      savePrefs({ position: { lat: p.latitude, lng: p.longitude, source: 'device' } });
      await refreshSubscription().catch(() => false);
      ctx.notice('Votre position a été mise à jour.');
    } catch (e) {
      ctx.notice(`${e.message} ${ctx.prefs.position.source === 'device' ? 'La dernière position connue reste utilisée.' : 'Le centre de Tunis reste utilisé.'}`);
    }
    busy = false;
    render();
    ctx.updateBadges();
  }

  content.addEventListener('input', (e) => {
    if (!e.target.matches('[data-radius]')) return;
    savePrefs({ radiusKm: Number(e.target.value) });
    content.querySelector('[data-radius-value]').textContent = `${e.target.value} km`;
    ctx.updateBadges();
  });
  content.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-radius]')) return;
    if (await refreshSubscription().catch(() => false)) ctx.notice(`Rayon des notifications : ${e.target.value} km.`);
  });
  content.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="push"]')) togglePush();
    if (e.target.closest('[data-locate]')) updatePosition();
    if (e.target.closest('[data-about]')) { about = true; render(); }
    if (e.target.closest('[data-about-close]') && (e.target.closest('button') || e.target.matches('.c-about-backdrop'))) { about = false; render(); }
  });
  /**
   * Échap ferme la fenêtre « À propos ».
   * @param {KeyboardEvent} e événement clavier
   */
  const onKey = (e) => { if (e.key === 'Escape' && about) { about = false; render(); } };
  window.addEventListener('keydown', onKey);

  render();
  readSubscription();
  const unsubscribe = ctx.store.subscribe('live', () => { if (!busy && !about) render(); });
  return () => {
    destroyed = true;
    unsubscribe();
    window.removeEventListener('keydown', onKey);
  };
}

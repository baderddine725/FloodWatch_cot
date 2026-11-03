/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : citoyen/js/views/alerts.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { LEVELS, esc, levelOf, time } from '../../../shared/js/format.js';
import { icon } from '../../../shared/js/icons.js';
import { badge } from '../../../shared/js/components/badge.js';
import { distanceText, distanceTo, pageTitle } from '../ui.js';

/**
 * Onglet « Alertes » de la maquette.
 *
 * ÉCART API : GET /api/alerts et les messages WebSocket « alert » sont réservés aux opérateurs.
 * Pour le public, les alertes sont donc DÉDUITES de l'état des stations (niveau d'alerte, route
 * fermée, station hors ligne) calculé par le serveur, dans le rayon choisi par le citoyen.
 * Aucune règle métier n'est recalculée : seul l'état public est présenté.
 */

/**
 * Situations à signaler dans le rayon : toute station qui n'est pas « normale et praticable ».
 * @param {object} store store de l'application
 * @param {import('../preferences.js').CitizenPrefs} prefs préférences
 * @returns {object[]} StationDto concernés, les plus graves d'abord
 */
export function nearbyAlerts(store, prefs) {
  return [...store.state.stations.values()]
    .filter((s) => distanceTo(prefs.position, s) <= prefs.radiusKm)
    .filter((s) => !s.online || !s.roadOpen || s.alertLevel !== 'GREEN')
    .sort((a, b) => (b.roadOpen ? 0 : 10) - (a.roadOpen ? 0 : 10) || LEVELS[levelOf(b)].rank - LEVELS[levelOf(a)].rank
      || distanceTo(prefs.position, a) - distanceTo(prefs.position, b));
}

/**
 * Carte d'une situation (c-feed-card de la maquette).
 * @param {object} s StationDto
 * @param {{lat: number, lng: number}} position position de référence
 * @returns {string} HTML
 */
function feedCard(s, position) {
  const level = levelOf(s);
  const closed = s.online && !s.roadOpen;
  const css = closed ? 'red' : LEVELS[level].css;
  const title = !s.online ? ' : information indisponible' : closed ? ' fermée'
    : level === 'ORANGE' ? ' : montée des eaux' : ' : vigilance renforcée';
  const text = !s.online ? 'Les dernières mesures ne peuvent pas être confirmées.'
    : closed ? 'Ne vous engagez pas. Choisissez un autre itinéraire.' : 'Les conditions évoluent. Restez attentif à la signalisation.';
  return `<button type="button" class="c-feed-card ${css}" data-open="${esc(s.code)}">
    <div class="c-feed-top">${badge(closed ? 'RED' : level, closed && level !== 'RED' ? 'Route fermée' : undefined)}
      <span>Mis à jour à ${time(s.online ? s.lastMeasurementAt ?? s.lastSeenAt : s.lastSeenAt)}</span></div>
    <h2>${esc(s.name)}${title}</h2><p>${text}</p>
    <div class="c-feed-bottom"><span>${icon('MapPin', 13)}${distanceText(distanceTo(position, s))} de vous${s.address ? ` · ${esc(s.address)}` : ''}</span>${icon('ChevronRight', 17)}</div></button>`;
}

/**
 * Affiche l'onglet Alertes.
 * @param {HTMLElement} content zone de contenu
 * @param {object} ctx contexte de l'application
 * @returns {() => void} nettoyage
 */
export function mountAlerts(content, ctx) {
  /** Dessine la page. */
  function render() {
    const prefs = ctx.prefs;
    const list = nearbyAlerts(ctx.store, prefs);
    content.innerHTML = `<div class="c-page c-alerts-page">
      ${pageTitle('LES BONNES INFORMATIONS, AU BON MOMENT', 'Vos alertes', 'Restez informé des changements autour de vous.',
    `<span class="c-live ${ctx.store.state.live === 'open' ? '' : 'paused'}"><span></span>${ctx.store.state.live === 'open' ? 'En direct' : 'Reconnexion…'}</span>`)}
      <button type="button" class="c-radius-note" data-goto-settings>${icon('LocateFixed', 17)}
        <span>Dans un rayon de <strong>${prefs.radiusKm} km</strong></span>${icon('Settings', 16)}</button>
      <div class="c-feed-label">SITUATIONS EN COURS<span>${list.length} alerte${list.length > 1 ? 's' : ''}</span></div>
      ${list.length ? list.map((s) => feedCard(s, prefs.position)).join('') : `<div class="c-empty">${icon('ShieldCheck', 45)}
        <h2>Aucune alerte à proximité</h2><p>Vous serez informé des changements dans votre rayon de surveillance.</p>
        <button type="button" class="c-button secondary" data-goto-settings>Ajuster mon rayon ${icon('ArrowRight', 17)}</button></div>`}
      <p class="c-data-disclaimer">Alertes calculées en temps réel par la plateforme FloodWatch, autour
        ${prefs.position.source === 'device' ? 'de votre position' : 'du centre de Tunis (position par défaut)'}. La signalisation sur place fait foi.</p>
    </div>`;
  }

  content.addEventListener('click', (e) => { if (e.target.closest('[data-goto-settings]')) ctx.goTab('settings'); });
  render();
  const unsubscribe = [ctx.store.subscribe('stations', render), ctx.store.subscribe('live', render)];
  return () => unsubscribe.forEach((fn) => fn());
}

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : citoyen/js/views/favorites.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { esc } from '../../../shared/js/format.js';
import { icon } from '../../../shared/js/icons.js';
import { toggleFavorite } from '../preferences.js';
import { distanceTo, filledIcon, pageTitle, pointRow } from '../ui.js';

/**
 * Onglet « Favoris » de la maquette : points des trajets quotidiens, mémorisés sur l'appareil
 * (localStorage) et mis à jour en direct par le WebSocket.
 */

/**
 * Affiche l'onglet Favoris.
 * @param {HTMLElement} content zone de contenu
 * @param {object} ctx contexte de l'application
 * @returns {() => void} nettoyage
 */
export function mountFavorites(content, ctx) {
  /** Dessine la page. */
  function render() {
    const { position, favorites: codes } = ctx.prefs;
    const favorites = codes.map((c) => ctx.store.state.stations.get(c)).filter(Boolean)
      .sort((a, b) => distanceTo(position, a) - distanceTo(position, b));
    const live = ctx.store.state.live === 'open';
    content.innerHTML = `<div class="c-page">
      ${pageTitle('VOS TRAJETS DU QUOTIDIEN', 'Vos favoris', 'Les points qui comptent pour vous, en un coup d’œil.',
    `<span class="c-favorite-counter">${icon('Heart', 17)}${favorites.length}</span>`)}
      ${favorites.length ? `<div class="c-favorites-list">${favorites.map((s) => `<div class="c-favorite-card">${pointRow(s, position, true)}
          <div class="c-favorite-card-bottom"><span>${icon('Clock3', 12)} ${live ? 'État actualisé en direct' : 'Dernière mise à jour <span data-ago="' + esc(s.lastSeenAt ?? '') + '"></span>'}</span>
            <button type="button" aria-label="Retirer ${esc(s.name)} des favoris" data-unfavorite="${esc(s.code)}">${filledIcon('Heart', 17)}</button></div></div>`).join('')}</div>
        <button type="button" class="c-add-favorite" data-goto-map>${icon('Map', 20)} Trouver un autre point sur la carte ${icon('ArrowRight', 17)}</button>`
    : `<div class="c-empty"><span class="c-empty-icon">${icon('Heart', 37)}</span><h2>Vos routes, à portée de main.</h2>
        <p>Ajoutez les points de vos trajets quotidiens pour retrouver leur état en un instant.</p>
        <button type="button" class="c-button" data-goto-map>${icon('Map', 18)} Explorer la carte</button></div>`}
      <div class="c-favorite-tip">${icon('ShieldCheck', 20)}<p>Un point en favori ne garantit pas un passage sûr. Vérifiez toujours les conditions avant votre départ.</p></div>
    </div>`;
    ctx.refreshAgo(content);
  }

  content.addEventListener('click', (e) => {
    const remove = e.target.closest('[data-unfavorite]');
    if (remove) {
      toggleFavorite(remove.dataset.unfavorite);
      ctx.notice('Point retiré de vos favoris.');
      render();
    }
    if (e.target.closest('[data-goto-map]')) ctx.goTab('map');
  });
  render();
  const unsubscribe = [ctx.store.subscribe('stations', render), ctx.store.subscribe('live', render)];
  return () => unsubscribe.forEach((fn) => fn());
}

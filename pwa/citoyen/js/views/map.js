/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : citoyen/js/views/map.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { LEVELS } from '../../../shared/js/format.js';
import { icon } from '../../../shared/js/icons.js';
import { badge } from '../../../shared/js/components/badge.js';
import { createMap } from '../../../shared/js/components/map.js';
import { distanceTo, pointRow } from '../ui.js';

/**
 * Onglet « Carte » de la maquette : carte des points surveillés (Leaflet + OpenStreetMap),
 * recherche, routes fermées à proximité, légende et feuille « Autour de vous » triée par distance.
 */

/**
 * Affiche l'onglet Carte.
 * @param {HTMLElement} content zone de contenu
 * @param {object} ctx contexte de l'application
 * @returns {() => void} nettoyage
 */
export function mountMap(content, ctx) {
  const { store } = ctx;
  let search = '';
  let expanded = false;
  let legend = false;
  let touchY = 0;

  content.innerHTML = `<div class="c-map-home">
    <div class="map" data-map></div>
    <div class="c-map-top">
      <div class="c-map-search">${icon('Search', 20)}
        <input aria-label="Rechercher une route ou une station" placeholder="Où allez-vous ?" autocomplete="off" data-search>
        <span data-search-icon>${icon('MapPin', 15)}</span>
        <button type="button" aria-label="Effacer la recherche" data-clear hidden>${icon('X', 19)}</button></div>
      <div class="c-map-context"><span>${icon('MapPin', 13)} Grand Tunis</span><span data-live><span></span>En direct</span></div>
      <div data-closed></div>
    </div>
    <div class="c-floating-map-actions">
      <button type="button" class="c-legend-toggle" data-legend aria-expanded="false">
        <span class="c-road-line"></span><span>Praticable</span><span class="c-road-line closed"></span><span>Fermée</span>${icon('Info', 15)}</button>
      <button type="button" class="c-locate" aria-label="Recentrer sur ma position" data-locate>${icon('LocateFixed', 21)}</button>
    </div>
    <div data-legend-box></div>
    <section class="c-nearby-sheet" aria-label="Points surveillés à proximité" data-sheet>
      <button type="button" class="c-sheet-handle" data-expand aria-expanded="false" aria-label="Afficher tous les points à proximité"><span></span></button>
      <div class="c-sheet-heading"><div><h1><span data-sheet-title>Autour de vous</span><span data-sheet-count>0</span></h1><p data-sheet-origin></p></div>
        <button type="button" data-expand aria-label="Développer la liste">${icon('ChevronUp', 20)}</button></div>
      <div class="c-nearby-list" data-list></div>
      <button type="button" class="c-see-all" data-see-all data-expand></button>
    </section>
  </div>`;

  const $ = (sel) => content.querySelector(sel);
  const map = createMap($('[data-map]'), { popup: false, region: false, onSelect: (s) => s && ctx.openStation(s.code) });

  /**
   * Stations triées par distance, filtrées par la recherche.
   * @returns {object[]} StationDto
   */
  function visibleStations() {
    const { position } = ctx.prefs;
    const q = search.toLocaleLowerCase('fr');
    return [...store.state.stations.values()]
      .filter((s) => !q || s.name.toLocaleLowerCase('fr').includes(q) || (s.address ?? '').toLocaleLowerCase('fr').includes(q))
      .sort((a, b) => distanceTo(position, a) - distanceTo(position, b));
  }

  /** Met à jour carte, bandeau des routes fermées et liste. */
  function render() {
    const { position, radiusKm } = ctx.prefs;
    const list = visibleStations();
    map.update(list);
    map.setPosition(position.lat, position.lng, radiusKm);

    const closed = [...store.state.stations.values()].filter((s) => s.online && !s.roadOpen && distanceTo(position, s) <= radiusKm);
    $('[data-closed]').innerHTML = closed.length ? `<button type="button" class="c-map-alert" data-goto-alerts>${icon('TriangleAlert', 17)}
      <span><strong>${closed.length} route${closed.length > 1 ? 's' : ''} fermée${closed.length > 1 ? 's' : ''}</strong> à proximité</span>${icon('ChevronRight', 16)}</button>` : '';

    $('[data-sheet]').classList.toggle('expanded', expanded);
    content.querySelectorAll('[data-expand]').forEach((b) => b.setAttribute('aria-expanded', String(expanded)));
    $('[data-sheet-title]').textContent = search ? 'Résultats de recherche' : 'Autour de vous';
    $('[data-sheet-count]').textContent = list.length;
    $('[data-sheet-origin]').textContent = position.source === 'device' ? 'Depuis votre position actuelle' : 'Depuis le centre de Tunis · Position par défaut';
    const favorites = ctx.prefs.favorites;
    $('[data-list]').innerHTML = list.slice(0, expanded ? undefined : 2).map((s) => pointRow(s, position, favorites.includes(s.code))).join('')
      || `<div class="c-empty-small">${icon('Search', 25)}<p>${store.state.stations.size ? 'Aucun point trouvé. Essayez un autre nom.' : 'Aucun point surveillé pour le moment.'}</p></div>`;
    const seeAll = $('[data-see-all]');
    seeAll.hidden = expanded;
    seeAll.innerHTML = `Voir les ${list.length} points surveillés ${icon('ArrowRight', 15)}`;
    $('[data-live]').classList.toggle('paused', store.state.live !== 'open');
  }

  /** Affiche ou masque la légende des niveaux. */
  function renderLegend() {
    $('[data-legend]').setAttribute('aria-expanded', String(legend));
    $('[data-legend-box]').innerHTML = legend ? `<div class="c-map-legend"><div><strong>Niveaux de vigilance</strong>
      <button type="button" aria-label="Fermer la légende" data-legend>${icon('X', 17)}</button></div>
      ${Object.keys(LEVELS).map((l) => badge(l, l === 'RED' ? 'Fermé : ne pas s’engager' : LEVELS[l].citizen)).join('')}
      <p>Une route est fermée quand sa barrière est baissée ou que le niveau atteint le seuil rouge. La signalisation sur place reste prioritaire.</p></div>` : '';
  }

  const searchInput = $('[data-search]');
  searchInput.addEventListener('input', () => {
    search = searchInput.value.trim();
    expanded = !!search;
    $('[data-clear]').hidden = !search;
    $('[data-search-icon]').hidden = !!search;
    render();
  });

  content.addEventListener('click', (e) => {
    if (e.target.closest('[data-clear]')) {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));
    }
    if (e.target.closest('[data-expand]')) {
      expanded = !expanded;
      render();
    }
    if (e.target.closest('[data-legend]')) {
      legend = !legend;
      renderLegend();
    }
    if (e.target.closest('[data-goto-alerts]')) ctx.goTab('alerts');
    if (e.target.closest('[data-locate]')) {
      map.fit();
      ctx.notice(ctx.prefs.position.source === 'device' ? 'Carte recentrée sur votre position.'
        : 'Position par défaut : centre de Tunis. Vous pouvez activer votre position dans les paramètres.');
    }
  });
  const handle = $('.c-sheet-handle');
  handle.addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
  handle.addEventListener('touchend', (e) => {
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dy) > 25) {
      expanded = dy < 0;
      render();
    }
  });

  render();
  requestAnimationFrame(() => { map.invalidate(); map.fit(); });
  const unsubscribe = [store.subscribe('stations', render), store.subscribe('live', render)];
  return () => {
    unsubscribe.forEach((fn) => fn());
    map.destroy();
  };
}

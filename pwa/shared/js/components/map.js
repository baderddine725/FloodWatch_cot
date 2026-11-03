/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : shared/js/components/map.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { LEVELS, esc, levelOf, num } from '../format.js';
import { icon } from '../icons.js';

/**
 * Carte des stations : Leaflet 1.9.4 servi localement (shared/vendor/leaflet, chargé par
 * une balise <script> classique qui expose window.L) et tuiles OpenStreetMap.
 * Les marqueurs reprennent le style de la maquette (.map-marker.<niveau> > .marker-core).
 */

/** Centre par défaut : Grand Tunis. */
const DEFAULT_CENTER = [36.84, 10.19];

/**
 * HTML d'un marqueur de station (style de la maquette).
 * @param {object} station StationDto
 * @returns {string} HTML du marqueur
 */
function markerHtml(station) {
  const level = levelOf(station);
  return `<span class="map-marker ${LEVELS[level].css}" aria-hidden="true">
    <span class="marker-core">${station.online ? icon('Waves', 15) : icon('WifiOff', 14)}</span></span>`;
}

/**
 * Crée une carte dans un conteneur.
 * @param {HTMLElement} container élément hôte (hauteur fixée par le CSS)
 * @param {object} [options]
 * @param {(station: object) => void} [options.onSelect] appelé au clic sur « Voir la station » (ou sur le marqueur si popup=false)
 * @param {(station: object) => string} [options.popupHtml] contenu de la bulle (par défaut : nom, niveau, lien)
 * @param {boolean} [options.popup=true] afficher une bulle au clic
 * @param {(lat: number, lng: number) => void} [options.onPick] clic sur la carte (choix d'une position)
 * @param {boolean} [options.controls=true] boutons +, − et recentrer au style de la maquette
 * @param {boolean} [options.region=true] étiquette « Grand Tunis · N stations »
 * @returns {object} contrôleur de la carte (update, fit, focus, setPosition, destroy)
 */
export function createMap(container, { onSelect, popupHtml, popup = true, onPick, controls = true, region = true } = {}) {
  if (!window.L) {
    container.innerHTML = `<div class="map-unavailable">${icon('CloudOff', 22)}<p>Carte indisponible (bibliothèque non chargée).</p></div>`;
    return { update() {}, fit() {}, focus() {}, setPosition() {}, destroy() {}, invalidate() {} };
  }
  const L = window.L;
  const map = L.map(container, { zoomControl: !controls, attributionControl: true }).setView(DEFAULT_CENTER, 12);
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; contributeurs OpenStreetMap',
  }).addTo(map);

  // Surcouches de la maquette, posées au-dessus des tuiles (hors du flux de Leaflet).
  const overlay = document.createElement('div');
  overlay.className = 'fw-map-overlay';
  overlay.innerHTML = `${region ? `<div class="map-region">${icon('MapPin', 13)} Grand Tunis <span>·</span> <b data-map-count>0 station</b></div>` : ''}
    ${controls ? `<div class="map-controls">
      <button type="button" class="icon-button" data-map="in" aria-label="Agrandir la carte" title="Agrandir la carte">${icon('Plus', 17)}</button>
      <button type="button" class="icon-button" data-map="out" aria-label="Réduire la carte" title="Réduire la carte">${icon('Minus', 17)}</button>
      <button type="button" class="icon-button" data-map="fit" aria-label="Recentrer la carte" title="Recentrer la carte">${icon('LocateFixed', 17)}</button></div>` : ''}`;
  container.append(overlay);
  L.DomEvent.disableClickPropagation(overlay);
  overlay.addEventListener('click', (e) => {
    const action = e.target.closest('[data-map]')?.dataset.map;
    if (action === 'in') map.zoomIn();
    else if (action === 'out') map.zoomOut();
    else if (action === 'fit') {
      map.closePopup();
      fit();
    }
  });

  const markers = new Map();
  let position = null;
  let fitted = false;

  /**
   * Contenu par défaut de la bulle.
   * @param {object} s StationDto
   * @returns {string} HTML
   */
  const defaultPopup = (s) => `<strong>${esc(s.name)}</strong>
    <span>${esc(LEVELS[levelOf(s)].label)} · ${num(s.levelPct, 0)} %</span>
    <button type="button" class="popup-link" data-station="${esc(s.code)}">Voir la station ${icon('ArrowRight', 12)}</button>`;

  /**
   * Ajoute ou met à jour les marqueurs (les stations disparues sont retirées).
   * @param {object[]} stations StationDto
   */
  function update(stations) {
    const seen = new Set();
    for (const s of stations) {
      seen.add(s.code);
      const divIcon = L.divIcon({ html: markerHtml(s), className: 'fw-leaflet-icon', iconSize: [0, 0], iconAnchor: [0, 0] });
      let marker = markers.get(s.code);
      if (!marker) {
        marker = L.marker([s.latitude, s.longitude], { icon: divIcon, title: s.name, alt: s.name, riseOnHover: true }).addTo(map);
        if (popup) marker.bindPopup('', { className: 'fw-popup', closeButton: false, offset: [0, -14] });
        else if (onSelect) marker.on('click', () => onSelect(marker.station));
        markers.set(s.code, marker);
      } else {
        marker.setIcon(divIcon);
        marker.setLatLng([s.latitude, s.longitude]);
      }
      marker.station = s;
      marker.setZIndexOffset(LEVELS[levelOf(s)].rank * 100);
      if (popup) marker.setPopupContent((popupHtml ?? defaultPopup)(s));
    }
    for (const [code, marker] of markers) {
      if (!seen.has(code)) {
        marker.remove();
        markers.delete(code);
      }
    }
    const count = overlay.querySelector('[data-map-count]');
    if (count) count.textContent = `${stations.length} station${stations.length > 1 ? 's' : ''}`;
    if (!fitted && stations.length) fit();
  }

  /** Cadre la carte sur toutes les stations (et la position de l'utilisateur si connue). */
  function fit() {
    const points = [...markers.values()].map((m) => m.getLatLng());
    if (position) points.push(position.getLatLng());
    if (!points.length) return;
    fitted = true;
    map.fitBounds(L.latLngBounds(points).pad(0.3), { maxZoom: 15 });
  }

  /**
   * Centre la carte sur une station et ouvre sa bulle.
   * @param {string} code code de la station
   */
  function focus(code) {
    const marker = markers.get(code);
    if (!marker) return;
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15));
    if (popup) marker.openPopup();
  }

  /**
   * Affiche (ou retire) la position de l'utilisateur et, en option, son rayon d'alerte.
   * @param {number|null} lat latitude
   * @param {number|null} lng longitude
   * @param {number|null} [radiusKm] rayon en km
   */
  function setPosition(lat, lng, radiusKm = null) {
    position?.remove();
    position = null;
    if (lat == null || lng == null) return;
    const you = L.divIcon({ className: 'fw-leaflet-icon', iconSize: [0, 0], html: '<span class="fw-you" aria-label="Votre position"><span></span><b>Vous</b></span>' });
    position = L.layerGroup([L.marker([lat, lng], { icon: you, interactive: false, keyboard: false })]);
    if (radiusKm) position.addLayer(L.circle([lat, lng], { radius: radiusKm * 1000, color: '#0b4f8a', weight: 1, fillOpacity: 0.05, interactive: false }));
    position.getLatLng = () => L.latLng(lat, lng);
    position.addTo(map);
  }

  container.addEventListener('click', (e) => {
    const link = e.target.closest('[data-station]');
    if (link && onSelect) onSelect(markers.get(link.dataset.station)?.station);
  });
  if (onPick) map.on('click', (e) => onPick(e.latlng.lat, e.latlng.lng));

  return {
    update, fit, focus, setPosition,
    /** Recalcule la taille (conteneur affiché après création). */
    invalidate: () => map.invalidateSize(),
    /** Détruit la carte (changement de vue). */
    destroy: () => map.remove(),
  };
}

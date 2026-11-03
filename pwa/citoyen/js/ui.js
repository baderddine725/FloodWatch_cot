/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : citoyen/js/ui.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { LEVELS, distanceKm, esc, levelOf } from '../../shared/js/format.js';
import { icon } from '../../shared/js/icons.js';

/**
 * Fragments d'interface de la PWA Citoyen (composants RoadStatus, PointRow, Toggle et Brand de
 * la maquette). Le citoyen voit l'état de la ROUTE : il est déduit du champ roadOpen calculé par
 * le serveur (fermée si barrière fermée ou alerte rouge), jamais recalculé ici.
 */

/**
 * Logo FloodWatch.
 * @returns {string} HTML
 */
export function brand() {
  return `<div class="brand"><div class="brand-mark">${icon('Shield', 33).replace('stroke-width="2"', 'stroke-width="1.6"')}
    ${icon('Droplet', 10, 'brand-droplet').replace('fill="none"', 'fill="currentColor"')}${icon('Waves', 19, 'brand-wave')}</div>
    <div>FloodWatch<span>PILOTAGE &amp; PRÉVENTION</span></div></div>`;
}

/**
 * Icône pleine (favori actif).
 * @param {string} name nom de l'icône
 * @param {number} size taille
 * @returns {string} SVG rempli
 */
export function filledIcon(name, size) {
  return icon(name, size).replace('fill="none"', 'fill="currentColor"');
}

/**
 * Classe d'état de la route (couleurs de la maquette).
 * @param {object} s StationDto
 * @returns {'offline'|'red'|'orange'|'yellow'|'green'} classe CSS
 */
export function roadClass(s) {
  if (!s.online) return 'offline';
  if (!s.roadOpen) return 'red';
  return LEVELS[levelOf(s)].css;
}

/**
 * Libellé court de l'état de la route.
 * @param {object} s StationDto
 * @returns {string} état lisible par le public
 */
export function roadText(s) {
  if (!s.online) return 'État non disponible';
  if (!s.roadOpen) return 'Route fermée';
  if (s.alertLevel === 'ORANGE') return 'Praticable · Prudence';
  if (s.alertLevel === 'YELLOW') return 'Praticable · Vigilance';
  return 'Route praticable';
}

/**
 * Pastille d'état de la route.
 * @param {object} s StationDto
 * @returns {string} HTML
 */
export function roadStatus(s) {
  const ico = !s.online ? 'WifiOff' : !s.roadOpen ? 'TriangleAlert' : 'CircleCheck';
  return `<span class="c-road-status ${roadClass(s)}">${icon(ico, 13)}${esc(roadText(s))}</span>`;
}

/**
 * Distance lisible (mètres en dessous d'un kilomètre).
 * @param {number} km distance
 * @returns {string} texte
 */
export function distanceText(km) {
  if (!Number.isFinite(km)) return '—';
  return km < 1 ? `${Math.round(km * 100) * 10} m` : `${km.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;
}

/**
 * Distance entre la position de référence et une station.
 * @param {{lat: number, lng: number}} position position de référence
 * @param {object} s StationDto
 * @returns {number} kilomètres
 */
export function distanceTo(position, s) {
  return distanceKm(position.lat, position.lng, s.latitude, s.longitude);
}

/**
 * Ligne d'un point surveillé (composant PointRow de la maquette).
 * @param {object} s StationDto
 * @param {{lat: number, lng: number}} position position de référence
 * @param {boolean} [favorite=false] afficher le cœur
 * @returns {string} HTML
 */
export function pointRow(s, position, favorite = false) {
  const ico = !s.online ? icon('WifiOff', 20) : !s.roadOpen ? icon('TriangleAlert', 21) : icon('Waves', 22);
  return `<button type="button" class="c-point-row" data-open="${esc(s.code)}">
    <span class="c-point-icon ${roadClass(s)}">${ico}</span>
    <span class="c-point-copy"><strong>${esc(s.name)}</strong>${roadStatus(s)}</span>
    <span class="c-point-distance">${favorite ? filledIcon('Heart', 13) : ''}${distanceText(distanceTo(position, s))}${icon('ChevronRight', 15)}</span></button>`;
}

/**
 * Interrupteur accessible (composant Toggle de la maquette).
 * @param {object} options
 * @param {boolean} options.checked état
 * @param {string} options.label nom accessible
 * @param {string} options.action valeur de data-action
 * @param {boolean} [options.disabled=false] désactivé
 * @returns {string} HTML
 */
export function toggle({ checked, label, action, disabled = false }) {
  return `<button type="button" role="switch" aria-checked="${checked}" aria-label="${esc(label)}" data-action="${esc(action)}"
    class="c-toggle ${checked ? 'checked' : ''}" ${disabled ? 'disabled' : ''}><span></span></button>`;
}

/**
 * En-tête de page (eyebrow, titre, introduction).
 * @param {string} eyebrow surtitre
 * @param {string} title titre
 * @param {string} intro phrase d'introduction
 * @param {string} [aside] HTML à droite du titre
 * @returns {string} HTML
 */
export function pageTitle(eyebrow, title, intro, aside = '') {
  return `<span class="c-eyebrow">${esc(eyebrow)}</span>
    <div class="c-page-title"><h1>${esc(title)}<span>.</span></h1>${aside}</div>
    <p class="c-page-intro">${esc(intro)}</p>`;
}

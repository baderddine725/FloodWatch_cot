/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : pilotage/js/ui.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { ALERT_TYPES, LEVELS, esc, levelOf } from '../../shared/js/format.js';
import { icon } from '../../shared/js/icons.js';

/**
 * Fragments d'interface communs aux écrans de la PWA Pilotage (repris des composants
 * Brand, Kpi, Empty et du bandeau d'alerte rouge de la maquette Figma).
 * Toutes les fonctions renvoient du HTML dont les valeurs dynamiques sont échappées.
 */

/**
 * Logo FloodWatch (composant Brand de la maquette).
 * @returns {string} HTML du logo
 */
export function brand() {
  return `<div class="brand"><div class="brand-mark">${icon('Shield', 33, 'brand-shield').replace('stroke-width="2"', 'stroke-width="1.6"')}
    ${icon('Droplet', 10, 'brand-droplet').replace('fill="none"', 'fill="currentColor"')}${icon('Waves', 19, 'brand-wave')}</div>
    <div>FloodWatch<span>PILOTAGE &amp; PRÉVENTION</span></div></div>`;
}

/**
 * En-tête de page (.page-heading de la maquette).
 * @param {object} options
 * @param {string} options.eyebrow surtitre en capitales
 * @param {string} options.title titre (un point bleu est ajouté)
 * @param {string} options.subtitle phrase d'accroche
 * @param {string} [options.actions] HTML des actions à droite
 * @param {string} [options.back] HTML d'un lien de retour au-dessus du surtitre
 * @returns {string} HTML de l'en-tête
 */
export function pageHeading({ eyebrow, title, subtitle, actions = '', back = '' }) {
  return `<div class="page-heading"><div>${back}
      <div class="eyebrow">${esc(eyebrow)}</div>
      <h1><span data-heading-title>${esc(title)}</span><span class="heading-dot">.</span></h1>
      <p>${esc(subtitle)}</p></div>
    <div class="heading-actions">${actions}</div></div>`;
}

/**
 * Pastille « En direct » (ou « Reconnexion… » quand le flux temps réel est coupé).
 * @param {string} live état de la connexion temps réel
 * @param {string} [label='En direct'] libellé quand la connexion est ouverte
 * @returns {string} HTML de la pastille
 */
export function livePill(live, label = 'En direct') {
  const open = live === 'open';
  return `<span class="live-pill ${open ? '' : 'paused'}" data-live-pill="${esc(label)}"><span></span>${open ? esc(label) : 'Reconnexion…'}</span>`;
}

/**
 * Bandeau d'alerte rouge (affiché sur le tableau de bord, les alertes et la fiche station).
 * Le texte ne prétend « barrière fermée » que si l'état remonté par la station le confirme.
 * @param {object[]} stations StationDto
 * @returns {string} HTML du bandeau, ou chaîne vide s'il n'y a aucune station en rouge
 */
export function redBanner(stations) {
  const red = stations.filter((s) => levelOf(s) === 'RED');
  if (!red.length) return '';
  const first = red[0];
  const barrier = first.barrier === 'CLOSED'
    ? `Barrière fermée${first.controlMode === 'AUTO' ? ' automatiquement' : ''}${first.localSafety ? ' (sécurité locale)' : ''}`
    : first.barrier === 'OPEN' ? 'Barrière encore ouverte' : 'État de la barrière inconnu';
  return `<div class="alert-banner" role="alert">
    <span class="banner-icon">${icon('TriangleAlert', 20)}</span>
    <div><strong>Alerte rouge : ${esc(first.name)}</strong>
      <span>${red.length > 1 ? `${red.length} stations en alerte rouge. ` : ''}${esc(first.alertReasons || 'Seuil critique dépassé.')} · ${barrier} · Intervention requise.</span></div>
    <button type="button" data-open-station="${esc(first.code)}">Voir la station ${icon('ArrowRight', 15)}</button></div>`;
}

/**
 * Carte d'indicateur (composant Kpi de la maquette).
 * @param {object} options
 * @param {string} options.icon nom de l'icône
 * @param {string} options.title titre
 * @param {string} options.value HTML de la valeur
 * @param {string} options.foot HTML du pied
 * @param {string} options.trend info-bulle de l'icône
 * @param {string} [options.tone] variante (ex. 'red')
 * @returns {string} HTML de la carte
 */
export function kpiCard({ icon: name, title, value, foot, trend, tone = '' }) {
  return `<div class="kpi-card ${tone}"><div class="kpi-title"><span>${esc(title)}</span>
    <span class="kpi-icon" title="${esc(trend)}">${icon(name, 18)}</span></div>
    <strong class="kpi-value">${value}</strong><div class="kpi-foot">${foot}</div></div>`;
}

/**
 * État vide (composant Empty de la maquette).
 * @param {string} text explication
 * @param {string} [title='Tout est en ordre'] titre
 * @returns {string} HTML
 */
export function emptyState(text, title = 'Tout est en ordre') {
  return `<div class="empty-state">${icon('CircleCheck', 35)}<h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
}

/** Icône associée à chaque type d'alerte. */
const ALERT_TYPE_ICONS = { LEVEL: 'Waves', OFFLINE: 'WifiOff', SENSOR_FAULT: 'Gauge', LOCAL_SAFETY: 'ShieldCheck' };

/**
 * Étiquette du type d'alerte (y compris SENSOR_FAULT, OFFLINE et LOCAL_SAFETY, absents de la maquette).
 * @param {string} type AlertDto.type
 * @returns {string} HTML
 */
export function alertTypeChip(type) {
  return `<span class="alert-type ${esc(String(type).toLowerCase())}">${icon(ALERT_TYPE_ICONS[type] ?? 'Info', 12)}${esc(ALERT_TYPES[type] ?? type)}</span>`;
}

/**
 * Niveau à afficher pour une alerte : une alerte OFFLINE s'affiche en gris « Hors ligne ».
 * @param {{type: string, level: string}} alert AlertDto
 * @returns {import('../../shared/js/format.js').LevelKey} niveau
 */
export function alertLevelKey(alert) {
  if (alert.type === 'OFFLINE') return 'OFFLINE';
  return LEVELS[alert.level] ? alert.level : 'GREEN';
}

/**
 * Initiales d'un nom (avatar).
 * @param {string} name nom complet ou identifiant
 * @returns {string} une ou deux lettres
 */
export function initials(name) {
  return String(name || '?').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((n) => n[0].toUpperCase()).join('');
}

/**
 * Libellé du rôle principal d'un utilisateur.
 * @param {{roles?: string[]}} user UserDto
 * @returns {string} « Administrateur », « Opérateur » ou « Citoyen »
 */
export function roleLabel(user) {
  if (user?.roles?.includes('ADMIN')) return 'Administrateur';
  if (user?.roles?.includes('OPERATOR')) return 'Opérateur';
  return 'Citoyen';
}

/**
 * Jour relatif d'un instant dans le fuseau de Tunis (« Aujourd'hui », « Hier » ou la date).
 * @param {string} value instant ISO-8601
 * @returns {string} libellé du jour
 */
export function dayLabel(value) {
  const opts = { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' };
  const day = (d) => new Date(d).toLocaleDateString('fr-CA', opts);
  const target = day(value);
  if (target === day(Date.now())) return 'Aujourd’hui';
  if (target === day(Date.now() - 86_400_000)) return 'Hier';
  return new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Africa/Tunis' });
}

/**
 * Date AAAA-MM-JJ d'un instant dans le fuseau de Tunis (comparaison avec un <input type="date">).
 * @param {string} value instant ISO-8601
 * @returns {string} date au format ISO court
 */
export function isoDay(value) {
  return new Date(value).toLocaleDateString('fr-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' });
}

/**
 * Regroupe les appels successifs en un seul par image affichée (mises à jour en rafale du WebSocket).
 * @param {() => void} fn fonction de rendu
 * @returns {() => void} version regroupée
 */
export function onFrame(fn) {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      fn();
    });
  };
}

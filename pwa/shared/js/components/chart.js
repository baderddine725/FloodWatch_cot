/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : shared/js/components/chart.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { esc, num, time } from '../format.js';

/**
 * Courbe temporelle en SVG natif (reprise du composant LineChart de la maquette),
 * alimentée par GET /stations/{id}/measurements puis complétée en direct par le WebSocket.
 * Classes CSS : .chart-content, .chart-unit, .line-chart, .chart-legend.
 */

/** Palette des séries (maquette). */
export const SERIES_COLORS = ['#d94e4e', '#f09a48', '#45a48b', '#d6b63c', '#6888bf', '#a6aab3'];

/** Couleurs des seuils jaune / orange / rouge (traits et libellés). */
const THRESHOLD_STROKES = ['#c8a42b', '#f97316', '#dc2626'];
const THRESHOLD_TEXTS = ['#a68414', '#e16912', '#dc2626'];

/** Géométrie du repère (viewBox 1000 × 175 de la maquette). */
const X0 = 37;
const X1 = 985;
const Y0 = 144; // axe des abscisses
const HEIGHT = 128;

let gradientId = 0;

/**
 * @typedef {object} Series
 * @property {string} key identifiant (code de station)
 * @property {string} name libellé de la légende
 * @property {{t: number, v: number}[]} points instants (ms) et valeurs, triés
 */

/**
 * Crée une courbe dans un conteneur.
 * @param {HTMLElement} container élément hôte (vidé)
 * @param {object} options
 * @param {string} options.unit libellé de l'unité (ex. « Niveau d’eau (%) »)
 * @param {string} options.label description accessible
 * @param {boolean} [options.legend=true] afficher la légende cliquable
 * @param {boolean} [options.area=true] remplir l'aire sous la première série
 * @returns {{update: (data: {series: Series[], minutes: number, thresholds?: number[]}) => void}} mise à jour
 */
export function createLineChart(container, { unit, label, legend = true, area = true }) {
  const hidden = new Set();
  const gid = `fw-area-${++gradientId}`;
  let last = { series: [], minutes: 30, thresholds: [] };

  container.classList.add('chart-content');

  /**
   * Redessine la courbe.
   * @param {{series: Series[], minutes: number, thresholds?: number[]}} data données à tracer
   */
  function update(data) {
    last = { thresholds: [], ...data };
    const { series, minutes, thresholds } = last;
    const end = Date.now();
    const start = end - minutes * 60_000;
    const visible = series.filter((s) => !hidden.has(s.key));
    const max = Math.max(100, ...visible.flatMap((s) => s.points.filter((p) => p.t >= start).map((p) => p.v)));
    const scale = HEIGHT / max;
    const x = (t) => X0 + ((t - start) / (end - start)) * (X1 - X0);
    const y = (v) => Y0 - Math.max(0, v) * scale;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * max));

    let svg = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ef4444" stop-opacity=".08"/><stop offset="1" stop-color="#ef4444" stop-opacity="0"/></linearGradient></defs>`;
    svg += ticks.map((v) => `<g><line x1="${X0}" x2="${X1}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)" stroke-dasharray="3 4"/>
      <text x="20" y="${y(v) + 4}" text-anchor="end" fill="#8a94a3" font-size="10">${v}</text></g>`).join('');
    svg += thresholds.map((v, i) => `<g><line x1="${X0}" x2="${X1}" y1="${y(v)}" y2="${y(v)}" stroke="${THRESHOLD_STROKES[i]}" stroke-dasharray="6 5" opacity=".7"/>
      <text x="${X1}" y="${y(v) - 5}" text-anchor="end" font-size="9" fill="${THRESHOLD_TEXTS[i]}">Seuil ${num(v, 0)} %</text></g>`).join('');

    series.forEach((s, i) => {
      if (hidden.has(s.key)) return;
      const pts = s.points.filter((p) => p.t >= start).map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`);
      if (!pts.length) return;
      const color = SERIES_COLORS[i % SERIES_COLORS.length];
      const lastPoint = pts[pts.length - 1].split(',');
      if (i === 0 && area) svg += `<polygon points="${pts[0].split(',')[0]},${Y0} ${pts.join(' ')} ${lastPoint[0]},${Y0}" fill="url(#${gid})"/>`;
      svg += `<polyline fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(' ')}"/>
        <circle cx="${lastPoint[0]}" cy="${lastPoint[1]}" r="3.5" fill="${color}" stroke="var(--card)" stroke-width="2"/>`;
    });

    svg += [0, 1, 2, 3, 4, 5, 6].map((i) => `<text x="${X0 + i * 158}" y="168" text-anchor="${i === 0 ? 'start' : i === 6 ? 'end' : 'middle'}" fill="#8a94a3" font-size="10">${time(start + (i / 6) * (end - start))}</text>`).join('');

    const empty = !visible.some((s) => s.points.some((p) => p.t >= start));
    if (empty) svg += `<text x="511" y="80" text-anchor="middle" fill="#8a94a3" font-size="12">Aucune mesure sur la période</text>`;

    container.innerHTML = `<div class="chart-unit">${esc(unit)}</div>
      <svg viewBox="0 0 1000 175" class="line-chart" role="img" aria-label="${esc(label)}">${svg}</svg>
      ${legend && series.length > 1 ? `<div class="chart-legend">${series.map((s, i) => `<button type="button" data-key="${esc(s.key)}" class="${hidden.has(s.key) ? 'muted' : ''}" aria-pressed="${!hidden.has(s.key)}">
        <span style="background:${SERIES_COLORS[i % SERIES_COLORS.length]}"></span>${esc(s.name)}</button>`).join('')}</div>` : ''}`;
  }

  container.addEventListener('click', (e) => {
    const button = e.target.closest('.chart-legend [data-key]');
    if (!button) return;
    const key = button.dataset.key;
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    update(last);
  });

  return { update };
}

/**
 * Convertit des mesures (MeasurementDto) en points de courbe.
 * @param {{ts: string, levelPct: number, rain: number}[]} measurements mesures triées
 * @param {'levelPct'|'rain'} [field='levelPct'] champ tracé (la pluie est convertie en %)
 * @returns {{t: number, v: number}[]} points
 */
export function toPoints(measurements, field = 'levelPct') {
  return measurements.map((m) => ({ t: Date.parse(m.ts), v: field === 'rain' ? (m.rain ?? 0) * 100 : m.levelPct ?? 0 }));
}

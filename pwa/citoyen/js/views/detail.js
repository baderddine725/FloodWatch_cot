/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : citoyen/js/views/detail.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { LEVELS, STATION_TYPES, esc, levelOf, num } from '../../../shared/js/format.js';
import { icon } from '../../../shared/js/icons.js';
import { badge } from '../../../shared/js/components/badge.js';
import { toggleFavorite } from '../preferences.js';
import { distanceText, distanceTo, filledIcon, roadClass } from '../ui.js';

/**
 * Fiche publique d'un point surveillé (vue « détail » de la maquette Citoyen) : état de la
 * route, niveau d'eau et jauge des seuils, temps estimé avant débordement (calculé par le
 * serveur), bons réflexes et ajout aux favoris.
 */

/** Libellés de retour selon l'onglet d'origine. */
const BACK = { map: 'à la carte', alerts: 'aux alertes', favorites: 'aux favoris', settings: 'aux paramètres' };

/**
 * Affiche la fiche d'une station.
 * @param {HTMLElement} content zone de contenu
 * @param {object} ctx contexte de l'application
 * @param {string} code code de la station
 * @returns {() => void} nettoyage
 */
export function mountDetail(content, ctx, code) {
  /** Dessine la fiche. */
  function render() {
    const s = ctx.store.state.stations.get(code);
    const back = `<button type="button" class="c-back" data-back>${icon('ArrowLeft', 18)} Retour ${BACK[ctx.lastTab] ?? 'à la carte'}</button>`;
    if (!s) {
      content.innerHTML = `<div class="c-detail">${back}<div class="c-empty">${icon('MapPin', 40)}<h2>Point introuvable</h2>
        <p>Ce point n’est plus surveillé ou les données ne sont pas encore chargées.</p></div></div>`;
      return;
    }
    const { position, favorites } = ctx.prefs;
    const favorite = favorites.includes(s.code);
    const level = levelOf(s);
    const closed = s.online && !s.roadOpen;
    const t = s.thresholds ?? { yellowPct: 30, orangePct: 60, redPct: 85 };
    const ttf = s.minutesToOverflow;
    const css = roadClass(s);
    const headline = !s.online ? 'État de la route non disponible' : closed ? 'Route fermée' : 'Route praticable';
    const advice = !s.online ? 'Ne vous fiez pas aux dernières mesures.' : closed ? 'Ne vous engagez pas sur cet axe.'
      : level === 'ORANGE' ? 'La situation évolue. Redoublez de prudence.' : level === 'YELLOW' ? 'Restez attentif à la montée des eaux.'
        : 'Restez attentif aux conditions sur place.';
    const pct = s.levelPct;
    content.innerHTML = `<div class="c-detail">${back}
      <div class="c-detail-heading"><span class="c-eyebrow">${esc((s.address || STATION_TYPES[s.type] || 'Grand Tunis').toUpperCase())} · ${distanceText(distanceTo(position, s))} DE VOUS</span>
        <h1>${esc(s.name)}</h1><span class="c-station-code">${icon('MapPin', 13)}${esc(STATION_TYPES[s.type] ?? 'Point surveillé')} · Point surveillé</span></div>
      <div class="c-safety-card ${css}" role="status"><span>${icon(!s.online ? 'WifiOff' : closed ? 'TriangleAlert' : 'ShieldCheck', 27)}</span>
        <div><strong>${headline}</strong><p>${advice}</p></div></div>
      <section class="c-panel c-water-panel">
        <div class="c-panel-heading"><h2>${icon('Waves', 18)}Niveau d’eau</h2>${badge(level)}</div>
        <div class="c-water-value"><strong>${s.online && pct != null ? Math.round(pct) : '—'}<small> %</small></strong>
          <span>${s.online && s.levelCm != null ? `${num(s.levelCm, 0)} cm mesurés` : 'Mesures non confirmées'}</span></div>
        <div class="c-level-gauge" role="meter" aria-label="Niveau d’eau" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct ?? 0)}"
          aria-valuetext="${s.online && pct != null ? `${Math.round(pct)} pour cent du niveau critique` : 'Mesures non disponibles'}"
          style="background:linear-gradient(90deg, ${LEVELS.GREEN.color} 0% ${t.yellowPct}%, ${LEVELS.YELLOW.color} ${t.yellowPct}% ${t.orangePct}%, ${LEVELS.ORANGE.color} ${t.orangePct}% ${t.redPct}%, ${LEVELS.RED.color} ${t.redPct}%)">
          ${s.online && pct != null ? `<span class="c-gauge-cursor" style="left:${Math.max(0, Math.min(98, pct))}%"></span>` : ''}</div>
        <div class="c-gauge-labels"><span>0 %</span><span style="left:${t.yellowPct}%">${num(t.yellowPct, 0)} %</span>
          <span style="left:${t.orangePct}%">${num(t.orangePct, 0)} %</span><span style="left:${t.redPct}%">${num(t.redPct, 0)} %</span><span>100 %</span></div>
        <div class="c-prediction"><span>${icon('Clock3', 17)} Temps estimé avant débordement</span>
          <strong>${!s.online ? 'Indisponible' : ttf == null ? 'Pas de montée' : ttf < 1 ? 'Imminent' : `${Math.round(ttf)} min`}</strong></div>
        <p class="c-measure-time">${icon(s.online ? 'Wifi' : 'WifiOff', 12)} Dernier message reçu <span data-ago="${esc(s.lastSeenAt ?? '')}"></span></p>
      </section>
      <section class="c-panel c-advice"><h2>${icon('ShieldCheck', 19)}Les bons réflexes</h2>
        <p>${closed ? 'Même avec peu d’eau, un véhicule peut être emporté. Faites demi-tour et choisissez un autre itinéraire.'
    : 'Une route praticable peut évoluer rapidement. Respectez la signalisation et n’entrez jamais dans une zone inondée.'}</p>
        <ul><li>Ne franchissez jamais une barrière fermée.</li><li>Éloignez-vous des oueds et des points bas.</li><li>En cas de danger, appelez la Protection civile.</li></ul>
        <a href="tel:198">${icon('Phone', 16)} Protection civile <strong>198</strong>${icon('ExternalLink', 14)}</a></section>
      <button type="button" class="c-button ${favorite ? 'secondary' : ''}" data-favorite>${favorite ? filledIcon('Heart', 18) : icon('Heart', 18)}
        ${favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}</button>
      <p class="c-data-disclaimer">Mesures transmises en temps réel par la station. La signalisation sur place fait foi.</p>
    </div>`;
    ctx.refreshAgo(content);
  }

  content.addEventListener('click', (e) => {
    if (e.target.closest('[data-back]')) ctx.goTab(ctx.lastTab);
    if (e.target.closest('[data-favorite]')) {
      const now = toggleFavorite(code);
      ctx.notice(now ? 'Point ajouté à vos favoris. Gardez un œil sur votre trajet.' : 'Point retiré de vos favoris.');
      render();
    }
  });
  render();
  const unsubscribe = ctx.store.subscribe('stations', (c) => { if (!c || c === code) render(); });
  return unsubscribe;
}

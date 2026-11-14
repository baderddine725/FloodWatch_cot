/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : shared/js/components/badge.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { LEVELS, esc } from '../format.js';
import { icon } from '../icons.js';

/**
 * Pastille de niveau (composant Badge de la maquette : classes .badge.green|yellow|orange|red|offline).
 * @param {import('../format.js').LevelKey} level niveau à afficher
 * @param {string} [label] libellé personnalisé (par défaut celui du niveau)
 * @returns {string} HTML de la pastille
 */
export function badge(level, label) {
  const def = LEVELS[level] ?? LEVELS.OFFLINE;
  const ico = level === 'GREEN' ? 'CircleCheck' : level === 'OFFLINE' ? 'WifiOff' : 'TriangleAlert';
  return `<span class="badge ${def.css}">${icon(ico, 12)}${esc(label ?? def.label)}</span>`;
}

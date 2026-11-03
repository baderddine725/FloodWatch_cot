/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : citoyen/js/notifications.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { pushEnabled, pushSupport, subscribePush, unsubscribePush } from '../../shared/js/push.js';
import { loadPrefs } from './preferences.js';
import { distanceTo } from './ui.js';

/**
 * Notifications du citoyen.
 *
 * Règle appliquée par le serveur (PushManager), reprise telle quelle :
 *  - alerte de niveau (ou de sécurité locale) ORANGE ou ROUGE d'une station située dans le rayon
 *    autour de la position transmise à l'abonnement ;
 *  - fin d'une alerte ROUGE.
 * Le jaune, les stations muettes et les capteurs défaillants ne sont pas notifiés (ils restent
 * visibles dans l'application). Le choix des niveaux proposé par la maquette n'existe donc pas
 * côté serveur : l'écran des paramètres l'affiche à titre informatif.
 *
 * Repli : sans Web Push (navigateur non compatible, permission refusée, iPhone sans
 * installation), l'application ouverte applique la même règle aux messages « station » du
 * WebSocket et affiche le bandeau d'alerte de la maquette.
 */

/** Rang des niveaux pour détecter une aggravation. */
const RANK = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };

/**
 * Abonne l'appareil avec la position et le rayon courants (POST /api/push/subscriptions,
 * sans jeton : audience CITOYEN). Un nouvel envoi met à jour l'abonnement existant.
 * @returns {Promise<object>} réponse du serveur {id, audience, radiusKm}
 */
export function subscribeCitizen() {
  const { position, radiusKm } = loadPrefs();
  return subscribePush({ latitude: position.lat, longitude: position.lng, radiusKm });
}

/**
 * Après un changement de position ou de rayon, met à jour l'abonnement s'il existe.
 * @returns {Promise<boolean>} vrai si un abonnement a été mis à jour
 */
export async function refreshSubscription() {
  if (!pushSupport().supported || Notification.permission !== 'granted' || !(await pushEnabled())) return false;
  await subscribeCitizen();
  return true;
}

/**
 * Désactive les notifications de cet appareil.
 * @returns {Promise<void>}
 */
export function unsubscribeCitizen() {
  return unsubscribePush();
}

/**
 * Décide si un changement d'état de station mérite une alerte pour le citoyen (même règle que
 * le serveur). Utilisé pour le bandeau dans l'application.
 * @param {object|undefined} before StationDto précédent
 * @param {object} after StationDto reçu
 * @returns {{kind: 'red'|'orange'|'end', station: object}|null} alerte à afficher, ou null
 */
export function citizenAlertFor(before, after) {
  if (!before || !after.online) return null;
  const { position, radiusKm } = loadPrefs();
  if (distanceTo(position, after) > radiusKm) return null;
  const was = RANK[before.alertLevel] ?? 0;
  const now = RANK[after.alertLevel] ?? 0;
  if (now > was && now >= RANK.ORANGE) return { kind: now === RANK.RED ? 'red' : 'orange', station: after };
  if (!before.localSafety && after.localSafety) return { kind: 'red', station: after };
  if (was === RANK.RED && now < RANK.RED) return { kind: 'end', station: after };
  return null;
}

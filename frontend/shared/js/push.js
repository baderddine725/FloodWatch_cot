/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : shared/js/push.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { api } from './api.js';
import { demo } from './config.js';
import { session } from './auth.js';

/**
 * Notifications Web Push (VAPID). Côté serveur (PushManager) :
 *  - abonnement envoyé avec un jeton opérateur/admin → toutes les alertes ;
 *  - abonnement citoyen (sans jeton) → alertes orange/rouge des stations situées dans
 *    le rayon autour de la position fournie, plus la fin d'alerte rouge.
 */

/**
 * Indique si le navigateur sait recevoir des notifications push.
 * @returns {{supported: boolean, reason: string|null}} support et raison éventuelle
 */
export function pushSupport() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    return {
      supported: false,
      reason: ios
        ? 'Sur iPhone, installez d’abord l’application (Partager → Sur l’écran d’accueil) pour recevoir les alertes.'
        : 'Ce navigateur ne prend pas en charge les notifications push : les alertes s’afficheront dans l’application ouverte.',
    };
  }
  if (Notification.permission === 'denied') {
    return { supported: false, reason: 'Les notifications sont bloquées pour ce site dans les réglages du navigateur.' };
  }
  return { supported: true, reason: null };
}

/**
 * Convertit une clé base64url en octets (applicationServerKey).
 * @param {string} b64 clé publique VAPID en base64url
 * @returns {Uint8Array} octets de la clé
 */
function base64UrlToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * Abonne cet appareil aux notifications.
 * @param {{latitude?: number|null, longitude?: number|null, radiusKm?: number|null}} [area] zone d'intérêt (citoyen)
 * @returns {Promise<{id?: string, audience: string, radiusKm: number|null}>} abonnement enregistré par le serveur
 * @throws {Error} si non pris en charge, permission refusée ou erreur serveur
 */
export async function subscribePush({ latitude = null, longitude = null, radiusKm = null } = {}) {
  const support = pushSupport();
  if (!support.supported) throw new Error(support.reason);
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Autorisation de notification refusée.');
  const registration = await navigator.serviceWorker.ready;

  if (demo.active) {
    await registration.showNotification('FloodWatch (démonstration)', {
      body: 'Notifications activées. Les alertes simulées s’afficheront ici.', icon: 'icons/icon-192.png',
    });
    return { audience: session.isOperator ? 'OPERATOR' : 'CITIZEN', radiusKm };
  }

  const { publicKey } = await api('/push/public-key');
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
  }
  return api('/push/subscriptions', { method: 'POST', body: { subscription: subscription.toJSON(), latitude, longitude, radiusKm } });
}

/**
 * Désabonne cet appareil (côté serveur puis côté navigateur).
 * @returns {Promise<void>}
 */
export async function unsubscribePush() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager?.getSubscription();
  if (!subscription) return;
  if (!demo.active) {
    await api(`/push/subscriptions?endpoint=${encodeURIComponent(subscription.endpoint)}`, { method: 'DELETE' }).catch(() => {});
  }
  await subscription.unsubscribe();
}

/**
 * @returns {Promise<boolean>} vrai si cet appareil est abonné
 */
export async function pushEnabled() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  return !!(await registration?.pushManager?.getSubscription());
}

/**
 * Notification locale affichée par l'application ouverte (repli quand le push n'est pas
 * disponible : l'alerte arrive alors par le WebSocket).
 * @param {string} title titre
 * @param {string} body texte
 * @param {{tag?: string, url?: string, urgent?: boolean}} [options] options d'affichage
 * @returns {Promise<boolean>} vrai si une notification système a pu être affichée
 */
export async function localNotify(title, body, { tag = 'floodwatch', url = './', urgent = false } = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, { body, tag, renotify: true, requireInteraction: urgent, icon: 'icons/icon-192.png', data: { url } });
    return true;
  } catch {
    return false;
  }
}

/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : shared/js/platform.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */

/**
 * Services du navigateur : Service Worker, géolocalisation, état du réseau.
 */

/**
 * Enregistre le Service Worker de la PWA (dans son propre scope).
 * @param {string} [path='sw.js'] chemin du script, relatif à la page
 * @returns {Promise<ServiceWorkerRegistration|null>} l'enregistrement, ou null si non pris en charge
 */
export async function registerServiceWorker(path = 'sw.js') {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(path);
  } catch (e) {
    console.warn('[sw] enregistrement impossible', e);
    return null;
  }
}

/**
 * Position de l'appareil.
 * @returns {Promise<{latitude: number, longitude: number}>} coordonnées
 * @throws {Error} si refusée ou indisponible (message en français)
 */
export function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Géolocalisation indisponible sur cet appareil.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      (e) => reject(new Error(e.code === 1 ? 'Accès à la position refusé.' : 'Position indisponible pour le moment.')),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  });
}

/**
 * Surveille la connexion réseau de l'appareil.
 * @param {(online: boolean) => void} handler appelé à chaque changement (et immédiatement)
 * @returns {() => void} désabonnement
 */
export function watchConnectivity(handler) {
  const on = () => handler(true);
  const off = () => handler(false);
  window.addEventListener('online', on);
  window.addEventListener('offline', off);
  handler(navigator.onLine);
  return () => {
    window.removeEventListener('online', on);
    window.removeEventListener('offline', off);
  };
}

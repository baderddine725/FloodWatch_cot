/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : shared/js/api.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { CONFIG, demo, demoBackend } from './config.js';
import { prefs, KEYS } from './prefs.js';

/**
 * Client REST de l'API FloodWatch (HTTPS, JSON, jeton Bearer).
 * Les erreurs du serveur ont toujours la forme {"status": n, "error": "message"}
 * (backend/api/.../boundaries/ErrorMappers.java) ; elles sont traduites en français.
 */

/** Messages affichés selon le code HTTP (le message serveur, en anglais, reste disponible). */
const STATUS_MESSAGES = {
  0: 'Serveur injoignable : vérifiez votre connexion.',
  400: 'Requête refusée par le serveur.',
  401: 'Session expirée : reconnectez-vous.',
  403: 'Action réservée à un autre rôle.',
  404: 'Élément introuvable (supprimé entre-temps ?).',
  409: 'Conflit : la ressource a été modifiée entre-temps. Rechargez puis réessayez.',
  412: 'La station a été modifiée entre-temps : les données ont été rechargées.',
  500: 'Erreur interne du serveur.',
  502: 'Serveur momentanément indisponible.',
  503: 'Serveur momentanément indisponible.',
  504: 'Le serveur ne répond pas.',
};

/** Traductions des messages serveur connus (UserResource, StationManager, ThresholdsDto...). */
const SERVER_MESSAGES = [
  [/username already exists/i, 'Cet identifiant existe déjà.'],
  [/password must have at least 8/i, 'Le mot de passe doit contenir au moins 8 caractères.'],
  [/cannot delete yourself/i, 'Vous ne pouvez pas supprimer votre propre compte.'],
  [/cannot disable your own/i, 'Vous ne pouvez pas désactiver votre propre compte.'],
  [/cannot remove your own ADMIN/i, 'Vous ne pouvez pas retirer votre propre rôle administrateur.'],
  [/at least one role/i, 'Choisissez au moins un rôle.'],
  [/station code already exists/i, 'Ce code de station existe déjà.'],
  [/code must match/i, 'Code de station invalide (minuscules, chiffres et tirets).'],
  [/sensorHeightCm must be >= criticalCm/i, 'La hauteur du capteur doit être supérieure ou égale au niveau critique.'],
  [/periods must satisfy/i, 'Périodes incohérentes : 1 ≤ période renforcée ≤ période normale.'],
  [/modified concurrently/i, STATUS_MESSAGES[409]],
  [/thresholds must satisfy/i, 'Les seuils doivent respecter : jaune < orange < rouge ≤ 100 %.'],
  [/criticalCm must be > 0/i, 'La hauteur critique doit être supérieure à 0 cm.'],
  [/rapidRiseCmPerMin must be > 0/i, 'Le seuil de montée rapide doit être supérieur à 0 cm/min.'],
  [/reopenDelaySec must be >= 0/i, 'Le délai de réouverture ne peut pas être négatif.'],
  [/name required/i, 'Le nom de la station est obligatoire.'],
  [/invalid latitude/i, 'Latitude invalide (entre −90 et 90).'],
  [/invalid longitude/i, 'Longitude invalide (entre −180 et 180).'],
  [/you cannot delete yourself/i, 'Vous ne pouvez pas supprimer votre propre compte.'],
  [/you cannot disable your own/i, 'Vous ne pouvez pas désactiver votre propre compte.'],
  [/username and password are required/i, 'Identifiant et mot de passe obligatoires.'],
];

/** Erreur d'appel à l'API. */
export class ApiError extends Error {
  /**
   * @param {number} status code HTTP (0 = réseau)
   * @param {string} message message en français, prêt à afficher
   * @param {string|null} serverMessage message brut renvoyé par le serveur
   */
  constructor(status, message, serverMessage = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

/**
 * Choisit le message à afficher pour une erreur.
 * @param {number} status code HTTP
 * @param {string|null} server message brut du serveur
 * @param {string} path chemin appelé
 * @returns {string} message en français
 */
function frenchMessage(status, server, path) {
  if (status === 401 && path.startsWith('/auth/login')) return 'Identifiant ou mot de passe incorrect.';
  if (server) {
    const known = SERVER_MESSAGES.find(([re]) => re.test(server));
    if (known) return known[1];
  }
  if (status === 400 && server) return `${STATUS_MESSAGES[400]} (${server})`;
  return STATUS_MESSAGES[status] ?? `Erreur ${status}${server ? ` : ${server}` : ''}`;
}

/**
 * Signale une session expirée : jeton effacé et événement « fw:unauthorized » diffusé
 * (la PWA Pilotage revient alors à l'écran de connexion).
 */
function expireSession() {
  prefs.set(KEYS.token, null);
  prefs.set(KEYS.user, null);
  window.dispatchEvent(new Event('fw:unauthorized'));
}

/**
 * Appelle le backend simulé (mode démonstration) avec le même contrat que l'API réelle.
 * @param {string} path chemin relatif à /api
 * @param {object} options méthode, corps et jeton
 * @param {boolean} raw vrai pour renvoyer {data, etag, status}
 * @returns {Promise<*>} la réponse simulée
 */
async function demoRequest(path, { method, body, token }, raw) {
  const backend = await demoBackend();
  try {
    const data = await backend.request(path, { method, body, token });
    return raw ? { data, etag: data?.etag ?? null, status: 200 } : data;
  } catch (e) {
    if (e.status === 401 && token && !path.startsWith('/auth/login')) expireSession();
    throw new ApiError(e.status ?? 500, frenchMessage(e.status ?? 500, e.message, path), e.message);
  }
}

/**
 * Appel REST JSON vers l'API.
 * @param {string} path chemin relatif à /api (ex. '/stations?limit=10')
 * @param {object} [options]
 * @param {string} [options.method='GET'] méthode HTTP
 * @param {*} [options.body] corps JSON
 * @param {string} [options.ifMatch] ETag attendu (contrôle de concurrence optimiste → 412 si périmé)
 * @param {boolean} [options.raw=false] vrai pour obtenir {data, etag, status}
 * @param {AbortSignal} [options.signal] annulation
 * @returns {Promise<*>} le corps décodé (null pour 204)
 * @throws {ApiError} erreur réseau ou HTTP, message en français
 */
export async function api(path, { method = 'GET', body, ifMatch, raw = false, signal } = {}) {
  const token = prefs.get(KEYS.token);
  if (demo.active) return demoRequest(path, { method, body, token }, raw);

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  // StationDto.etag n'est pas entre guillemets ; l'en-tête HTTP l'exige (RFC 9110).
  if (ifMatch) headers['If-Match'] = ifMatch.startsWith('"') || ifMatch.startsWith('W/') ? ifMatch : `"${ifMatch}"`;

  let response;
  try {
    response = await fetch(`${CONFIG.apiBase}${path}`, {
      method, headers, signal, cache: 'no-store',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, STATUS_MESSAGES[0]);
  }

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const server = data?.error ?? null;
    if (response.status === 401 && token && !path.startsWith('/auth/login')) expireSession();
    throw new ApiError(response.status, frenchMessage(response.status, server, path), server);
  }
  return raw ? { data, etag: response.headers.get('ETag'), status: response.status } : data;
}

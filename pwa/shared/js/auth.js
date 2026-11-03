/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : shared/js/auth.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { api } from './api.js';
import { prefs, KEYS } from './prefs.js';

/**
 * Authentification par jeton : POST /api/auth/login renvoie {token, tokenType, expiresIn, user}
 * où user = UserDto {id, username, fullName, roles: ["OPERATOR", ...], enabled, createdAt}.
 * Le serveur stocke les rôles en masque de bits (CITIZEN=1, OPERATOR=2, ADMIN=4), mais le
 * jeton (claim « groups ») et UserDto les exposent déjà sous forme de noms.
 */

/**
 * Décode la charge utile d'un JWT (sans vérifier la signature : c'est le rôle du serveur).
 * @param {string} token jeton JWT
 * @returns {object|null} les claims, ou null si le jeton est illisible
 */
function decodeClaims(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(atob(part).split('').map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Session courante (lecture seule ; modifiée par login, refreshProfile et logout). */
export const session = {
  /** @returns {string|null} le jeton JWT courant */
  get token() {
    return prefs.get(KEYS.token);
  },
  /** @returns {object|null} l'utilisateur connecté (UserDto) */
  get user() {
    return prefs.getJSON(KEYS.user);
  },
  /**
   * @param {string} role 'CITIZEN' | 'OPERATOR' | 'ADMIN'
   * @returns {boolean} vrai si l'utilisateur possède ce rôle
   */
  hasRole(role) {
    return !!this.user?.roles?.includes(role);
  },
  /** @returns {boolean} vrai pour un opérateur ou un administrateur */
  get isOperator() {
    return this.hasRole('OPERATOR') || this.hasRole('ADMIN');
  },
  /** @returns {boolean} vrai pour un administrateur */
  get isAdmin() {
    return this.hasRole('ADMIN');
  },
  /**
   * Vérifie l'échéance du jeton (claim exp), avec 30 s de marge.
   * @returns {boolean} vrai si aucun jeton ou jeton expiré
   */
  get expired() {
    const token = this.token;
    if (!token) return true;
    if (token.startsWith('demo-token-')) return false; // jeton du mode démonstration
    const exp = decodeClaims(token)?.exp;
    return typeof exp === 'number' && exp * 1000 < Date.now() + 30_000;
  },
};

/**
 * Ouvre une session.
 * @param {string} username identifiant
 * @param {string} password mot de passe
 * @returns {Promise<object>} l'utilisateur connecté (UserDto)
 * @throws {import('./api.js').ApiError} 401 si les identifiants sont incorrects
 */
export async function login(username, password) {
  const res = await api('/auth/login', { method: 'POST', body: { username: username.trim(), password } });
  prefs.set(KEYS.token, res.token);
  prefs.setJSON(KEYS.user, res.user);
  return res.user;
}

/**
 * Recharge le profil (GET /api/auth/me), par exemple après un changement de rôle.
 * @returns {Promise<object>} l'utilisateur connecté (UserDto)
 */
export async function refreshProfile() {
  const user = await api('/auth/me');
  prefs.setJSON(KEYS.user, user);
  return user;
}

/** Ferme la session locale (le JWT est sans état côté serveur : rien à révoquer). */
export function logout() {
  prefs.set(KEYS.token, null);
  prefs.set(KEYS.user, null);
}

/**
 * Abonne une fonction à l'expiration de session (réponse 401 de l'API).
 * @param {() => void} handler fonction appelée
 * @returns {() => void} fonction de désabonnement
 */
export function onUnauthorized(handler) {
  window.addEventListener('fw:unauthorized', handler);
  return () => window.removeEventListener('fw:unauthorized', handler);
}

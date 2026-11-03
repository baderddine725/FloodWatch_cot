/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : pilotage/js/views/login.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { login, logout } from '../../../shared/js/auth.js';
import { demo, setDemo } from '../../../shared/js/config.js';
import { esc } from '../../../shared/js/format.js';
import { icon } from '../../../shared/js/icons.js';
import { brand } from '../ui.js';

/**
 * Écran de connexion (composant Login de la maquette), branché sur POST /api/auth/login.
 * L'API identifie les comptes par un identifiant (pas d'adresse e-mail) ; seuls les
 * opérateurs et administrateurs ont accès à la PWA Pilotage.
 */

/** Comptes de démonstration (mode ?demo=1 uniquement, voir shared/js/demo.js). */
const DEMO_ACCOUNTS = {
  OPERATOR: { username: 'operator', password: 'operator123!' },
  ADMIN: { username: 'admin', password: 'admin123!' },
};

/**
 * Affiche l'écran de connexion.
 * @param {HTMLElement} root conteneur de l'application
 * @param {object} options
 * @param {(user: object) => void} options.onLogin appelé avec l'utilisateur connecté
 * @param {string|null} [options.notice] message affiché au-dessus du formulaire (ex. session expirée)
 */
export function renderLogin(root, { onLogin, notice = null }) {
  document.title = 'Connexion · FloodWatch Pilotage';
  root.innerHTML = `<div class="login-screen">
    <div class="login-story">${brand()}
      <div class="login-illustration"><div class="water-ring ring-one"></div><div class="water-ring ring-two"></div>
        <div class="water-ring ring-three"></div>${icon('ShieldCheck', 95)}</div>
      <div class="login-story-copy"><span class="eyebrow">ANTICIPER. PROTÉGER. AGIR.</span>
        <h1>Une longueur d’avance<br>sur la montée des eaux.</h1>
        <p>La supervision intelligente des points critiques du Grand Tunis, au service de la sécurité de tous.</p>
        <span>${icon('ShieldCheck', 17)} Projet pilote · Grand Tunis</span></div>
    </div>
    <div class="login-main">
      <div class="login-form">
        <span class="eyebrow">ESPACE DE PILOTAGE</span>
        <h1>Heureux de vous retrouver.</h1>
        <p>Connectez-vous à votre centre de supervision.</p>
        ${notice ? `<div class="warning-note login-notice">${icon('Clock3', 18)}${esc(notice)}</div>` : ''}
        <form novalidate>
          <label class="form-label">Identifiant
            <input name="username" required autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Votre identifiant"></label>
          <label class="form-label">Mot de passe
            <input name="password" type="password" required autocomplete="current-password" placeholder="Votre mot de passe"></label>
          <p class="red-text login-error" role="alert" hidden></p>
          <button type="submit" class="button primary">Se connecter ${icon('ArrowRight', 16)}</button>
        </form>
        ${demo.active ? `<div class="demo-login-separator"><span></span>EXPLOREZ LA DÉMONSTRATION<span></span></div>
          <button type="button" class="button" data-demo="OPERATOR">${icon('Eye', 17)} Se connecter en Opérateur ${icon('ArrowRight', 15)}</button>
          <button type="button" class="button" data-demo="ADMIN">${icon('ShieldCheck', 17)} Se connecter en Administrateur ${icon('ArrowRight', 15)}</button>
          <p class="login-disclaimer">${icon('Shield', 13)} Environnement de démonstration · Données simulées dans le navigateur
            ${demo.forced ? '' : '· <button type="button" class="text-button" data-demo-exit>Quitter</button>'}</p>`
    : `<p class="login-disclaimer">${icon('Lock', 13)} Accès réservé aux opérateurs et administrateurs · Connexion chiffrée (TLS)
          · <button type="button" class="text-button" data-demo-enter>Mode démonstration</button></p>`}
      </div>
      <footer>FloodWatch Pilotage © ${new Date().getFullYear()} · Protéger nos villes, ensemble.</footer>
    </div></div>`;

  const form = root.querySelector('form');
  const error = root.querySelector('.login-error');
  const submit = form.querySelector('[type=submit]');

  /**
   * Tente la connexion et filtre les comptes sans rôle opérateur ou administrateur.
   * @param {string} username identifiant
   * @param {string} password mot de passe
   */
  async function attempt(username, password) {
    error.hidden = true;
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    try {
      const user = await login(username, password);
      if (!user.roles?.some((r) => r === 'OPERATOR' || r === 'ADMIN')) {
        logout();
        throw new Error('Ce compte n’a pas accès à l’espace de pilotage (rôle opérateur ou administrateur requis).');
      }
      onLogin(user);
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      form.password.select();
    } finally {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.username.value.trim() || !form.password.value) {
      error.textContent = 'Saisissez votre identifiant et votre mot de passe.';
      error.hidden = false;
      return;
    }
    attempt(form.username.value, form.password.value);
  });
  root.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => {
    const account = DEMO_ACCOUNTS[b.dataset.demo];
    attempt(account.username, account.password);
  }));
  root.querySelector('[data-demo-exit]')?.addEventListener('click', () => setDemo(false));
  root.querySelector('[data-demo-enter]')?.addEventListener('click', () => setDemo(true));
  form.username.focus();
}

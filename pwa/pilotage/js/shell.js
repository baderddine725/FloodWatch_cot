/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : pilotage/js/shell.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { session } from '../../shared/js/auth.js';
import { demo, setDemo } from '../../shared/js/config.js';
import { dateTime, esc, time } from '../../shared/js/format.js';
import { icon } from '../../shared/js/icons.js';
import { prefs } from '../../shared/js/prefs.js';
import { pushEnabled, pushSupport, subscribePush, unsubscribePush } from '../../shared/js/push.js';
import { toast, toastError } from '../../shared/js/components/toast.js';
import { brand, initials, roleLabel } from './ui.js';

/**
 * Coquille de la PWA Pilotage (barre latérale, barre du haut et zone principale de la maquette).
 * Elle reste en place pendant toute la session : seuls la zone <main> et quelques compteurs
 * sont mis à jour, à chaque changement de page ou message temps réel.
 */

const DARK_KEY = 'fw.pilotage.dark';

/** Libellés de l'état de la connexion temps réel (bloc « Système » de la barre latérale). */
const LIVE_STATUS = {
  open: { title: 'Temps réel connecté', text: 'Flux WebSocket sécurisé actif', css: '' },
  connecting: { title: 'Connexion au serveur…', text: 'Ouverture du flux temps réel', css: 'warn' },
  reconnecting: { title: 'Reconnexion en cours…', text: 'Les données peuvent être en retard', css: 'warn' },
  closed: { title: 'Temps réel interrompu', text: 'Rechargez la page', css: 'down' },
};

/**
 * Applique le thème sombre ou clair (classe .dark de la maquette).
 * @param {boolean} dark vrai pour le thème sombre
 */
function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  prefs.set(DARK_KEY, dark ? '1' : null);
}

/**
 * Écran de chargement (composant InitialSkeleton de la maquette).
 * @param {HTMLElement} root conteneur de l'application
 */
export function renderSkeleton(root) {
  applyTheme(prefs.get(DARK_KEY) === '1');
  const blocks = (n, cls) => Array.from({ length: n }, () => `<div class="skeleton-block ${cls}"></div>`).join('');
  root.innerHTML = `<div class="app-shell skeleton-screen" aria-busy="true" aria-label="Chargement du réseau de supervision">
    <aside class="sidebar">${brand()}<div class="skeleton-block skeleton-workspace"></div>${blocks(3, 'skeleton-nav')}</aside>
    <div class="main-shell"><div class="topbar"><span class="skeleton-block skeleton-breadcrumb"></span></div>
      <main><div class="skeleton-block skeleton-title"></div><p class="skeleton-copy">Connexion au réseau de supervision…</p>
        <div class="kpi-grid">${blocks(5, 'skeleton-kpi')}</div>
        <div class="dashboard-middle">${blocks(2, 'skeleton-map')}</div><div class="skeleton-block skeleton-chart"></div></main></div></div>`;
}

/**
 * Construit la coquille.
 * @param {HTMLElement} root conteneur de l'application
 * @param {object} ctx contexte de l'application (store, navigation, déconnexion)
 * @param {{id: string, label: string, icon: string}[]} navItems entrées du menu visibles pour ce rôle
 * @returns {{main: HTMLElement, setActive: (id: string, label: string) => void, destroy: () => void}} contrôle de la coquille
 */
export function createShell(root, ctx, navItems) {
  const { store } = ctx;
  const user = session.user;
  applyTheme(prefs.get(DARK_KEY) === '1');

  root.innerHTML = `<div class="app-shell">
    <aside class="sidebar" id="sidebar">${brand()}
      <div class="workspace-switch"><div class="workspace-icon">${icon('Building2', 18)}</div>
        <div><strong>Grand Tunis</strong><span>Espace de supervision</span></div>${icon('ChevronDown', 14)}</div>
      <div class="nav-caption">ESPACE DE PILOTAGE</div>
      <nav aria-label="Navigation principale">${navItems.map((n) => `<a class="nav-item" href="#${n.id}" data-nav="${n.id}">
        ${icon(n.icon, 19)}<span>${esc(n.label)}</span>${n.id === 'alerts' ? '<b class="nav-count" data-unread hidden></b>' : ''}</a>`).join('')}</nav>
      <div class="sidebar-bottom">
        <div class="system-status" data-system role="status" aria-live="polite"><span class="status-orbit">${icon('Activity', 17)}</span>
          <div><strong data-system-title></strong><span data-system-text></span></div><span class="tiny-dot"></span></div>
        <div class="pilot-note">${icon('ShieldCheck', 15)}<span>${demo.active ? 'Mode démonstration · données simulées' : 'Projet pilote · Grand Tunis'}</span><span class="version">v1.0</span></div>
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <div class="breadcrumb">
          <button type="button" class="mobile-menu" data-menu aria-label="Ouvrir le menu" aria-controls="sidebar" aria-expanded="false">${icon('Menu', 21)}</button>
          <span>Espace de pilotage</span>${icon('ChevronRight', 13)}<strong data-crumb></strong>
        </div>
        <div class="topbar-right">
          <div class="global-search">${icon('Search', 16)}
            <input aria-label="Rechercher une station" placeholder="Rechercher une station…" autocomplete="off" data-search>
            <kbd>Ctrl K</kbd><div class="search-results" data-results hidden></div></div>
          <button type="button" class="icon-button" data-theme></button>
          <button type="button" class="notification-button" data-bell>${icon('Bell', 20)}<span data-bell-dot hidden></span></button>
          <span class="top-divider"></span>
          <div class="profile-wrap">
            <button type="button" class="profile-button" data-profile aria-haspopup="menu" aria-expanded="false">
              <span class="avatar">${esc(initials(user?.fullName || user?.username))}</span>
              <div><strong>${esc(user?.fullName || user?.username)}</strong><span>${esc(roleLabel(user))}</span></div>${icon('ChevronDown', 13)}</button>
            <div class="profile-menu" data-profile-menu role="menu" hidden>
              <span>@${esc(user?.username)} · ${esc((user?.roles ?? []).join(', '))}</span>
              <button type="button" role="menuitem" data-push>${icon('BellRing', 15)} <span data-push-label>Notifications sur cet appareil</span></button>
              ${demo.active && !demo.forced ? `<button type="button" role="menuitem" data-demo-exit>${icon('X', 15)} Quitter la démonstration</button>` : ''}
              <button type="button" role="menuitem" data-logout>${icon('LogOut', 15)} Se déconnecter</button>
            </div>
          </div>
        </div>
      </header>
      <div class="offline-banner" data-offline role="status" hidden></div>
      <main id="main" tabindex="-1"></main>
    </div></div>`;

  const $ = (sel) => root.querySelector(sel);
  const main = $('#main');
  const sidebar = $('#sidebar');
  const searchInput = $('[data-search]');
  const results = $('[data-results]');
  const profileMenu = $('[data-profile-menu]');
  const cleanups = [];

  // ------------------------------------------------------------------- compteurs et état du système
  /** Met à jour le nombre d'alertes à acquitter (menu et cloche). */
  function renderUnread() {
    const unread = store.state.alerts.filter((a) => a.active && !a.acknowledgedAt).length;
    const count = $('[data-unread]');
    if (count) {
      count.textContent = unread;
      count.hidden = unread === 0;
    }
    $('[data-bell-dot]').hidden = unread === 0;
    $('[data-bell]').setAttribute('aria-label', `${unread} alerte${unread > 1 ? 's' : ''} non acquittée${unread > 1 ? 's' : ''}`);
  }

  /** Met à jour le bloc « Système » selon l'état du flux temps réel. */
  function renderSystem() {
    const status = LIVE_STATUS[store.state.live] ?? LIVE_STATUS.connecting;
    const block = $('[data-system]');
    block.className = `system-status ${status.css}`;
    $('[data-system-title]').textContent = status.title;
    $('[data-system-text]').textContent = store.state.live === 'open' && store.state.lastUpdate
      ? `Dernier message à ${time(store.state.lastUpdate, true)}` : status.text;
  }

  /** Bouton du thème (icône et libellé selon l'état courant). */
  function renderThemeButton() {
    const dark = document.documentElement.classList.contains('dark');
    const button = $('[data-theme]');
    const label = dark ? 'Activer le mode clair' : 'Activer le mode sombre';
    button.innerHTML = icon(dark ? 'Sun' : 'Moon', 19);
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  /** Bandeau hors connexion : données mémorisées (IndexedDB) ou réseau coupé ; actions désactivées. */
  function renderOffline() {
    const banner = $('[data-offline]');
    const cachedAt = store.state.cachedAt;
    const down = !navigator.onLine;
    banner.hidden = !cachedAt && !down;
    if (banner.hidden) return;
    const since = cachedAt ?? store.state.lastUpdate;
    banner.innerHTML = `${icon('CloudOff', 17)}<span><strong>${down ? 'Hors connexion' : 'Serveur injoignable'}</strong> –
      ${cachedAt ? 'Données mémorisées' : 'Dernières données reçues'}${since ? ` du ${esc(dateTime(since))}` : ''}.
      Commandes et acquittements désactivés jusqu’au retour du réseau.</span>`;
  }

  cleanups.push(store.subscribe('alerts', renderUnread), store.subscribe('live', renderSystem),
    store.subscribe('live', renderOffline), store.subscribe('cache', renderOffline));
  renderOffline();
  // l'heure du dernier message est rafraîchie au plus toutes les 5 s (pas à chaque mesure)
  const systemTimer = setInterval(renderSystem, 5000);
  cleanups.push(() => clearInterval(systemTimer));
  renderUnread();
  renderSystem();
  renderThemeButton();

  // ------------------------------------------------------------------- recherche de station
  /** Affiche les stations correspondant à la saisie. */
  function renderResults() {
    const q = searchInput.value.trim().toLowerCase();
    const list = [...store.state.stations.values()]
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || (s.address ?? '').toLowerCase().includes(q))
      .slice(0, 8);
    results.innerHTML = `<div class="search-results-title">STATIONS DU GRAND TUNIS
        <button type="button" data-search-close aria-label="Fermer la recherche">${icon('X', 13)}</button></div>
      ${list.map((s) => `<button type="button" data-open-station="${esc(s.code)}">${icon('MapPin', 14)}<span>${esc(s.name)}</span>${icon('ChevronRight', 13)}</button>`).join('')}
      ${list.length ? '' : '<p>Aucune station trouvée.</p>'}`;
    results.hidden = false;
  }
  /** Ferme la liste de résultats. */
  const closeResults = () => { results.hidden = true; };

  searchInput.addEventListener('focus', renderResults);
  searchInput.addEventListener('input', renderResults);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeResults();
      searchInput.blur();
    }
    if (e.key === 'Enter') results.querySelector('[data-open-station]')?.click();
  });
  results.addEventListener('click', (e) => {
    if (e.target.closest('[data-search-close]')) closeResults();
    if (e.target.closest('[data-open-station]')) {
      searchInput.value = '';
      closeResults();
    }
  });

  // ------------------------------------------------------------------- notifications push (cet appareil)
  /** Met à jour le libellé de l'entrée « Notifications » du menu du profil. */
  async function renderPushLabel() {
    const label = $('[data-push-label]');
    if (!pushSupport().supported) {
      label.textContent = 'Notifications indisponibles ici';
      return;
    }
    label.textContent = (await pushEnabled()) ? 'Désactiver les notifications' : 'Activer les notifications';
  }

  /** Active ou désactive les notifications Web Push de toutes les alertes sur cet appareil. */
  async function togglePush() {
    const support = pushSupport();
    if (!support.supported) {
      toastError(support.reason);
      return;
    }
    try {
      if (await pushEnabled()) {
        await unsubscribePush();
        toast('Notifications désactivées sur cet appareil.');
      } else {
        await subscribePush();
        toast('Notifications activées : vous recevrez toutes les alertes, même application fermée.');
      }
    } catch (e) {
      toastError(e);
    }
    renderPushLabel();
  }

  // ------------------------------------------------------------------- menu du profil, thème, menu mobile
  /**
   * Ouvre ou ferme le menu du profil.
   * @param {boolean} open vrai pour l'ouvrir
   */
  function setProfile(open) {
    profileMenu.hidden = !open;
    $('[data-profile]').setAttribute('aria-expanded', String(open));
    if (open) renderPushLabel();
  }

  /**
   * Ouvre ou ferme la barre latérale en affichage étroit.
   * @param {boolean} open vrai pour l'ouvrir
   */
  function setMobile(open) {
    sidebar.classList.toggle('mobile-open', open);
    $('[data-menu]').setAttribute('aria-expanded', String(open));
  }

  /**
   * Clics de la coquille (thème, cloche, profil, menu mobile, recherche).
   * @param {MouseEvent} e événement
   */
  const onClick = (e) => {
    if (e.target.closest('[data-theme]')) {
      applyTheme(!document.documentElement.classList.contains('dark'));
      renderThemeButton();
    }
    if (e.target.closest('[data-bell]')) ctx.navigate('alerts');
    if (e.target.closest('[data-profile]')) setProfile(profileMenu.hidden);
    else if (!e.target.closest('[data-profile-menu]')) setProfile(false);
    if (e.target.closest('[data-push]')) {
      setProfile(false);
      togglePush();
    }
    if (e.target.closest('[data-logout]')) {
      ctx.logout();
      return;
    }
    if (e.target.closest('[data-demo-exit]')) setDemo(false);
    if (e.target.closest('[data-menu]')) setMobile(!sidebar.classList.contains('mobile-open'));
    else if (e.target.closest('[data-nav]')) setMobile(false);
    if (!e.target.closest('.global-search')) closeResults();
  };
  root.addEventListener('click', onClick);
  cleanups.push(() => root.removeEventListener('click', onClick));

  /**
   * Raccourcis clavier : Ctrl/⌘ K pour la recherche, Échap pour fermer les menus.
   * @param {KeyboardEvent} e événement clavier
   */
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      searchInput.focus();
    }
    if (e.key === 'Escape') {
      setProfile(false);
      setMobile(false);
    }
  };
  window.addEventListener('keydown', onKey);
  cleanups.push(() => window.removeEventListener('keydown', onKey));

  return {
    main,
    /**
     * Met en évidence l'entrée de menu et le fil d'Ariane de la page affichée.
     * @param {string} id identifiant de la page (entrée de menu)
     * @param {string} label libellé du fil d'Ariane
     */
    setActive(id, label) {
      root.querySelectorAll('[data-nav]').forEach((a) => {
        const active = a.dataset.nav === id;
        a.classList.toggle('active', active);
        if (active) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
      $('[data-crumb]').textContent = label;
      document.title = `${label} · FloodWatch Pilotage`;
    },
    /** Retire les abonnements et écouteurs globaux. */
    destroy() {
      cleanups.forEach((fn) => fn());
    },
  };
}

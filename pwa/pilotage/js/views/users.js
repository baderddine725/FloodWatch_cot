/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : pilotage/js/views/users.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { api } from '../../../shared/js/api.js';
import { session } from '../../../shared/js/auth.js';
import { dateTime, esc } from '../../../shared/js/format.js';
import { icon } from '../../../shared/js/icons.js';
import { confirmDialog, openModal } from '../../../shared/js/components/modal.js';
import { toast, toastError } from '../../../shared/js/components/toast.js';
import { emptyState, initials, pageHeading, roleLabel } from '../ui.js';

/**
 * Page « Utilisateurs » de la maquette (administrateurs) : GET/POST /api/users,
 * PUT/DELETE /api/users/{id}. Les rôles sont transmis par leur nom (OPERATOR, ADMIN) ; le serveur
 * les stocke en masque de bits.
 *
 * ÉCARTS MAQUETTE / API : pas d'adresse e-mail ni d'invitation par courriel. La création d'un
 * compte demande un identifiant et un mot de passe initial (8 caractères minimum) à transmettre
 * à la personne.
 */

/** Rôles proposés (un administrateur garde aussi le rôle opérateur, comme les comptes initiaux). */
const ROLE_SETS = { OPERATOR: ['OPERATOR'], ADMIN: ['ADMIN', 'OPERATOR'] };

/**
 * Ouvre la création de compte (InviteModal de la maquette, adaptée à l'API).
 * @param {() => void} onCreated appelé après création
 */
function openCreateModal(onCreated) {
  openModal({
    title: 'Créer un compte',
    html: `<p>Ajoutez un membre à l’équipe de supervision. Communiquez-lui son identifiant et son mot de passe initial.</p>
      <form novalidate>
        <label class="form-label">Nom complet<input name="fullName" required placeholder="Prénom et nom" autocomplete="off"></label>
        <label class="form-label">Identifiant de connexion<input name="username" required placeholder="ex. operateur.ariana" autocapitalize="none" spellcheck="false" autocomplete="off"></label>
        <label class="form-label">Mot de passe initial <span class="muted">(8 caractères minimum)</span>
          <input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
        <label class="form-label">Rôle<select name="role"><option value="OPERATOR">Opérateur</option><option value="ADMIN">Administrateur</option></select></label>
        <p class="red-text" data-error hidden></p>
        <div class="modal-actions"><button type="button" class="button" data-close>Annuler</button>
          <button type="submit" class="button primary">Créer le compte ${icon('ArrowRight', 15)}</button></div>
      </form>`,
    onMount: (root, close) => {
      const form = root.querySelector('form');
      const error = root.querySelector('[data-error]');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {
          fullName: form.fullName.value.trim(), username: form.username.value.trim(), password: form.password.value,
          roles: ROLE_SETS[form.role.value], enabled: true,
        };
        const problem = !body.fullName ? 'Le nom complet est obligatoire.' : !body.username ? 'L’identifiant est obligatoire.'
          : body.password.length < 8 ? 'Le mot de passe doit contenir au moins 8 caractères.' : null;
        if (problem) {
          error.textContent = problem;
          error.hidden = false;
          return;
        }
        form.querySelector('[type=submit]').disabled = true;
        try {
          await api('/users', { method: 'POST', body });
          close();
          toast(`Compte créé pour ${body.fullName} (identifiant ${body.username}).`);
          onCreated();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
          form.querySelector('[type=submit]').disabled = false;
        }
      });
    },
  });
}

/**
 * Affiche la page des utilisateurs.
 * @param {HTMLElement} main zone principale
 * @param {object} ctx contexte de l'application
 * @returns {() => void} nettoyage
 */
export function mountUsers(main, ctx) {
  let users = [];
  let destroyed = false;
  const me = session.user;

  main.innerHTML = `${pageHeading({
    eyebrow: 'ESPACE DE PILOTAGE', title: 'Utilisateurs', subtitle: 'Gérez les accès de votre équipe à la plateforme.',
    actions: `<button type="button" class="button primary" data-create>${icon('Plus', 16)} Créer un compte</button>`,
  })}
    <section class="card table-card">
      <div class="table-toolbar"><div><h2>Membres de l’équipe <span class="neutral-count" data-total></span></h2>
        <p class="muted">Les opérateurs supervisent le réseau. Les administrateurs le configurent.</p></div></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Utilisateur</th><th>Rôle</th><th>Statut</th><th>Créé le</th><th>Accès</th></tr></thead>
        <tbody data-rows></tbody></table><div data-empty></div></div>
    </section>`;

  /** Affiche le tableau. */
  function render() {
    main.querySelector('[data-total]').textContent = users.length;
    main.querySelector('[data-rows]').innerHTML = users.map((u) => {
      const self = u.username === me?.username;
      const admin = u.roles.includes('ADMIN');
      return `<tr><td><div class="user-cell"><span class="avatar">${esc(initials(u.fullName || u.username))}</span>
          <div><strong>${esc(u.fullName || u.username)}${self ? '<span class="you-badge">Vous</span>' : ''}</strong><small>@${esc(u.username)}</small></div></div></td>
        <td><select class="role-select" data-role="${esc(u.id)}" aria-label="Rôle de ${esc(u.username)}" ${self ? 'disabled title="Vous ne pouvez pas modifier votre propre rôle"' : ''}>
          <option value="OPERATOR" ${admin ? '' : 'selected'}>Opérateur</option><option value="ADMIN" ${admin ? 'selected' : ''}>Administrateur</option></select>
          ${u.roles.includes('OPERATOR') || admin ? '' : `<small>${esc(roleLabel(u))}</small>`}</td>
        <td><span class="badge ${u.enabled ? 'green' : 'offline'}"><span class="tiny-dot"></span>${u.enabled ? 'Actif' : 'Désactivé'}</span></td>
        <td>${dateTime(u.createdAt)}</td>
        <td><div class="table-actions"><button type="button" class="button" data-toggle="${esc(u.id)}" ${self ? 'disabled' : ''}>${u.enabled ? 'Désactiver' : 'Réactiver'}</button>
          <button type="button" class="icon-button" data-remove="${esc(u.id)}" ${self ? 'disabled' : ''} aria-label="Supprimer le compte ${esc(u.username)}" title="Supprimer">${icon('Trash2', 15)}</button></div></td></tr>`;
    }).join('');
    main.querySelector('[data-empty]').innerHTML = users.length ? '' : emptyState('Aucun compte enregistré.', 'Aucun utilisateur');
  }

  /** Charge la liste (GET /api/users). */
  async function load() {
    try {
      const list = await api('/users');
      if (destroyed) return;
      users = list.sort((a, b) => (a.fullName || a.username).localeCompare(b.fullName || b.username, 'fr'));
      render();
    } catch (e) {
      toastError(e);
    }
  }

  /**
   * Met à jour un compte (PUT /api/users/{id}) puis recharge la liste.
   * @param {object} user UserDto
   * @param {object} body champs modifiés
   * @param {string} done message de confirmation
   */
  async function update(user, body, done) {
    try {
      await api(`/users/${encodeURIComponent(user.id)}`, { method: 'PUT', body });
      toast(done);
    } catch (e) {
      toastError(e);
    }
    load();
  }

  main.addEventListener('click', async (e) => {
    if (e.target.closest('[data-create]')) openCreateModal(load);
    const toggle = e.target.closest('[data-toggle]');
    const remove = e.target.closest('[data-remove]');
    const user = users.find((u) => u.id === (toggle?.dataset.toggle ?? remove?.dataset.remove));
    if (!user) return;
    if (toggle) update(user, { enabled: !user.enabled }, `Compte ${user.enabled ? 'désactivé' : 'réactivé'} : ${user.fullName || user.username}.`);
    if (remove && await confirmDialog({
      title: 'Supprimer le compte ?', danger: true, confirmLabel: 'Supprimer le compte',
      message: `Le compte « ${user.username} » ne pourra plus se connecter. Cette action est irréversible.`,
    })) {
      try {
        await api(`/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
        toast('Compte supprimé.');
      } catch (err) {
        toastError(err);
      }
      load();
    }
  });
  main.addEventListener('change', (e) => {
    const select = e.target.closest('[data-role]');
    const user = users.find((u) => u.id === select?.dataset.role);
    if (user) update(user, { roles: ROLE_SETS[select.value] }, `Rôle mis à jour : ${user.fullName || user.username} est ${select.value === 'ADMIN' ? 'administrateur' : 'opérateur'}.`);
  });

  load();
  return () => { destroyed = true; };
}

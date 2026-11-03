/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : pilotage/js/station-form.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { api } from '../../shared/js/api.js';
import { STATION_TYPES, esc } from '../../shared/js/format.js';
import { icon } from '../../shared/js/icons.js';
import { createMap } from '../../shared/js/components/map.js';
import { openModal } from '../../shared/js/components/modal.js';
import { toast } from '../../shared/js/components/toast.js';

/**
 * Création et configuration d'une station (composant StationForm de la maquette), réservées
 * aux administrateurs : POST /api/stations ou PUT /api/stations/{code} avec If-Match.
 * La mise à jour republie automatiquement la configuration vers la station (topic config retenu).
 */

/** Champs de configuration comparés pour détecter une modification par un autre administrateur. */
const CONFIG_FIELDS = ['name', 'address', 'description', 'type', 'latitude', 'longitude'];

/** Valeurs par défaut d'une nouvelle station (identiques aux valeurs initiales du serveur). */
const DEFAULT_THRESHOLDS = {
  criticalCm: 20, yellowPct: 30, orangePct: 60, redPct: 85, rainThreshold: 0.2, rapidRiseCmPerMin: 3,
  forecastRedMinutes: 10, reopenDelaySec: 60, sensorHeightCm: 30, periodNormalSec: 30, periodWatchSec: 5,
};

/**
 * Empreinte de la configuration d'une station (sans l'état mesuré).
 * @param {object} s StationDto
 * @returns {string} configuration sérialisée
 */
function configOf(s) {
  return JSON.stringify([...CONFIG_FIELDS.map((k) => s[k] ?? null), s.thresholds ?? null]);
}

/**
 * Enregistre la configuration en gérant la concurrence optimiste.
 *
 * TEMPORAIRE (écart back-end) : l'ETag d'une station dérive de sa @Version, qui augmente à
 * CHAQUE mesure reçue (toutes les 5 à 30 s). Un If-Match pris à l'ouverture du formulaire
 * échouerait donc presque toujours (412) sans qu'aucun administrateur n'ait rien modifié.
 * Contournement : on compare la configuration actuelle à celle de l'ouverture du formulaire ;
 * si elle a changé, c'est un vrai conflit (message + rechargement) ; sinon on envoie l'ETag le
 * plus récent, avec une seule nouvelle tentative si une mesure arrive pendant l'envoi.
 * À retirer quand le serveur exposera un ETag propre à la configuration.
 *
 * @param {string} code code de la station
 * @param {object} body StationRequest
 * @param {string} baseline empreinte de la configuration à l'ouverture du formulaire
 * @returns {Promise<{station?: object, conflict?: object, busy?: boolean}>} station enregistrée, version
 *   concurrente, ou busy si la station a changé de version à chaque essai (mesures très rapprochées)
 */
async function saveWithConcurrency(code, body, baseline) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: current, etag } = await api(`/stations/${encodeURIComponent(code)}`, { raw: true });
    if (configOf(current) !== baseline) return { conflict: current };
    try {
      return { station: await api(`/stations/${encodeURIComponent(code)}`, { method: 'PUT', body, ifMatch: etag ?? current.etag }) };
    } catch (e) {
      if (e.status !== 412 && e.status !== 409) throw e;
      // une mesure a fait évoluer la version pendant l'envoi : on relit et on réessaie une fois
    }
  }
  const { data: latest } = await api(`/stations/${encodeURIComponent(code)}`, { raw: true });
  return configOf(latest) === baseline ? { busy: true } : { conflict: latest };
}

/**
 * Champ numérique du formulaire.
 * @param {string} name nom du champ
 * @param {string} label libellé
 * @param {number|string} value valeur
 * @param {object} [attrs] attributs (min, max, step)
 * @returns {string} HTML
 */
function numberField(name, label, value, { min = '', max = '', step = 'any' } = {}) {
  return `<label class="form-label">${label}<input name="${name}" type="number" required value="${esc(value)}" min="${min}" max="${max}" step="${step}"></label>`;
}

/**
 * Ouvre le formulaire de station.
 * @param {object} ctx contexte de l'application
 * @param {object|null} station StationDto à configurer, ou null pour une création
 */
export function openStationForm(ctx, station = null) {
  const creating = !station;
  const s = station ?? { name: '', address: '', type: 'UNDERPASS', latitude: 36.8065, longitude: 10.1815, thresholds: DEFAULT_THRESHOLDS };
  const t = { ...DEFAULT_THRESHOLDS, ...s.thresholds };
  let baseline = creating ? null : configOf(station);
  let pickMap = null;

  const modal = openModal({
    title: creating ? 'Ajouter une station' : 'Configurer la station',
    wide: true,
    html: `<form class="station-form" novalidate>
      ${creating ? `<div class="form-grid">
        <label class="form-label">Code de la station <span class="muted">· minuscules, chiffres et tirets</span>
          <input name="code" required pattern="[a-z0-9][a-z0-9-]{1,62}" placeholder="ex. underpass-02" autocapitalize="none" spellcheck="false"></label>
        <label class="form-label">Type de point<select name="type">${Object.entries(STATION_TYPES).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
      </div>` : ''}
      <div class="form-grid">
        <label class="form-label">Nom de la station<input name="name" required value="${esc(s.name)}" placeholder="Ex. Passage souterrain El Menzah"></label>
        <label class="form-label">Adresse / zone<input name="address" value="${esc(s.address ?? '')}" placeholder="Ex. Avenue principale, Ariana"></label>
      </div>
      <label class="form-label">Position GPS <span class="muted">· Cliquez sur la carte pour positionner la station</span></label>
      <div class="map compact" data-pick-map></div>
      <div class="form-grid">
        ${numberField('latitude', 'Latitude', s.latitude, { min: -90, max: 90, step: 0.0001 })}
        ${numberField('longitude', 'Longitude', s.longitude, { min: -180, max: 180, step: 0.0001 })}
      </div>
      <div class="form-grid">
        ${numberField('criticalCm', 'Hauteur critique (cm)', t.criticalCm, { min: 1, max: 1000, step: 0.5 })}
        ${numberField('reopenDelaySec', 'Délai de réouverture (s)', t.reopenDelaySec, { min: 0, max: 3600, step: 1 })}
      </div>
      <div class="threshold-sliders">${[['yellowPct', 'Seuil jaune'], ['orangePct', 'Seuil orange'], ['redPct', 'Seuil rouge']].map(([k, l]) => `
        <label class="form-label"><span>${l}<b data-out="${k}">${t[k]} %</b></span>
          <input type="range" name="${k}" min="1" max="100" value="${t[k]}"></label>`).join('')}</div>
      <div class="form-grid">
        <label class="form-label">Fréquence de mesure normale<select name="periodNormalSec">${[15, 30, 60, 120].map((v) => `<option value="${v}" ${v === t.periodNormalSec ? 'selected' : ''}>Toutes les ${v < 60 ? `${v} secondes` : v === 60 ? 'minutes' : `${v / 60} minutes`}</option>`).join('')}
          ${[15, 30, 60, 120].includes(t.periodNormalSec) ? '' : `<option value="${t.periodNormalSec}" selected>Toutes les ${t.periodNormalSec} s</option>`}</select></label>
        <label class="form-label">Fréquence renforcée (vigilance)<select name="periodWatchSec">${[2, 5, 10, 15].map((v) => `<option value="${v}" ${v === t.periodWatchSec ? 'selected' : ''}>Toutes les ${v} secondes</option>`).join('')}
          ${[2, 5, 10, 15].includes(t.periodWatchSec) ? '' : `<option value="${t.periodWatchSec}" selected>Toutes les ${t.periodWatchSec} s</option>`}</select></label>
      </div>
      <details class="advanced-settings"><summary>${icon('SlidersHorizontal', 15)} Réglages avancés du moteur d’alerte</summary>
        <div class="form-grid">
          ${numberField('sensorHeightCm', 'Hauteur du capteur (cm)', t.sensorHeightCm, { min: 1, max: 2000, step: 0.5 })}
          ${numberField('rainPct', 'Seuil de pluie (%)', Math.round((t.rainThreshold ?? 0.2) * 100), { min: 0, max: 100, step: 1 })}
          ${numberField('rapidRiseCmPerMin', 'Montée rapide (cm/min)', t.rapidRiseCmPerMin, { min: 0.1, max: 100, step: 0.1 })}
          ${numberField('forecastRedMinutes', 'Rouge si débordement prévu sous (min)', t.forecastRedMinutes, { min: 1, max: 120, step: 1 })}
        </div></details>
      <div class="warning-note" data-error hidden></div>
      <div class="sync-label">${icon('CheckCheck', 15)} La configuration sera envoyée à la station dès l’enregistrement.</div>
      <div class="modal-actions"><button type="button" class="button" data-close>Annuler</button>
        <button type="submit" class="button primary">${icon('Check', 16)} ${creating ? 'Créer la station' : 'Enregistrer et synchroniser'}</button></div>
    </form>`,
    onClose: () => pickMap?.destroy(),
  });

  const form = modal.root.querySelector('form');
  const error = form.querySelector('[data-error]');
  const submit = form.querySelector('[type=submit]');

  // Carte de positionnement : un clic déplace la station
  pickMap = createMap(form.querySelector('[data-pick-map]'), {
    popup: false, region: false,
    onPick: (lat, lng) => {
      form.latitude.value = lat.toFixed(5);
      form.longitude.value = lng.toFixed(5);
      showPin();
    },
  });

  /** Place le repère de la station selon les champs latitude / longitude. */
  function showPin() {
    const lat = Number(form.latitude.value);
    const lng = Number(form.longitude.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    pickMap.update([{ ...s, code: s.code ?? 'new', name: form.name.value || 'Nouvelle station', latitude: lat, longitude: lng, online: true, alertLevel: s.alertLevel ?? 'GREEN' }]);
    pickMap.focus(s.code ?? 'new'); // la carte suit les coordonnées saisies à la main
  }
  showPin();
  requestAnimationFrame(() => { pickMap.invalidate(); pickMap.fit(); });

  /**
   * Affiche une erreur dans le formulaire.
   * @param {string} message texte
   */
  const fail = (message) => {
    error.innerHTML = `${icon('TriangleAlert', 18)}<span>${esc(message)}</span>`;
    error.hidden = false;
    submit.disabled = false;
  };

  /**
   * Lit le formulaire.
   * @returns {object} StationRequest
   */
  function readBody() {
    const n = (k) => Number(form[k].value);
    return {
      ...(creating && { code: form.code.value.trim(), type: form.type.value }),
      name: form.name.value.trim(),
      address: form.address.value.trim(),
      latitude: n('latitude'),
      longitude: n('longitude'),
      thresholds: {
        criticalCm: n('criticalCm'), yellowPct: n('yellowPct'), orangePct: n('orangePct'), redPct: n('redPct'),
        reopenDelaySec: n('reopenDelaySec'), periodNormalSec: n('periodNormalSec'), periodWatchSec: n('periodWatchSec'),
        sensorHeightCm: n('sensorHeightCm'), rainThreshold: n('rainPct') / 100, rapidRiseCmPerMin: n('rapidRiseCmPerMin'),
        forecastRedMinutes: n('forecastRedMinutes'),
      },
    };
  }

  form.addEventListener('input', (e) => {
    const out = form.querySelector(`[data-out="${e.target.name}"]`);
    if (out) out.textContent = `${e.target.value} %`;
    if (e.target.name === 'latitude' || e.target.name === 'longitude') showPin();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const body = readBody();
    const th = body.thresholds;
    // contrôles de saisie (le serveur revalide tout)
    if (creating && !/^[a-z0-9][a-z0-9-]{1,62}$/.test(body.code)) return fail('Code invalide : minuscules, chiffres et tirets (2 à 63 caractères).');
    if (!body.name) return fail('Le nom de la station est obligatoire.');
    if (!(th.yellowPct < th.orangePct && th.orangePct < th.redPct)) return fail('Les seuils doivent respecter : Jaune < Orange < Rouge.');
    if (th.sensorHeightCm < th.criticalCm) return fail('La hauteur du capteur doit être supérieure ou égale à la hauteur critique.');
    if (th.periodWatchSec > th.periodNormalSec) return fail('La fréquence renforcée doit être plus rapide que la fréquence normale.');
    if (!ctx.canAct()) return fail('Hors connexion : l’enregistrement sera possible au retour du réseau.');
    submit.disabled = true;
    try {
      if (creating) {
        const created = await api('/stations', { method: 'POST', body });
        ctx.store.upsertStation(created);
        modal.close();
        toast(`Station « ${created.name} » créée. Configurez le firmware avec le code ${created.code}.`);
        return;
      }
      const result = await saveWithConcurrency(station.code, body, baseline);
      if (result.conflict) {
        ctx.store.upsertStation(result.conflict);
        baseline = configOf(result.conflict);
        modal.close();
        toast('La station a été modifiée entre-temps par un autre administrateur : les données ont été rechargées. Vérifiez puis recommencez.', { kind: 'error', duration: 8000 });
        openStationForm(ctx, result.conflict);
        return;
      }
      if (result.busy) return fail('La station transmet des mesures en continu et sa version a changé pendant l’envoi. Réessayez dans quelques secondes.');
      ctx.store.upsertStation(result.station);
      modal.close();
      toast('Configuration enregistrée et synchronisée avec la station ✓');
    } catch (err) {
      fail(err.message);
    }
  });
}

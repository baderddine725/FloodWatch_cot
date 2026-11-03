/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : shared/js/store.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { ACTUATORS, ALERT_TYPES, LEVELS, VALUES, levelOf } from './format.js';

/**
 * État observable des PWA (patron Observer), alimenté par l'API REST et le flux /ws/live.
 * Remplace le store simulé de la maquette : aucune valeur métier n'est calculée ici, le store
 * ne fait que ranger les DTO du serveur et prévenir les vues concernées.
 *
 * Sujets d'abonnement :
 *  - 'stations'    : une station a changé (payload : code, ou null si toute la liste) ;
 *  - 'measurement' : nouvelle mesure {stationCode, measurement} ;
 *  - 'alerts'      : la liste des alertes a changé (payload : AlertDto modifiée ou null) ;
 *  - 'commands'    : une commande a changé de statut (payload : CommandDto) ;
 *  - 'feed'        : nouvel événement dans le journal en direct ;
 *  - 'live'        : état de la connexion temps réel ;
 *  - 'cache'       : affichage de données mémorisées (payload : savedAt ou null).
 */

/** Taille maximale du journal d'événements et des tampons de points par station. */
const FEED_MAX = 80;
const POINTS_MAX = 3000;

/**
 * Crée un store.
 * @returns {object} le store (état + méthodes)
 */
export function createStore() {
  const listeners = new Map();

  const state = {
    /** @type {Map<string, object>} StationDto par code */
    stations: new Map(),
    /** @type {object[]} AlertDto, les plus récentes d'abord */
    alerts: [],
    /** @type {Map<string, object>} CommandDto par id */
    commands: new Map(),
    /** @type {Map<string, object[]>} points de mesure récents par code de station */
    points: new Map(),
    /** @type {{id: number, at: string, level: string|null, stationCode: string|null, text: string}[]} */
    feed: [],
    /** @type {'connecting'|'open'|'reconnecting'|'closed'} */
    live: 'connecting',
    /** @type {string|null} date des données mémorisées affichées (null = données en direct) */
    cachedAt: null,
    /** @type {string|null} instant du dernier message reçu */
    lastUpdate: null,
  };

  let feedId = 0;

  /**
   * Abonne une fonction à un sujet.
   * @param {string} topic sujet
   * @param {(payload: *) => void} fn fonction appelée
   * @returns {() => void} désabonnement
   */
  function subscribe(topic, fn) {
    if (!listeners.has(topic)) listeners.set(topic, new Set());
    listeners.get(topic).add(fn);
    return () => listeners.get(topic)?.delete(fn);
  }

  /**
   * Prévient les abonnés d'un sujet (une erreur d'une vue n'empêche pas les autres).
   * @param {string} topic sujet
   * @param {*} payload donnée transmise
   */
  function emit(topic, payload) {
    for (const fn of listeners.get(topic) ?? []) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[store] abonné « ${topic} » en erreur`, e);
      }
    }
  }

  /**
   * Ajoute un événement au journal en direct.
   * @param {string} text texte affiché
   * @param {string|null} [level] clé de niveau pour la couleur
   * @param {string|null} [stationCode] station concernée
   */
  function addFeed(text, level = null, stationCode = null) {
    state.feed.unshift({ id: ++feedId, at: new Date().toISOString(), level, stationCode, text });
    if (state.feed.length > FEED_MAX) state.feed.length = FEED_MAX;
    emit('feed', state.feed[0]);
  }

  /**
   * Remplace toutes les stations (REST /stations ou snapshot WebSocket).
   * @param {object[]} list StationDto
   */
  function setStations(list) {
    state.stations = new Map(list.map((s) => [s.code, s]));
    emit('stations', null);
  }

  /**
   * Met à jour une station et journalise les changements notables.
   * @param {object} station StationDto reçu
   */
  function upsertStation(station) {
    const previous = state.stations.get(station.code);
    state.stations.set(station.code, station);
    if (previous) {
      const before = levelOf(previous);
      const after = levelOf(station);
      if (before !== after) addFeed(`${station.name} : ${LEVELS[before].label} → ${LEVELS[after].label}`, after, station.code);
      if (previous.barrier !== station.barrier && station.barrier !== 'UNKNOWN') {
        addFeed(`${station.name} : barrière ${VALUES[station.barrier]}${station.localSafety ? ' (sécurité locale)' : ''}`, levelOf(station), station.code);
      }
    }
    emit('stations', station.code);
  }

  /**
   * Ajoute une mesure au tampon de la station.
   * @param {{stationCode: string, measurement: object}} data message WebSocket « measurement »
   */
  function addMeasurement(data) {
    const list = state.points.get(data.stationCode);
    if (list) {
      list.push(data.measurement);
      if (list.length > POINTS_MAX) list.splice(0, list.length - POINTS_MAX);
    }
    emit('measurement', data);
  }

  /**
   * Remplace l'historique de points d'une station (chargement REST).
   * @param {string} code code de la station
   * @param {object[]} points MeasurementDto triés par date
   */
  function setPoints(code, points) {
    state.points.set(code, points.slice(-POINTS_MAX));
  }

  /**
   * Remplace la liste des alertes (chargement REST).
   * @param {object[]} list AlertDto
   */
  function setAlerts(list) {
    state.alerts = [...list].sort((a, b) => Date.parse(b.raisedAt) - Date.parse(a.raisedAt));
    emit('alerts', null);
  }

  /**
   * Insère ou met à jour une alerte.
   * @param {object} alert AlertDto
   */
  function upsertAlert(alert) {
    const i = state.alerts.findIndex((a) => a.id === alert.id);
    if (i >= 0) {
      const wasActive = state.alerts[i].active;
      state.alerts[i] = alert;
      if (wasActive && !alert.active) addFeed(`Alerte résolue : ${alert.stationName} (${ALERT_TYPES[alert.type] ?? alert.type})`, 'GREEN', alert.stationCode);
    } else {
      state.alerts.unshift(alert);
      addFeed(`${ALERT_TYPES[alert.type] ?? alert.type} : ${alert.stationName}`, alert.type === 'OFFLINE' ? 'OFFLINE' : alert.level, alert.stationCode);
    }
    emit('alerts', alert);
  }

  /**
   * Insère ou met à jour une commande (statut PENDING → ACKED / FAILED).
   * @param {object} command CommandDto
   */
  function upsertCommand(command) {
    const isNew = !state.commands.has(command.id);
    state.commands.set(command.id, command);
    const what = `${ACTUATORS[command.actuator] ?? command.actuator} ${VALUES[command.value] ?? command.value}`;
    if (isNew) addFeed(`${command.origin === 'AUTO' ? 'Automatisme' : command.issuedBy} : ${what} (${command.stationCode})`, null, command.stationCode);
    else if (command.status === 'FAILED') addFeed(`Échec de la commande ${what} (${command.stationCode}) : ${command.detail ?? ''}`, 'RED', command.stationCode);
    emit('commands', command);
  }

  /**
   * Range des commandes chargées par REST (historique d'une station) sans les journaliser :
   * seules les commandes reçues en direct alimentent le journal d'événements.
   * @param {object[]} list CommandDto
   */
  function setCommands(list) {
    for (const command of list) {
      const known = state.commands.get(command.id);
      // une version plus récente reçue par le WebSocket n'est pas écrasée par une liste plus ancienne
      if (!known || known.status === 'PENDING') state.commands.set(command.id, command);
    }
    emit('commands', null);
  }

  /**
   * Applique un message du flux /ws/live.
   * @param {{type: string, data: *}} message message décodé
   */
  function applyLive(message) {
    state.lastUpdate = new Date().toISOString();
    if (state.cachedAt) {
      state.cachedAt = null;
      emit('cache', null);
    }
    const { type, data } = message;
    switch (type) {
      case 'snapshot': setStations(data); break;
      case 'station': upsertStation(data); break;
      case 'stationDeleted':
        state.stations.delete(data.code);
        state.points.delete(data.code);
        emit('stations', data.code);
        break;
      case 'measurement': addMeasurement(data); break;
      case 'alert': upsertAlert(data); break;
      case 'command': upsertCommand(data); break;
      case 'gateway': addFeed(`Passerelle ${data.gateway} : ${describeGatewayEvent(data.event)}`); break;
      default: break; // ping : seule la date de mise à jour compte
    }
  }

  /**
   * Indique l'état de la connexion temps réel.
   * @param {'connecting'|'open'|'reconnecting'|'closed'} live état
   */
  function setLive(live) {
    state.live = live;
    emit('live', live);
  }

  /**
   * Signale que les données affichées viennent du stockage hors connexion.
   * @param {string|null} savedAt date d'enregistrement (null = retour au direct)
   */
  function setCachedAt(savedAt) {
    state.cachedAt = savedAt;
    emit('cache', savedAt);
  }

  return {
    state, subscribe, emit, addFeed, setStations, upsertStation, setPoints, setAlerts, upsertAlert,
    upsertCommand, setCommands, applyLive, setLive, setCachedAt, reset,
  };

  /** Vide l'état (déconnexion d'un opérateur : rien ne doit rester affiché pour le suivant). */
  function reset() {
    state.stations = new Map();
    state.alerts = [];
    state.commands = new Map();
    state.points = new Map();
    state.feed = [];
    state.cachedAt = null;
    state.lastUpdate = null;
  }
}

/**
 * Rend lisible un événement de passerelle Node-RED (station_mute, station_back, gateway_alive).
 * @param {string} event JSON transmis en texte par le serveur
 * @returns {string} description en français
 */
function describeGatewayEvent(event) {
  try {
    const e = JSON.parse(event);
    if (e.type === 'station_mute') return `station ${e.station} muette depuis ${e.silentSec} s`;
    if (e.type === 'station_back') return `station ${e.station} de nouveau active`;
    if (e.type === 'gateway_alive') return 'en service';
    return e.type ?? event;
  } catch {
    return String(event);
  }
}

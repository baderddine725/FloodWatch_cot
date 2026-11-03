/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : shared/js/realtime.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { CONFIG, demo, demoBackend, wsUrl } from './config.js';

/**
 * Flux temps réel WSS /ws/live (backend : LiveEndpoint + WebSocketManager).
 * Messages {type, data} :
 *  - snapshot (liste de StationDto, à l'ouverture), station, stationDeleted {code},
 *    measurement {stationCode, measurement}, ping {ts} (toutes les 30 s) ;
 *  - avec ?token= opérateur/admin uniquement : alert (AlertDto), command (CommandDto), gateway.
 * Reconnexion automatique avec délai croissant (1 s → 30 s) et détection des connexions mortes.
 */

/**
 * @typedef {'connecting'|'open'|'reconnecting'|'closed'} LiveState
 */

/**
 * Ouvre le flux temps réel.
 * @param {object} options
 * @param {(message: {type: string, data: *}) => void} options.onMessage reçoit chaque message décodé
 * @param {(state: LiveState) => void} [options.onState] reçoit les changements d'état de la connexion
 * @param {() => string|null} [options.token] fournit le jeton courant à chaque (re)connexion
 * @returns {{close: () => void, reconnect: () => void}} contrôle de la connexion
 */
export function connectLive({ onMessage, onState, token = () => null }) {
  if (demo.active) return connectDemo({ onMessage, onState, token });

  let ws = null;
  let closed = false;
  let delay = 1000;
  let retryTimer = null;
  let silenceTimer = null;
  let pingTimer = null;

  /** Réarme la détection de silence : sans message pendant wsSilenceMs, on force la reconnexion. */
  const armSilence = () => {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => ws?.close(), CONFIG.wsSilenceMs);
  };

  /** Ouvre (ou rouvre) la socket. */
  const open = () => {
    clearTimeout(retryTimer);
    if (closed) return;
    onState?.(ws ? 'reconnecting' : 'connecting');
    const socket = new WebSocket(wsUrl(token()));
    ws = socket;
    socket.onopen = () => {
      delay = 1000;
      onState?.('open');
      armSilence();
      clearInterval(pingTimer);
      pingTimer = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send('ping'), 25_000);
    };
    socket.onmessage = (event) => {
      armSilence();
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return; // message illisible ignoré
      }
      if (message.type === 'pong') return;
      onMessage(message);
      if (CONFIG.perf) logLatency(message);
    };
    socket.onclose = () => {
      clearInterval(pingTimer);
      clearTimeout(silenceTimer);
      if (socket !== ws) return; // ancienne socket remplacée par reconnect()
      if (closed) {
        onState?.('closed');
        return;
      }
      onState?.('reconnecting');
      // délai croissant avec un peu d'aléa pour éviter que tous les clients se reconnectent ensemble
      retryTimer = setTimeout(open, delay + Math.random() * 500);
      delay = Math.min(delay * 2, CONFIG.wsMaxDelayMs);
    };
    socket.onerror = () => socket.close();
  };

  /** Reconnexion immédiate (retour du réseau, nouveau jeton). */
  const reconnect = () => {
    delay = 1000;
    const old = ws;
    ws = null;
    old?.close();
    open();
  };

  const onOnline = () => reconnect();
  window.addEventListener('online', onOnline);
  open();

  return {
    close() {
      closed = true;
      window.removeEventListener('online', onOnline);
      clearTimeout(retryTimer);
      clearTimeout(silenceTimer);
      clearInterval(pingTimer);
      ws?.close();
    },
    reconnect,
  };
}

/**
 * Variante du flux pour le mode démonstration (backend simulé dans le navigateur).
 * @param {object} options mêmes options que connectLive
 * @returns {{close: () => void, reconnect: () => void}} contrôle de la connexion
 */
function connectDemo({ onMessage, onState, token }) {
  let unsubscribe = null;
  let closed = false;
  onState?.('connecting');
  demoBackend().then((backend) => {
    if (closed) return;
    unsubscribe = backend.subscribe(onMessage, (on) => onState?.(on ? 'open' : 'reconnecting'), token());
  });
  return {
    close() {
      closed = true;
      unsubscribe?.();
      onState?.('closed');
    },
    reconnect() {},
  };
}

/** Latences mesurées (ms) depuis l'ouverture de la page (?perf=1). */
const latencies = [];

/**
 * Mesure de performance (?perf=1) : délai entre l'horodatage d'ingestion d'une mesure par le
 * serveur (MeasurementDto.ts, posé à la réception MQTT) et son AFFICHAGE (image suivante, une fois
 * le DOM mis à jour par les vues). Objectif du cahier des charges : moins de 3 s mesure → affichage.
 * Le trajet station → serveur (MQTT) s'ajoute : il se lit dans les journaux du simulateur (-v) et
 * de l'API. Une synthèse (médiane, 95e centile, maximum) est affichée toutes les 20 mesures.
 * Les horloges du serveur et du navigateur doivent être synchronisées (NTP) pour un écart fiable.
 * @param {{type: string, data: *}} message message reçu (déjà appliqué aux vues)
 */
function logLatency(message) {
  if (message.type !== 'measurement') return;
  const ts = Date.parse(message.data?.measurement?.ts);
  if (Number.isNaN(ts)) return;
  const received = Date.now() - ts;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const displayed = Date.now() - ts;
    latencies.push(displayed);
    console.info(`[perf] ${message.data.stationCode} : ingestion → réception ${received} ms, → affichage ${displayed} ms`);
    if (latencies.length % 20 === 0) {
      const sorted = [...latencies].sort((a, b) => a - b);
      const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
      console.info(`[perf] synthèse sur ${sorted.length} mesures : médiane ${pick(0.5)} ms, 95e centile ${pick(0.95)} ms, max ${sorted[sorted.length - 1]} ms (objectif < 3000 ms)`);
    }
  }));
}

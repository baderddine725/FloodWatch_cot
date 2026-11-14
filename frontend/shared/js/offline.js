/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : front-end
 *  Fichier   : shared/js/offline.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Kamoun Ahmed
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 */
import { prefs } from './prefs.js';

/**
 * Mémorisation des dernières données reçues (IndexedDB) pour le mode hors connexion.
 * Le Service Worker ne met jamais /api/ ni /ws/ en cache : ce sont les applications qui
 * enregistrent ici l'état des stations, les alertes et les derniers points de mesure.
 * Repli sur localStorage si IndexedDB est indisponible (navigation privée de certains navigateurs).
 */

const DB_NAME = 'floodwatch';
const STORE = 'snapshots';
let dbPromise = null;

/**
 * Ouvre (et crée au besoin) la base IndexedDB.
 * @returns {Promise<IDBDatabase|null>} la base, ou null si IndexedDB est indisponible
 */
function openDb() {
  dbPromise ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/**
 * Exécute une requête dans une transaction.
 * @param {'readonly'|'readwrite'} mode mode de transaction
 * @param {(store: IDBObjectStore) => IDBRequest} action requête à exécuter
 * @returns {Promise<*>} le résultat de la requête
 */
async function run(mode, action) {
  const db = await openDb();
  if (!db) throw new Error('IndexedDB indisponible');
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Mémorise une donnée avec son horodatage.
 * @param {string} key clé (ex. 'stations', 'alerts', 'points:underpass-01')
 * @param {*} value donnée sérialisable (clonage structuré)
 * @returns {Promise<void>}
 */
export async function saveSnapshot(key, value) {
  const entry = { value, savedAt: new Date().toISOString() };
  try {
    await run('readwrite', (store) => store.put(entry, key));
  } catch {
    prefs.setJSON(`fw.snapshot.${key}`, entry);
  }
}

/**
 * Relit une donnée mémorisée.
 * @param {string} key clé
 * @returns {Promise<{value: *, savedAt: string}|null>} la donnée et sa date, ou null
 */
export async function loadSnapshot(key) {
  try {
    const entry = await run('readonly', (store) => store.get(key));
    if (entry) return entry;
  } catch {
    /* repli localStorage ci-dessous */
  }
  return prefs.getJSON(`fw.snapshot.${key}`);
}

/**
 * Efface les données mémorisées dont la clé commence par un préfixe (ex. 'pilotage:' à la
 * déconnexion d'un opérateur sur un poste partagé). Les deux PWA partagent la même origine,
 * donc la même base : le préfixe évite d'effacer les données de l'autre application.
 * @param {string} prefix préfixe des clés à effacer
 * @returns {Promise<void>}
 */
export async function clearSnapshots(prefix) {
  try {
    const keys = await run('readonly', (store) => store.getAllKeys());
    await Promise.all(keys.filter((k) => String(k).startsWith(prefix)).map((k) => run('readwrite', (store) => store.delete(k))));
  } catch {
    /* IndexedDB indisponible : rien à effacer côté base */
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(`fw.snapshot.${prefix}`)) localStorage.removeItem(key);
    }
  } catch {
    /* stockage local indisponible */
  }
}

/**
 * Crée un enregistreur différé : les mises à jour en rafale du temps réel ne déclenchent qu'une
 * écriture IndexedDB toutes les delayMs millisecondes au plus.
 * @param {string} key clé de stockage
 * @param {() => *} read lit la donnée à enregistrer au moment de l'écriture
 * @param {number} [delayMs=5000] délai minimal entre deux écritures
 * @returns {{schedule: () => void, flush: () => Promise<void>, cancel: () => void}} contrôle
 */
export function createSaver(key, read, delayMs = 5000) {
  let timer = null;
  return {
    schedule() {
      timer ??= setTimeout(() => {
        timer = null;
        saveSnapshot(key, read());
      }, delayMs);
    },
    async flush() {
      clearTimeout(timer);
      timer = null;
      await saveSnapshot(key, read());
    },
    cancel() {
      clearTimeout(timer);
      timer = null;
    },
  };
}

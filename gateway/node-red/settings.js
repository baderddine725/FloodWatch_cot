/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : passerelle – back-end & IoT
 *  Fichier   : gateway/node-red/settings.js
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 *  Réglages Node-RED de la passerelle FloodWatch. Au démarrage :
 *   1. configuration centralisée : lit et VALIDE toutes les variables d'environnement
 *      (comme main/config/env.config.mjs + zod dans le projet du cours) ; arrêt avec la
 *      liste complète des erreurs si elle est incohérente ;
 *   2. installe les flux du dépôt (gateway/node-red/flows.json) quand ils ont changé ;
 *   3. écrit les identifiants MQTT (flows_cred.json, droits 600) depuis l'environnement :
 *      aucun mot de passe dans le dépôt ;
 *   4. charge le registre des stations (gateway/stations.json : zone, type, GPS) ;
 *   5. protège l'éditeur par mot de passe (NODE_RED_ADMIN_PASSWORD).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GATEWAY_DIR = process.env.GATEWAY_DIR || '/gateway';
const USER_DIR = process.env.NODE_RED_USER_DIR || '/data';

/**
 * Charge bcryptjs (fourni avec Node-RED) quel que soit le mode d'installation.
 * @returns {object} module bcryptjs
 */
function loadBcrypt() {
    for (const p of ['bcryptjs', '/usr/src/node-red/node_modules/bcryptjs', '/usr/lib/node_modules/node-red/node_modules/bcryptjs']) {
        try { return require(p); } catch (e) { /* emplacement suivant */ }
    }
    throw new Error('bcryptjs introuvable (fourni avec Node-RED)');
}

/**
 * Lit le registre des stations de la passerelle.
 * @returns {{gatewayId: string, zone: string, stations: Array<object>}}
 */
function loadRegistry() {
    const file = process.env.STATIONS_FILE || path.join(GATEWAY_DIR, 'stations.json');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Configuration centralisée validée : renvoie les valeurs ou lève une erreur listant TOUS les problèmes.
 * @param {object} env variables d'environnement
 * @param {object} registry registre des stations
 * @returns {object} configuration
 */
function validateConfig(env, registry) {
    const errors = [];
    const str = (name, def) => (env[name] === undefined || env[name] === '' ? def : env[name]);
    const num = (name, def, min, max) => {
        const v = Number(str(name, def));
        if (!Number.isFinite(v) || v < min || v > max) errors.push(`${name} : ${env[name]} hors de [${min} ; ${max}]`);
        return v;
    };
    const cfg = {
        GATEWAY_ID: str('GATEWAY_ID', registry.gatewayId),
        GATEWAY_ZONE: str('GATEWAY_ZONE', registry.zone),
        LOCAL_MQTT_HOST: str('LOCAL_MQTT_HOST', '127.0.0.1'),
        LOCAL_MQTT_PORT: num('LOCAL_MQTT_PORT', 1883, 1, 65535),
        LOCAL_MQTT_USER: str('LOCAL_MQTT_USER', ''),
        LOCAL_MQTT_PASSWORD: str('LOCAL_MQTT_PASSWORD', ''),
        CLOUD_MQTT_HOST: str('CLOUD_MQTT_HOST', ''),
        CLOUD_MQTT_PORT: num('CLOUD_MQTT_PORT', 8883, 1, 65535),
        CLOUD_MQTT_USER: str('CLOUD_MQTT_USER', 'gateway'),
        CLOUD_MQTT_PASSWORD: str('CLOUD_MQTT_PASSWORD', ''),
        CLOUD_CA_FILE: str('CLOUD_CA_FILE', '/certs/ca.crt'),
        NODE_RED_ADMIN_PASSWORD: str('NODE_RED_ADMIN_PASSWORD', ''),
        MUTE_AFTER_SEC: num('MUTE_AFTER_SEC', 60, 5, 3600),
        SAFETY_PCT: num('SAFETY_PCT', 85, 50, 100),
        AVG_WINDOW: num('AVG_WINDOW', 5, 1, 20),
        SPIKE_CM: num('SPIKE_CM', 3, 0.5, 50),
        QUEUE_MAX: num('QUEUE_MAX', 5000, 10, 100000),
    };
    if (!/^[a-z0-9][a-z0-9-]*$/.test(cfg.GATEWAY_ID || '')) errors.push(`GATEWAY_ID : « ${cfg.GATEWAY_ID} » invalide`);
    if (!cfg.CLOUD_MQTT_HOST) errors.push('CLOUD_MQTT_HOST : obligatoire');
    if (!cfg.CLOUD_MQTT_PASSWORD) errors.push('CLOUD_MQTT_PASSWORD : obligatoire (compte « gateway » du broker Cloud)');
    if (!fs.existsSync(cfg.CLOUD_CA_FILE)) errors.push(`CLOUD_CA_FILE : ${cfg.CLOUD_CA_FILE} introuvable (deploy/certs/ca.crt)`);
    if (cfg.LOCAL_MQTT_USER && !cfg.LOCAL_MQTT_PASSWORD) errors.push('LOCAL_MQTT_PASSWORD : obligatoire avec LOCAL_MQTT_USER');
    if (cfg.NODE_RED_ADMIN_PASSWORD.length < 8) errors.push('NODE_RED_ADMIN_PASSWORD : 8 caractères minimum');
    if (!Array.isArray(registry.stations) || registry.stations.length === 0) errors.push('stations.json : aucune station');
    if (errors.length) {
        throw new Error('[FloodWatch] configuration invalide :\n  - ' + errors.join('\n  - '));
    }
    return cfg;
}

/**
 * Copie les flux du dépôt dans le répertoire utilisateur s'ils ont changé depuis la dernière copie
 * (les retouches faites dans l'éditeur sont conservées tant que le dépôt ne change pas).
 */
function installFlows() {
    const source = path.join(GATEWAY_DIR, 'node-red', 'flows.json');
    const fallback = path.join(GATEWAY_DIR, 'flows.json');
    const src = fs.existsSync(source) ? source : fallback;
    const target = path.join(USER_DIR, 'flows.json');
    const marker = path.join(USER_DIR, '.flows-source.sha256');
    const content = fs.readFileSync(src);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const previous = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '';
    if (hash !== previous || !fs.existsSync(target)) {
        fs.writeFileSync(`${target}.tmp`, content);
        fs.renameSync(`${target}.tmp`, target);
        fs.writeFileSync(marker, hash);
        console.log(JSON.stringify({ level: 'info', event: 'flows_installed', sha256: hash.substring(0, 12) }));
    }
}

/**
 * Écrit les identifiants des deux brokers (clé = id du nœud mqtt-broker dans flows.json).
 * @param {object} cfg configuration validée
 */
function writeCredentials(cfg) {
    const credentials = {
        fw_cloud_broker: { user: cfg.CLOUD_MQTT_USER, password: cfg.CLOUD_MQTT_PASSWORD },
    };
    if (cfg.LOCAL_MQTT_USER) {
        credentials.fw_local_broker = { user: cfg.LOCAL_MQTT_USER, password: cfg.LOCAL_MQTT_PASSWORD };
    }
    fs.writeFileSync(path.join(USER_DIR, 'flows_cred.json'), JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

const registry = loadRegistry();
const config = validateConfig(process.env, registry);
// Les nœuds lisent ces valeurs par env.get(...) ou ${NOM} : on publie les valeurs validées (défauts compris).
for (const [k, v] of Object.entries(config)) {
    if (!/PASSWORD/.test(k)) process.env[k] = String(v);
}
process.env.GATEWAY_BRIDGE_TOPIC = `floodwatch/gateways/${config.GATEWAY_ID}/bridge`;
installFlows();
writeCredentials(config);
console.log(JSON.stringify({
    level: 'info', event: 'gateway_config', gateway: config.GATEWAY_ID, zone: config.GATEWAY_ZONE,
    local: `${config.LOCAL_MQTT_HOST}:${config.LOCAL_MQTT_PORT}`, cloud: `${config.CLOUD_MQTT_HOST}:${config.CLOUD_MQTT_PORT}`,
    stations: registry.stations.map(s => s.code), muteAfterSec: config.MUTE_AFTER_SEC, safetyPct: config.SAFETY_PCT
}));

module.exports = {
    uiPort: Number(process.env.PORT || 1880),
    userDir: USER_DIR,
    flowFile: 'flows.json',
    flowFilePretty: true,
    credentialSecret: false, // identifiants régénérés depuis l'environnement à chaque démarrage

    adminAuth: {
        type: 'credentials',
        users: [{ username: 'admin', password: loadBcrypt().hashSync(config.NODE_RED_ADMIN_PASSWORD, 10), permissions: '*' }]
    },

    // « file » : contexte persistant sur disque (la file d'attente Cloud survit au redémarrage).
    contextStorage: {
        default: { module: 'memory' },
        file: { module: 'localfilesystem', config: { flushInterval: 5 } }
    },

    // Accessibles dans les fonctions par global.get(...)
    functionGlobalContext: {
        stations: Object.fromEntries(registry.stations.map(s => [s.code, s])),
        randomUUID: () => crypto.randomUUID()
    },

    logging: { console: { level: 'info', metrics: false, audit: false } },
    diagnostics: { enabled: false, ui: false },
    runtimeState: { enabled: false, ui: false },
    telemetry: { enabled: false, updateNotification: false },
    editorTheme: {
        page: { title: 'FloodWatch — passerelle' },
        header: { title: 'FloodWatch — passerelle Node-RED' },
        projects: { enabled: false },
        tours: false
    }
};

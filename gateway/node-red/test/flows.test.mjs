/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : passerelle – tests
 *  Fichier   : gateway/node-red/test/flows.test.mjs
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-03          Modifié le : 2026-11-03
 *  Version   : 1.0
 * ============================================================================
 *  Tests unitaires des fonctions du flux Node-RED, sans Node-RED ni broker :
 *  le code de chaque nœud « function » de flows.json est exécuté avec des contextes simulés
 *  (flow, global, env, node). Lancement : node --test gateway/node-red/test/flows.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const flows = JSON.parse(readFileSync(new URL('../flows.json', import.meta.url), 'utf8'));
const byId = Object.fromEntries(flows.map(n => [n.id, n]));

/** Contexte simulé partagé par les fonctions d'un même flux (flow), plus env et global. */
function harness(envOverrides = {}) {
    const store = { memory: new Map(), file: new Map() };
    const flow = {
        get: (k, s = 'memory') => store[s].get(k),
        set: (k, v, s = 'memory') => store[s].set(k, v),
    };
    const env = { GATEWAY_ID: 'gw-test', GATEWAY_ZONE: 'ariana', SPIKE_CM: '3', AVG_WINDOW: '5', SAFETY_PCT: '85',
                  MUTE_AFTER_SEC: '60', QUEUE_MAX: '5', ...envOverrides };
    const globals = {
        stations: { 'underpass-01': { code: 'underpass-01', zone: 'ariana', lat: 36.8625, lon: 10.1956, criticalCm: 20, sensorHeightCm: 30 } },
        randomUUID,
    };
    /** Exécute la fonction du nœud `id` avec `msg` ; renvoie { result, sent, logs }. */
    function run(id, msg) {
        const sent = [];
        const logs = [];
        const nodeCtx = new Map();
        const node = { warn: m => logs.push(m), log: m => logs.push(m), status: () => {}, send: m => sent.push(m) };
        const context = { get: k => nodeCtx.get(k), set: (k, v) => nodeCtx.set(k, v) };
        const fn = new Function('msg', 'node', 'flow', 'global', 'env', 'context', byId[id].func);
        const result = fn(structuredClone(msg), node, flow, { get: k => globals[k] }, { get: k => env[k] }, context);
        return { result, sent, logs };
    }
    return { run, flow };
}

const raw = (level, extra = {}) => ({ topic: 'fw/raw/underpass-01/telemetry', payload: JSON.stringify({ levelCm: level, rain: 0.4, sensorOk: true, seq: 1, ...extra }) });

test('télémétrie : moyenne glissante, horodatage, GPS et zone', () => {
    const h = harness();
    let out;
    for (const v of [10, 11, 12, 13, 14, 15]) out = h.run('fw_fn_validate', raw(v)).result;
    const [cloud, safety] = out;
    assert.equal(cloud.topic, 'floodwatch/stations/underpass-01/telemetry');
    const p = JSON.parse(cloud.payload);
    assert.equal(p.levelCm, 13);          // moyenne des 5 dernières (11..15)
    assert.equal(p.rawLevelCm, 15);
    assert.deepEqual(p.gps, { lat: 36.8625, lon: 10.1956 });
    assert.equal(p.zone, 'ariana');
    assert.equal(p.gw, 'gw-test');
    assert.ok(Math.abs(p.ts - Date.now()) < 1000);
    assert.equal(safety.levelCm, 13);
});

test('aberrations : écho isolé rejeté, changement confirmé accepté', () => {
    const h = harness();
    for (const v of [10, 10.1, 9.9]) h.run('fw_fn_validate', raw(v));
    assert.equal(h.run('fw_fn_validate', raw(16)).result, null);       // écho parasite isolé
    assert.notEqual(h.run('fw_fn_validate', raw(10)).result, null);    // retour à la normale
    assert.equal(h.run('fw_fn_validate', raw(18)).result, null);       // saut : en attente de confirmation
    const confirmed = h.run('fw_fn_validate', raw(18.4)).result;       // 2e valeur proche : vrai changement
    assert.ok(JSON.parse(confirmed[0].payload).levelCm > 12);
});

test('capteur en défaut : transmis avec sensorOk=false, pas de règle locale', () => {
    const h = harness();
    const [cloud, safety] = h.run('fw_fn_validate', raw(999, { sensorOk: false })).result;
    assert.equal(JSON.parse(cloud.payload).sensorOk, false);
    assert.equal(safety, null);
    assert.equal(h.run('fw_fn_validate', { topic: 'fw/raw/underpass-01/telemetry', payload: '{pas du json' }).result, null);
});

test('règle de sécurité locale : > 85 % -> CLOSE + RED une seule fois, réarmée sous orange', () => {
    const h = harness();
    assert.equal(h.run('fw_fn_safety', { code: 'underpass-01', levelCm: 17.0 }).result, null); // 85 % pile : non
    const [cmds, event] = h.run('fw_fn_safety', { code: 'underpass-01', levelCm: 17.2 }).result; // 86 %
    assert.deepEqual(cmds.map(c => JSON.parse(c.payload)).map(c => [c.actuator, c.value]), [['barrier', 'CLOSE'], ['light', 'RED']]);
    assert.equal(cmds[0].topic, 'floodwatch/stations/underpass-01/cmd');
    assert.match(JSON.parse(cmds[0].payload).id, /^[0-9a-f-]{36}$/);   // UUID : ignoré proprement par le middleware
    assert.equal(JSON.parse(event.payload).type, 'local_safety');
    assert.equal(event.topic, 'floodwatch/gateways/gw-test/events');
    assert.equal(h.run('fw_fn_safety', { code: 'underpass-01', levelCm: 18 }).result, null);    // verrou
    h.run('fw_fn_safety', { code: 'underpass-01', levelCm: 10 });                              // 50 % < orange
    assert.notEqual(h.run('fw_fn_safety', { code: 'underpass-01', levelCm: 17.5 }).result, null);
});

test('règle de sécurité locale : seuils de la configuration retenue', () => {
    const h = harness();
    h.flow.set('configs', { 'underpass-01': { criticalCm: 40, orangePct: 60 } });
    assert.equal(h.run('fw_fn_safety', { code: 'underpass-01', levelCm: 30 }).result, null);    // 75 % de 40 cm
    assert.notEqual(h.run('fw_fn_safety', { code: 'underpass-01', levelCm: 35 }).result, null); // 87,5 %
});

test('file d\'attente : Cloud coupé -> mise en file, retenus dédoublonnés, renvoi dans l\'ordre', () => {
    const h = harness();
    const m = (topic, payload, retain = false) => ({ topic, payload, qos: 1, retain });
    h.run('fw_fn_queue', { status: { fill: 'red', text: 'disconnected' } });
    assert.equal(h.run('fw_fn_queue', m('floodwatch/stations/a/telemetry', '1')).result, null);
    h.run('fw_fn_queue', m('floodwatch/stations/a/state', 'old', true));
    h.run('fw_fn_queue', m('floodwatch/stations/a/telemetry', '2'));
    h.run('fw_fn_queue', m('floodwatch/stations/a/state', 'new', true));
    assert.equal(h.flow.get('cloudQueue', 'file').length, 3);
    const { sent } = h.run('fw_fn_queue', { status: { fill: 'green', text: 'connected' } });
    assert.deepEqual(sent.map(s => s.payload), ['1', '2', 'new']);
    assert.equal(sent[2].retain, true);
    assert.equal(h.flow.get('cloudQueue', 'file').length, 0);
    const pass = h.run('fw_fn_queue', m('floodwatch/stations/a/telemetry', '3')).result;   // Cloud joignable
    assert.equal(pass.payload, '3');
});

test('file d\'attente : au-delà de QUEUE_MAX, les plus anciens sont abandonnés', () => {
    const h = harness({ QUEUE_MAX: '3' });
    for (let i = 1; i <= 5; i++) h.run('fw_fn_queue', { topic: 't', payload: String(i), qos: 1 });
    assert.deepEqual(h.flow.get('cloudQueue', 'file').map(q => q.payload), ['3', '4', '5']);
});

test('chien de garde : station muette > 60 s puis retour', () => {
    const h = harness();
    h.flow.set('lastSeen', { 'underpass-01': Date.now() - 61_000, 'wadi-01': Date.now() - 5_000 });
    const [out] = h.run('fw_fn_mute', {}).result;
    assert.equal(out.length, 1);
    assert.deepEqual(JSON.parse(out[0].payload).station, 'underpass-01');
    assert.equal(JSON.parse(out[0].payload).type, 'station_mute');
    assert.equal(h.run('fw_fn_mute', {}).result[0].length, 0);       // une seule alerte
    h.run('fw_fn_seen', { topic: 'floodwatch/stations/underpass-01/heartbeat', payload: '{}' });
    assert.equal(JSON.parse(h.run('fw_fn_mute', {}).result[0][0].payload).type, 'station_back');
});

test('dernier contact : le LWT « offline » ne compte pas comme un signe de vie', () => {
    const h = harness();
    h.run('fw_fn_seen', { topic: 'floodwatch/stations/wadi-01/status', payload: 'offline' });
    assert.equal(h.flow.get('lastSeen'), undefined);
});

test('relais : retenu conservé à la montée, configuration retenue à la descente', () => {
    const h = harness();
    const up = h.run('fw_fn_relay_up', { topic: 'floodwatch/stations/a/td', payload: '{}', retain: true }).result;
    assert.equal(up.retain, true);
    const down = h.run('fw_fn_down', { topic: 'floodwatch/stations/a/config', payload: '{}', retain: false }).result;
    assert.equal(down.retain, true);
    assert.equal(h.run('fw_fn_down', { topic: 'floodwatch/stations/a/cmd', payload: '{}' }).result.retain, false);
});

test('santé : UP, DEGRADED (Cloud coupé), DOWN (broker local coupé)', () => {
    const h = harness();
    h.flow.set('localUp', true); h.flow.set('cloudUp', true);
    assert.equal(h.run('fw_fn_health', {}).result.payload.status, 'UP');
    h.flow.set('cloudUp', false);
    const degraded = h.run('fw_fn_health', {}).result;
    assert.equal(degraded.payload.status, 'DEGRADED');
    assert.equal(degraded.statusCode, 200);
    h.flow.set('localUp', false);
    assert.equal(h.run('fw_fn_health', {}).result.statusCode, 503);
});

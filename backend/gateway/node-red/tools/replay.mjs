// =============================================================================
//  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
//  Couche    : passerelle – banc d'essai du fog
//  Fichier   : backend/gateway/node-red/tools/replay.mjs
//  Équipe    : FloodWatch – Auteur : Guesmi Baderddine
//  Créé le   : 2026-11-17          Modifié le : 2026-11-17          Version : 1.0
// =============================================================================
// Rejoue de la télémétrie brute dans les VRAIES fonctions du flux Node-RED (flows.json), avec une
// horloge simulée : filtrage -> propagation amont/aval, et calibration toutes les 5 min. C'est le
// code déployé sur la passerelle qui est évalué, pas une réécriture.
//
// Entrée (stdin, une ligne JSON par message) : {"t": <ms>, "code": "...", "payload": {...télémétrie brute}}
// Sortie (stdout, une ligne JSON par événement) : {"t": <ms>, "kind": "event"|"cmd", "topic": "...", "payload": {...}}
// Usage : node tools/replay.mjs [stations.json] < lectures.jsonl
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const here = new URL('..', import.meta.url);
const flows = JSON.parse(readFileSync(new URL('flows.json', here), 'utf8'));
const byId = Object.fromEntries(flows.map(n => [n.id, n]));
const registry = JSON.parse(readFileSync(process.argv[2] || new URL('../stations.json', here), 'utf8'));

let clock = 0;
const RealDate = Date;
globalThis.Date = class extends RealDate {
    static now() { return clock; }
};
const store = new Map();
const flow = { get: k => store.get(k), set: (k, v) => store.set(k, v) };
const globals = { stations: Object.fromEntries(registry.stations.map(s => [s.code, s])), randomUUID };
const envVars = { GATEWAY_ID: registry.gatewayId || 'gw-bench', GATEWAY_ZONE: registry.zone || 'bench', SPIKE_CM: '3',
                  AVG_WINDOW: '5', ...Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PROP_|CALIB_)/.test(k))) };
const fns = {};
for (const id of ['fw_fn_validate', 'fw_fn_propagate', 'fw_fn_calibrate']) {
    fns[id] = new Function('msg', 'node', 'flow', 'global', 'env', 'context', byId[id].func);
}
const node = { warn() {}, log() {}, status() {}, send() {}, error() {} };
const ctx = new Map();
const context = { get: k => ctx.get(k), set: (k, v) => ctx.set(k, v) };
const run = (id, msg) => fns[id](msg, node, flow, { get: k => globals[k] }, { get: k => envVars[k] }, context);

const emit = (kind, list) => {
    for (const m of [].concat(list || []).filter(Boolean)) {
        process.stdout.write(JSON.stringify({ t: clock, kind, topic: m.topic, payload: JSON.parse(m.payload) }) + '\n');
    }
};
const CALIB_MS = 300000;
let nextCalib = null;
const rl = createInterface({ input: process.stdin });
for await (const line of rl) {
    if (!line.trim()) continue;
    const { t, code, payload } = JSON.parse(line);
    clock = t;
    if (nextCalib === null) nextCalib = t + CALIB_MS;
    while (clock >= nextCalib) {
        const saved = clock;
        clock = nextCalib;
        emit('event', run('fw_fn_calibrate', { payload: clock })?.[0]);
        clock = saved;
        nextCalib += CALIB_MS;
    }
    const out = run('fw_fn_validate', { topic: `fw/raw/${code}/telemetry`, payload: JSON.stringify(payload) });
    if (out && out[1]) {
        const [events, cmds] = run('fw_fn_propagate', out[1]) || [];
        emit('event', events);
        emit('cmd', cmds);
    }
}

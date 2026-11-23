// =============================================================================
//  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
//  Couche    : passerelle – tests du fog
//  Fichier   : backend/gateway/node-red/test/fog.test.mjs
//  Équipe    : FloodWatch – Auteur : Guesmi Baderddine
//  Créé le   : 2026-11-17          Modifié le : 2026-11-23          Version : 1.1
// =============================================================================
// Propagation amont -> aval (règle, puis modèle calibré) et calibration de la réponse des sites,
// exécutées dans les fonctions réelles de flows.json avec une horloge simulée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const flows = JSON.parse(readFileSync(new URL('../flows.json', import.meta.url), 'utf8'));
const byId = Object.fromEntries(flows.map(n => [n.id, n]));
const REGISTRY = {
    'upstream-01': { code: 'upstream-01', lat: 36.905, lon: 10.15, criticalCm: 20, downstream: [{ code: 'wadi-01', travelSec: 480, gain: 0.25 }] },
    'wadi-01': { code: 'wadi-01', lat: 36.8712, lon: 10.1834, criticalCm: 20, downstream: [] },
};

function fog(env = {}) {
    let clock = 1_000_000;
    const store = new Map();
    const flow = { get: k => store.get(k), set: (k, v) => store.set(k, v) };
    const vars = { GATEWAY_ID: 'gw-test', ...env };
    const RealDate = Date;
    const run = (id, msg) => {
        const saved = globalThis.Date;
        globalThis.Date = class extends RealDate { static now() { return clock; } };
        try {
            const fn = new Function('msg', 'node', 'flow', 'global', 'env', 'context', byId[id].func);
            const node = { warn() {}, log() {}, status() {} };
            return fn(msg, node, flow, { get: k => ({ stations: REGISTRY, randomUUID })[k] }, { get: k => vars[k] }, { get() {}, set() {} });
        } finally {
            globalThis.Date = saved;
        }
    };
    const measure = (code, levelCm, rain = 0.5, raw = levelCm) => run('fw_fn_propagate', { code, levelCm, rawLevelCm: raw, rain, ts: clock });
    return { run, measure, flow, tick: ms => { clock += ms; }, now: () => clock };
}

const payloads = list => (list || []).map(m => ({ topic: m.topic, ...JSON.parse(m.payload) }));

test('propagation (règle) : amont haut et en montée -> pré-alerte + surveillance renforcée de l\'aval, une fois', () => {
    const h = fog({ PROP_MODE: 'rule' });
    const all = [];
    let out;
    for (let i = 0; i < 30; i++) {                       // montée de 3 cm/min, franchit 50 % (10 cm)
        out = h.measure('upstream-01', 6 + 0.25 * i);
        if (out && out[0]) all.push(...payloads(out[0]), ...payloads(out[1]));
        h.tick(5000);
    }
    const alerts = all.filter(p => p.type === 'propagation_alert');
    assert.equal(alerts.length, 1, 'une seule pré-alerte par épisode');
    assert.equal(alerts[0].to, 'wadi-01');
    assert.equal(alerts[0].etaSec, 480);
    assert.equal(alerts[0].basis, 'rule');
    const cmd = all.find(p => p.actuator === 'sampling');
    assert.equal(cmd.topic, 'floodwatch/stations/wadi-01/cmd');
    assert.equal(cmd.value, 'WATCH');
    assert.deepEqual(out, [null, null], 'plus rien tant que l\'épisode dure');
});

test('propagation : décrue sous 80 % du seuil -> fin d\'épisode et retour de l\'aval en NORMAL', () => {
    const g = fog({ PROP_MODE: 'rule' });
    for (let i = 0; i < 30; i++) { g.measure('upstream-01', 6 + 0.25 * i); g.tick(5000); }
    let end = null;
    for (let i = 0; i < 40 && !end; i++) {
        const r = g.measure('upstream-01', 13 - 0.3 * i);
        const evs = payloads(r && r[0]);
        if (evs.some(e => e.type === 'propagation_end')) end = { evs, cmds: payloads(r[1]) };
        g.tick(5000);
    }
    assert.ok(end, 'propagation_end émis');
    assert.equal(end.cmds[0].value, 'NORMAL');
});

test('propagation (modèle) : réponse aval trop faible pour atteindre l\'orange -> pas de pré-alerte', () => {
    const g = fog({ PROP_MODE: 'model' });
    g.flow.set('calibration', { 'wadi-01': { a: 0.5, b: 0.4, g: 0.05, r2: 0.8, upstream: [{ code: 'upstream-01', travelSec: 480 }] } });
    g.measure('wadi-01', 2, 0.5);
    const events = [];
    for (let i = 0; i < 30; i++) { const r = g.measure('upstream-01', 6 + 0.25 * i); events.push(...payloads(r && r[0])); g.tick(5000); }
    assert.equal(events.filter(e => e.type === 'propagation_alert').length, 0);
});

test('propagation (modèle) : réponse aval forte -> pré-alerte avec le pic projeté', () => {
    const g = fog({ PROP_MODE: 'model' });
    g.flow.set('calibration', { 'wadi-01': { a: 6, b: 0.25, g: 0.25, r2: 0.8, upstream: [{ code: 'upstream-01', travelSec: 480 }] } });
    g.measure('wadi-01', 4, 0.5);
    const events = [];
    for (let i = 0; i < 30; i++) { const r = g.measure('upstream-01', 6 + 0.25 * i); events.push(...payloads(r && r[0])); g.tick(5000); }
    const a = events.filter(e => e.type === 'propagation_alert');
    assert.equal(a.length, 1);
    assert.equal(a[0].basis, 'model');
    assert.ok(a[0].projectedPct >= 60);
});

// Amont et aval calibrés ; l'amont monte sous une pluie de 0,9, l'aval est bas et au sec.
function upstreamStorm(env, outlook) {
    const g = fog({ PROP_MODE: 'model', ...env });
    g.flow.set('calibration', {
        'upstream-01': { a: 8, b: 0.3, g: null, r2: 0.9, upstream: [] },
        'wadi-01': { a: 6, b: 0.25, g: 0.25, r2: 0.9, upstream: [{ code: 'upstream-01', travelSec: 480 }] },
    });
    for (let i = 0; i < 60; i++) { g.measure('wadi-01', 2, 0); g.tick(5000); }
    if (outlook) g.flow.set('rainOutlook', outlook(g.now()));
    const alerts = [];
    for (let i = 0; i < 30; i++) {
        const r = g.measure('upstream-01', 6 + 0.25 * i, 0.9);
        alerts.push(...payloads(r && r[0]).filter(e => e.type === 'propagation_alert'));
        g.measure('wadi-01', 2, 0);
        g.tick(5000);
    }
    return alerts;
}
const dryFrom = (start, hours = 0.75) => ({
    'upstream-01': { start, stepSec: 900, values: new Array(Math.ceil(hours * 4)).fill(0) },
    'wadi-01': { start, stepSec: 900, values: new Array(Math.ceil(hours * 4)).fill(0) },
});

test("propagation (cascade) : l'amont est projeté par son propre modèle -> pic aval plus haut que « amont constant »", () => {
    const constant = upstreamStorm({ PROP_CASCADE: '0' });
    const cascade = upstreamStorm({ PROP_CASCADE: '1' });
    assert.equal(constant.length, 1);
    assert.equal(cascade.length, 1);
    assert.ok(cascade[0].projectedPct > constant[0].projectedPct + 20,
        `amont encore sous la pluie : il monte, l'aval aussi (${cascade[0].projectedPct} vs ${constant[0].projectedPct})`);
});

test('propagation (prévision de pluie) : orage annoncé fini -> plus de pré-alerte (défaut), pic plus bas avec raccord', () => {
    const persistence = upstreamStorm({ PROP_CASCADE: '1' });
    const blended = upstreamStorm({ PROP_CASCADE: '1', PROP_RAIN_BLEND_S: '900' }, dryFrom);
    const forecastOnly = upstreamStorm({}, dryFrom);
    assert.equal(blended.length, 1);
    assert.ok(blended[0].projectedPct < persistence[0].projectedPct - 20, 'raccord : la prévision pèse au-delà de 15 min');
    assert.equal(forecastOnly.length, 0, "prévision seule : l'amont redescend avant de noyer l'aval");
});

test('propagation (cascade auto) : sans prévision de pluie, exactement la propagation 1.0', () => {
    assert.deepEqual(upstreamStorm({}).map(a => a.projectedPct), upstreamStorm({ PROP_CASCADE: '0' }).map(a => a.projectedPct));
});

test('propagation (prévision de pluie) : une prévision périmée est ignorée (persistance)', () => {
    const persistence = upstreamStorm({ PROP_CASCADE: '1' });
    const stale = upstreamStorm({ PROP_CASCADE: '1', PROP_RAIN_BLEND_S: '0' }, now => dryFrom(now - 2 * 3600 * 1000, 1));
    assert.deepEqual(stale.map(a => a.projectedPct), persistence.map(a => a.projectedPct));
});

test('calibration : retrouve a, b et g d\'un site simulé sans bruit', () => {
    const g = fog({ CALIB_MIN_SAMPLES: '30' });
    const A = 6, B = 0.25, G = 0.25;
    let up = 0, down = 0;
    const upHist = [];
    for (let k = 0; k < 2400; k++) {                     // 3 h 20 à 5 s, pluie variable
        const t = k * 5;
        const rainUp = 0.5 + 0.5 * Math.sin(t / 700), rainDown = 0.5 + 0.5 * Math.sin(t / 450 + 1);
        upHist.push(up);
        const lagged = upHist[Math.max(0, upHist.length - 1 - 96)];      // 480 s = 96 pas
        up += (8 * rainUp - 0.3 * up) * 5 / 60;
        down += (A * rainDown - B * down + G * lagged) * 5 / 60;
        g.measure('upstream-01', up, rainUp);
        g.measure('wadi-01', down, rainDown);
        if (k % 60 === 59) g.run('fw_fn_calibrate', { payload: g.now() });   // toutes les 5 min
        g.tick(5000);
    }
    const res = g.flow.get('calibration')['wadi-01'];
    assert.ok(Math.abs(res.a - A) / A < 0.05, `a ${res.a}`);
    assert.ok(Math.abs(res.b - B) / B < 0.05, `b ${res.b}`);
    assert.ok(Math.abs(res.g - G) / G < 0.08, `g ${res.g}`);
    assert.ok(res.r2 > 0.95);
    assert.deepEqual(res.upstream, [{ code: 'upstream-01', travelSec: 480 }]);
    const upRes = g.flow.get('calibration')['upstream-01'];
    assert.equal(upRes.g, null, 'pas d\'amont : modèle à deux paramètres');
});

test('météo : désactivée par défaut, puis une requête Open-Meteo par station (position arrondie)', () => {
    assert.equal(fog().run('fw_fn_weather_req', { payload: 0 }), null, 'WEATHER_PROVIDER absent : aucune requête');
    const [reqs] = fog({ WEATHER_PROVIDER: 'open-meteo' }).run('fw_fn_weather_req', { payload: 0 });
    assert.deepEqual(reqs.map(r => r.station), ['upstream-01', 'wadi-01']);
    assert.match(reqs[0].url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=36\.91&longitude=10\.15&minutely_15=precipitation/);
});

test('météo : la réponse Open-Meteo devient flow.rainOutlook, lu par la propagation', () => {
    const g = fog();
    const payload = { minutely_15: { time: ['2026-11-23T09:00', '2026-11-23T09:15', '2026-11-23T09:30'],
                                     precipitation: [2.5, 5.0, null] } };
    assert.equal(g.run('fw_fn_weather_parse', { station: 'wadi-01', statusCode: 200, payload }), null);
    const o = g.flow.get('rainOutlook')['wadi-01'];
    assert.equal(o.start, Date.parse('2026-11-23T08:45:00Z'), 'valeur de 09:00 = cumul de 08:45 à 09:00');
    assert.equal(o.stepSec, 900);
    assert.deepEqual(o.values, [0.5, 1, 0], '2,5 mm/15 min = 10 mm/h = 0,5 ; null = pas de pluie');
    g.run('fw_fn_weather_parse', { station: 'upstream-01', statusCode: 503, payload: 'indisponible' });
    assert.deepEqual(Object.keys(g.flow.get('rainOutlook')), ['wadi-01'], 'réponse en erreur ignorée');
});

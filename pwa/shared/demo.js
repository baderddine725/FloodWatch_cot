/* =============================================================================
   FloodWatch – backend de démonstration exécuté dans le navigateur.
   Reproduit le contrat de l'API REST et du flux /ws/live (mêmes formats JSON) avec
   deux stations simulées (orage cyclique), le moteur d'alerte simplifié et l'automatisme.
   Permet de présenter les PWA sans serveur (mode ?demo=1).
   Équipe FloodWatch – Auteur : Kamoun Ahmed – v1.0 – 2026-11-02
   ============================================================================= */
const RANK = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const iso = (t = Date.now()) => new Date(t).toISOString();
const err = (status, error) => Object.assign(new Error(error), { status });

function makeStation(code, name, type, lat, lon, address, phase) {
  return {
    id: uid(), code, name, type, latitude: lat, longitude: lon, address, description: 'Station simulée (mode démonstration)',
    thresholds: { criticalCm: 20, yellowPct: 30, orangePct: 60, redPct: 85, rainThreshold: 0.2, rapidRiseCmPerMin: 3,
      forecastRedMinutes: 10, reopenDelaySec: 60, sensorHeightCm: 30, periodNormalSec: 30, periodWatchSec: 5 },
    alertLevel: 'GREEN', alertReasons: '', levelCm: 2, levelPct: 10, rain: 0, slopeCmPerMin: 0, minutesToOverflow: null,
    riskIndex: 5, online: true, sensorFault: false, lastSeenAt: iso(), lastMeasurementAt: iso(), barrier: 'OPEN',
    light: 'GREEN', siren: false, sampling: 'NORMAL', controlMode: 'AUTO', localSafety: false, firmware: 'demo-1.0.0',
    rssi: -61, roadOpen: true, etag: 'demo', _phase: phase, _level: 2, _hist: [], _belowOrange: null,
  };
}

export class DemoBackend {
  constructor() {
    this.t0 = Date.now();
    this.stations = [
      makeStation('underpass-01', 'Passage souterrain Ariana', 'UNDERPASS', 36.8625, 10.1956, 'Trémie, avenue principale, Ariana', 0),
      makeStation('wadi-01', 'Gué de l’oued Ariana', 'WADI', 36.8792, 10.1637, 'Route du gué, Ariana', 150),
    ];
    this.alerts = [];
    this.commands = [];
    this.users = [
      { id: uid(), username: 'admin', fullName: 'Administrateur', roles: ['OPERATOR', 'ADMIN'], enabled: true, createdAt: iso() },
      { id: uid(), username: 'operator', fullName: 'Opérateur municipal', roles: ['OPERATOR'], enabled: true, createdAt: iso() },
    ];
    this.listeners = new Set();
    // historique initial de 20 min, calme
    for (const s of this.stations) {
      for (let k = 240; k > 0; k--) s._hist.push({ ts: iso(Date.now() - k * 5000), levelCm: 1.8 + Math.random() * 0.4, levelPct: 10, rain: 0, alertLevel: 'GREEN' });
    }
    setInterval(() => this.tick(), 2000);
  }

  // ------------------------------------------------------------------ simulation
  rainAt(s) {
    const t = ((Date.now() - this.t0) / 1000 + s._phase) % 360; // orage toutes les 6 min
    if (t < 20) return 0;
    if (t < 60) return 0.9 * (t - 20) / 40;
    if (t < 170) return 0.9;
    return 0;
  }

  tick() {
    const now = Date.now();
    for (const s of this.stations) {
      if (!s.online) continue;
      s.rain = Math.round(this.rainAt(s) * 100) / 100;
      s._level += (12 * s.rain - 0.45 * s._level) * (2 / 60);
      s._level = Math.max(0, Math.min(28, s._level));
      const level = Math.max(0, s._level + (Math.random() - 0.5) * 0.3);
      const t = s.thresholds;
      const pct = (100 * level) / t.criticalCm;
      s._hist.push({ ts: iso(now), levelCm: +level.toFixed(2), levelPct: +pct.toFixed(1), rain: s.rain, alertLevel: s.alertLevel });
      if (s._hist.length > 2000) s._hist.shift();
      // pente sur 2 min (moindres carrés)
      const recent = s._hist.filter((p) => now - new Date(p.ts).getTime() <= 120000);
      let slope = 0;
      if (recent.length >= 4) {
        const xs = recent.map((p) => (new Date(p.ts).getTime() - now) / 60000); const ys = recent.map((p) => p.levelCm);
        const n = xs.length; const sx = xs.reduce((a, b) => a + b, 0); const sy = ys.reduce((a, b) => a + b, 0);
        const sxx = xs.reduce((a, b) => a + b * b, 0); const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
        slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
      }
      const ttf = level >= t.criticalCm ? 0 : slope >= 0.05 ? (t.criticalCm - level) / slope : null;
      let lvl = 'GREEN'; const reasons = [];
      const raise = (l, r) => { if (RANK[l] > RANK[lvl]) lvl = l; reasons.push(r); };
      if (pct >= t.redPct) raise('RED', `niveau ${pct.toFixed(0)} % du seuil critique`);
      else if (pct >= t.orangePct) raise('ORANGE', `niveau ${pct.toFixed(0)} % du seuil critique`);
      else if (pct >= t.yellowPct) raise('YELLOW', `niveau ${pct.toFixed(0)} % du seuil critique`);
      if (s.rain >= t.rainThreshold) raise('YELLOW', `pluie détectée (${Math.round(s.rain * 100)} %)`);
      if (slope >= t.rapidRiseCmPerMin) raise('ORANGE', `montée rapide (${slope.toFixed(1)} cm/min)`);
      if (pct >= t.yellowPct && ttf != null && ttf <= t.forecastRedMinutes) raise('RED', `débordement prévu dans ${ttf.toFixed(1)} min`);
      if (pct < t.orangePct) s._belowOrange ??= now; else s._belowOrange = null;
      if (s.alertLevel === 'RED' && lvl !== 'RED') {
        const el = s._belowOrange ? (now - s._belowOrange) / 1000 : 0;
        if (pct >= t.orangePct || el < t.reopenDelaySec) { lvl = 'RED'; reasons.push(`maintien rouge : temporisation de réouverture (${Math.round(el)}/${t.reopenDelaySec} s)`); }
      }
      Object.assign(s, { levelCm: +level.toFixed(2), levelPct: +pct.toFixed(2), slopeCmPerMin: +slope.toFixed(2),
        minutesToOverflow: ttf == null ? null : +ttf.toFixed(2), lastSeenAt: iso(now), lastMeasurementAt: iso(now),
        riskIndex: Math.round(Math.min(100, 0.6 * Math.min(100, pct) + (slope > 0 ? 25 * Math.min(1, slope / t.rapidRiseCmPerMin) : 0) + 15 * s.rain + (ttf != null && ttf < 30 ? (20 * (30 - ttf)) / 30 : 0))),
        alertReasons: reasons.join(' ; '), sampling: RANK[lvl] >= 1 ? 'WATCH' : 'NORMAL' });
      if (lvl !== s.alertLevel) this.levelChanged(s, s.alertLevel, lvl);
      this.automate(s);
      s.roadOpen = s.barrier !== 'CLOSED' && s.alertLevel !== 'RED';
      this.emit('measurement', { stationCode: s.code, measurement: s._hist[s._hist.length - 1] });
      this.emit('station', this.dto(s));
    }
  }

  levelChanged(s, prev, lvl) {
    s.alertLevel = lvl;
    const active = this.alerts.find((a) => a.stationCode === s.code && a.type === 'LEVEL' && a.active);
    if (RANK[lvl] >= 2) {
      if (active?.level === lvl) return;
      if (active) this.closeAlert(active);
      this.raise(s, 'LEVEL', lvl, `Niveau ${lvl === 'RED' ? 'ROUGE' : 'ORANGE'} – ${s.name} : ${s.alertReasons}`);
    } else if (active) this.closeAlert(active);
  }

  raise(s, type, level, message) {
    const a = { id: uid(), stationId: s.id, stationCode: s.code, stationName: s.name, type, level, message, raisedAt: iso(),
      active: true, resolvedAt: null, acknowledgedAt: null, acknowledgedBy: null, barrierClosedAt: null, barrierReopenedAt: null };
    this.alerts.unshift(a);
    this.emit('alert', a, true);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && navigator.serviceWorker?.controller && RANK[level] >= 2) {
      navigator.serviceWorker.ready.then((r) => r.showNotification(`FloodWatch – Alerte ${level === 'RED' ? 'ROUGE' : 'ORANGE'} : ${s.name}`,
        { body: level === 'RED' ? 'Passage FERMÉ. Ne vous engagez pas.' : message, tag: `fw-${s.code}`, icon: 'icons/icon-192.png' })).catch(() => {});
    }
  }

  closeAlert(a) { a.active = false; a.resolvedAt = iso(); this.emit('alert', a, true); }

  automate(s) {
    if (s.controlMode !== 'AUTO') return;
    const targets = s.alertLevel === 'RED' ? { barrier: 'CLOSED', light: 'RED', siren: true }
      : { barrier: 'OPEN', light: s.alertLevel === 'ORANGE' ? 'ORANGE' : 'GREEN', siren: false };
    if (s.barrier !== targets.barrier) this.command(s, 'barrier', targets.barrier === 'CLOSED' ? 'CLOSE' : 'OPEN', 'system', 'AUTO');
    if (s.light !== targets.light) this.command(s, 'light', targets.light, 'system', 'AUTO');
    if (s.siren !== targets.siren) this.command(s, 'siren', targets.siren ? 'ON' : 'OFF', 'system', 'AUTO');
  }

  command(s, actuator, value, by, origin) {
    const c = { id: uid(), stationCode: s.code, actuator, value, origin, issuedBy: by, issuedAt: iso(), status: 'PENDING', ackedAt: null, detail: null };
    this.commands.unshift(c);
    if (actuator === 'barrier') s.barrier = value === 'CLOSE' ? 'CLOSED' : 'OPEN';
    if (actuator === 'light') s.light = value;
    if (actuator === 'siren') s.siren = value === 'ON';
    if (actuator === 'sampling') s.sampling = value;
    if (actuator === 'barrier' && value === 'CLOSE') {
      const a = this.alerts.find((x) => x.stationCode === s.code && x.active && x.type === 'LEVEL' && !x.barrierClosedAt);
      if (a) a.barrierClosedAt = iso(Date.now() + 300);
    }
    this.emit('command', c, true);
    setTimeout(() => { c.status = 'ACKED'; c.ackedAt = iso(); this.emit('command', c, true); }, 400);
    return c;
  }

  dto(s) {
    const o = {};
    for (const [k, v] of Object.entries(s)) if (!k.startsWith('_')) o[k] = v;
    return o;
  }

  emit(type, data, operatorOnly = false) {
    for (const l of this.listeners) if (!operatorOnly || l.operator) l.fn({ type, data });
  }

  subscribe(fn, onStatus, token) {
    const l = { fn, operator: !!token };
    this.listeners.add(l);
    setTimeout(() => { onStatus?.(true); fn({ type: 'snapshot', data: this.stations.map((s) => this.dto(s)) }); }, 50);
    return () => this.listeners.delete(l);
  }

  station(id) {
    const s = this.stations.find((x) => x.code === id || x.id === id);
    if (!s) throw err(404, `station not found: ${id}`);
    return s;
  }

  // ------------------------------------------------------------------ API REST simulée
  async request(path, { method = 'GET', body, token } = {}) {
    await new Promise((r) => setTimeout(r, 60));
    const [p, qs] = path.split('?');
    const q = new URLSearchParams(qs || '');
    const parts = p.split('/').filter(Boolean);
    const user = token ? this.users.find((u) => `demo-token-${u.username}` === token) : null;
    const need = (...roles) => { if (!user) throw err(401, 'authentication required'); if (!roles.some((r) => user.roles.includes(r))) throw err(403, 'insufficient role'); };
    const [root, id, sub] = parts;
    if (root === 'health') return { status: 'UP', database: true, mqtt: true, mqttBroker: 'demo', websocketClients: this.listeners.size, time: iso(), version: '1.0-demo' };
    if (root === 'auth' && id === 'login') {
      const u = this.users.find((x) => x.username === body?.username && x.enabled);
      const ok = u && ((u.username === 'admin' && body.password === 'admin123!') || (u.username === 'operator' && body.password === 'operator123!') || u._password === body.password);
      if (!ok) throw err(401, 'Identifiants invalides');
      return { token: `demo-token-${u.username}`, tokenType: 'Bearer', expiresIn: 28800, user: { ...u, _password: undefined } };
    }
    if (root === 'auth' && id === 'me') { need('OPERATOR', 'ADMIN', 'CITIZEN'); return user; }
    if (root === 'stations') {
      if (!id) {
        if (method === 'POST') { need('ADMIN'); const s = makeStation(body.code, body.name, body.type || 'OTHER', body.latitude ?? 36.86, body.longitude ?? 10.18, body.address || '', 90); this.stations.push(s); return this.dto(s); }
        return this.stations.map((s) => this.dto(s));
      }
      const s = this.station(id);
      if (!sub) {
        if (method === 'PUT') { need('ADMIN'); Object.assign(s, { name: body.name ?? s.name, description: body.description ?? s.description, address: body.address ?? s.address }); if (body.thresholds) Object.assign(s.thresholds, Object.fromEntries(Object.entries(body.thresholds).filter(([, v]) => v != null))); return this.dto(s); }
        if (method === 'DELETE') { need('ADMIN'); this.stations = this.stations.filter((x) => x !== s); return null; }
        return this.dto(s);
      }
      if (sub === 'measurements') { const min = Number(q.get('minutes') || 60); return s._hist.filter((m) => Date.now() - new Date(m.ts).getTime() <= min * 60000); }
      if (sub === 'prediction') return { station: s.code, alertLevel: s.alertLevel, levelCm: s.levelCm, levelPct: s.levelPct, slopeCmPerMin: s.slopeCmPerMin, minutesToOverflow: s.minutesToOverflow, riskIndex: s.riskIndex, reasons: s.alertReasons, computedAt: s.lastMeasurementAt };
      if (sub === 'td') return { '@context': 'https://www.w3.org/2022/wot/td/v1.1', id: `urn:floodwatch:station:${s.code}`, title: s.name, note: 'Thing Description complète servie par l’API réelle' };
      if (sub === 'commands') {
        need('OPERATOR', 'ADMIN');
        if (method === 'POST') {
          if (body.actuator !== 'sampling') s.controlMode = 'MANUAL';
          const c = this.command(s, body.actuator, String(body.value).toUpperCase(), user.username, 'MANUAL');
          this.emit('station', this.dto(s)); return c;
        }
        return this.commands.filter((c) => c.stationCode === s.code).slice(0, Number(q.get('limit') || 50));
      }
      if (sub === 'mode') { need('OPERATOR', 'ADMIN'); s.controlMode = body.mode; this.automate(s); this.emit('station', this.dto(s)); return this.dto(s); }
      if (sub === 'config') { need('ADMIN'); return { published: true }; }
    }
    if (root === 'alerts') {
      need('OPERATOR', 'ADMIN');
      if (sub === 'ack') { const a = this.alerts.find((x) => x.id === id); if (!a) throw err(404, 'alert not found'); a.acknowledgedAt = iso(); a.acknowledgedBy = user.username; this.emit('alert', a, true); return a; }
      let list = this.alerts;
      if (q.get('active') === 'true') list = list.filter((a) => a.active);
      return list.slice(0, Number(q.get('limit') || 100));
    }
    if (root === 'kpi') {
      need('OPERATOR', 'ADMIN');
      const by = (f) => this.alerts.reduce((m, a) => ((m[f(a)] = (m[f(a)] || 0) + 1), m), {});
      const closures = this.alerts.filter((a) => a.barrierClosedAt);
      return { from: iso(this.t0), to: iso(), stationsTotal: this.stations.length, stationsOnline: this.stations.filter((s) => s.online).length,
        alertsTotal: this.alerts.length, alertsByLevel: by((a) => a.level), alertsByType: by((a) => a.type), alertsActive: this.alerts.filter((a) => a.active).length,
        closureDelaySecAvg: closures.length ? 0.4 : null, closureDelaySecMax: closures.length ? 0.6 : null, closures: closures.length, closureDurationMinAvg: closures.length ? 3.2 : null,
        availabilityPct: Object.fromEntries(this.stations.map((s) => [s.code, 100])), availabilityPctAvg: 100,
        floodsByStation: Object.fromEntries(this.stations.map((s) => [s.code, this.alerts.filter((a) => a.stationCode === s.code && a.level === 'RED').length])),
        commandsTotal: this.commands.length, commandsAckedPct: this.commands.length ? 100 : null, measurements: this.stations.reduce((n, s) => n + s._hist.length, 0) };
    }
    if (root === 'users') {
      need('ADMIN');
      if (!id && method === 'POST') { if (this.users.some((u) => u.username === body.username)) throw err(409, 'username already exists'); const u = { id: uid(), username: body.username, fullName: body.fullName, roles: body.roles, enabled: true, createdAt: iso(), _password: body.password }; this.users.push(u); return u; }
      if (!id) return this.users.map((u) => ({ ...u, _password: undefined }));
      const u = this.users.find((x) => x.id === id); if (!u) throw err(404, 'user not found');
      if (method === 'DELETE') { this.users = this.users.filter((x) => x !== u); return null; }
      if (method === 'PUT') { Object.assign(u, Object.fromEntries(Object.entries({ fullName: body.fullName, roles: body.roles, enabled: body.enabled }).filter(([, v]) => v != null))); return u; }
    }
    if (root === 'push') {
      if (id === 'public-key') return { publicKey: 'BDemoKeyDemoKeyDemoKeyDemoKeyDemoKeyDemoKeyDemoKeyDemoKeyDemoKeyDemoKeyDemoKeyDemoKey' };
      if (id === 'test') { need('OPERATOR', 'ADMIN'); return { sent: 1 }; }
      return { id: uid(), audience: user ? 'OPERATOR' : 'CITIZEN', radiusKm: body?.radiusKm ?? 5 };
    }
    throw err(404, `not found: ${path}`);
  }
}

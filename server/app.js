const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { Store, id, token, code } = require('./store');

const ROOT = path.join(__dirname, '..');
const LIMITS = {
  name: 40,
  text: 1000,
  voiceBytes: 1_500_000, // base64 length; ~60 s of Opus
  membersPerGroup: 50,
  messagesKept: 500, // per group
  ridePoints: 20000,
};
const COLORS = ['#F98924', '#2FC9C3', '#E5484D', '#8B7CF6', '#F5C542', '#4CC38A', '#EC6AA8', '#5AA9FF'];

function createApp(opts = {}) {
  const cfg = {
    dataFile: opts.dataFile ?? process.env.DATA_FILE ?? path.join(ROOT, 'data', 'rylaide.json'),
    osrm: opts.osrm ?? process.env.OSRM_URL ?? 'https://router.project-osrm.org',
    nominatim: opts.nominatim ?? process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org',
    weather: opts.weather ?? process.env.WEATHER_URL ?? 'https://api.met.no/weatherapi/locationforecast/2.0/compact',
    userAgent: opts.userAgent ?? process.env.USER_AGENT ?? 'Rylaide/0.1 (https://github.com/Drakeion2532/rylaide_ui)',
    upstreamTimeout: opts.upstreamTimeout ?? 8000,
  };
  // Owner bike photos live next to the data file (on the persistent disk in production).
  cfg.photoDir = opts.photoDir ?? process.env.PHOTO_DIR ?? path.join(cfg.dataFile ? path.dirname(cfg.dataFile) : fs.mkdtempSync(path.join(os.tmpdir(), 'rylaide-photos-')), 'photos');
  const store = new Store(cfg.dataFile);
  const db = store.data;
  const app = express();
  app.disable('x-powered-by');
  // Hosts like Render/Railway terminate HTTPS at a proxy; trust it so QR invite links use https://.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '3mb' }));

  // ---------- helpers ----------
  const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
  const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
  const publicUser = (u) => u && { id: u.id, name: u.name, bike: u.bike, color: u.color, vehicle: u.vehicle || null };
  // Bike shown on Home and in Garage. All fields optional; odometer in km.
  const VEHICLE_TYPES = ['classic', 'roadster', 'cruiser', 'adventure', 'sport', 'commuter', 'scooter', 'ev-scooter', 'bicycle', 'e-bike'];
  function cleanVehicle(v, prev = {}) {
    if (v === null) return null;
    if (typeof v !== 'object') return undefined;
    const odo = num(v.odometer);
    if (v.odometer !== undefined && v.odometer !== '' && v.odometer !== null && !(odo >= 0 && odo < 10_000_000)) return undefined;
    const type = VEHICLE_TYPES.includes(v.type) ? v.type : prev?.type && v.type === undefined ? prev.type : null;
    return {
      type, make: clean(v.make, 30), model: clean(v.model, 40),
      odometer: Number.isFinite(odo) ? Math.round(odo) : null,
      photo: prev?.photo || null, // set only through the photo upload endpoint
    };
  }
  const userByToken = (t) => db.users.find((u) => u.token === t);
  const groupOf = (gid) => db.groups.find((g) => g.id === gid);
  const isMember = (g, uid) => g && g.members.includes(uid);
  const fail = (res, status, error) => res.status(status).json({ error });

  function auth(req, res, next) {
    const t = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const u = t && userByToken(t);
    if (!u) return fail(res, 401, 'Sign in again: your session was not recognised.');
    req.user = u;
    next();
  }
  function memberGroup(req, res, next) {
    const g = groupOf(req.params.id);
    if (!g) return fail(res, 404, 'That group no longer exists.');
    if (!isMember(g, req.user.id)) return fail(res, 403, 'Join this group first.');
    req.group = g;
    next();
  }
  function groupView(g) {
    return {
      id: g.id, code: g.code, name: g.name, ownerId: g.ownerId, plan: g.plan, createdAt: g.createdAt,
      members: g.members.map((m) => ({ ...publicUser(db.users.find((u) => u.id === m)), online: online(g.id, m) })),
    };
  }

  // ---------- accounts ----------
  app.get('/healthz', (req, res) => res.json({ ok: true, users: db.users.length, groups: db.groups.length }));

  app.post('/api/users', (req, res) => {
    const name = clean(req.body?.name, LIMITS.name);
    if (!name) return fail(res, 400, 'Enter your name so your group knows who you are.');
    const u = {
      id: id(), token: token(), name, bike: clean(req.body?.bike, 20) || 'motorcycle',
      color: COLORS[db.users.length % COLORS.length], createdAt: Date.now(),
      vehicle: req.body?.vehicle ? cleanVehicle(req.body.vehicle) || null : null,
    };
    db.users.push(u);
    store.save();
    res.status(201).json({ user: publicUser(u), token: u.token });
  });
  app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));
  app.patch('/api/me', auth, (req, res) => {
    if (req.body?.name !== undefined) {
      const name = clean(req.body.name, LIMITS.name);
      if (!name) return fail(res, 400, 'Name can’t be empty.');
      req.user.name = name;
    }
    if (req.body?.bike !== undefined) req.user.bike = clean(req.body.bike, 20) || 'motorcycle';
    if (req.body?.color !== undefined) {
      if (!/^#[0-9a-f]{6}$/i.test(req.body.color)) return fail(res, 400, 'Colour must be a hex value like #F98924.');
      req.user.color = req.body.color;
    }
    if (req.body?.vehicle !== undefined) {
      const v = cleanVehicle(req.body.vehicle, req.user.vehicle);
      if (v === undefined) return fail(res, 400, 'Check the bike details: odometer must be a number of km.');
      req.user.vehicle = v;
    }
    store.save();
    res.json({ user: publicUser(req.user) });
  });

  // Owner photo of the bike: JPEG, base64, resized on the phone to about 1400 px.
  app.post('/api/me/photo', auth, (req, res) => {
    const b64 = String(req.body?.data || '').replace(/^data:image\/jpeg;base64,/, '');
    let buf;
    try { buf = Buffer.from(b64, 'base64'); } catch { buf = null; }
    if (!buf || buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8) return fail(res, 400, 'Choose a photo (JPEG) of your bike.');
    if (buf.length > 2_000_000) return fail(res, 413, 'That photo is too large. Try a smaller one.');
    fs.mkdirSync(cfg.photoDir, { recursive: true });
    const pid = id();
    fs.writeFileSync(path.join(cfg.photoDir, `${pid}.jpg`), buf);
    const old = req.user.vehicle?.photo;
    if (old) fs.rm(path.join(cfg.photoDir, `${old}.jpg`), { force: true }, () => {});
    req.user.vehicle = { ...(req.user.vehicle || { type: null, make: '', model: '', odometer: null }), photo: pid };
    store.save();
    res.json({ user: publicUser(req.user) });
  });
  app.delete('/api/me/photo', auth, (req, res) => {
    const old = req.user.vehicle?.photo;
    if (old) { fs.rm(path.join(cfg.photoDir, `${old}.jpg`), { force: true }, () => {}); req.user.vehicle.photo = null; store.save(); }
    res.json({ user: publicUser(req.user) });
  });
  app.get('/photos/:pid.jpg', (req, res) => {
    if (!/^[\w-]{8,20}$/.test(req.params.pid)) return res.status(404).end();
    res.sendFile(path.join(cfg.photoDir, `${req.params.pid}.jpg`), { maxAge: '30d', immutable: true }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });

  // ---------- groups ----------
  app.post('/api/groups', auth, (req, res) => {
    const name = clean(req.body?.name, LIMITS.name);
    if (!name) return fail(res, 400, 'Give the group a name.');
    let c;
    do c = code(); while (db.groups.some((g) => g.code === c));
    const g = { id: id(), code: c, name, ownerId: req.user.id, members: [req.user.id], plan: null, createdAt: Date.now() };
    db.groups.push(g);
    store.save();
    res.status(201).json({ group: groupView(g) });
  });
  app.post('/api/groups/join', auth, (req, res) => {
    const c = clean(req.body?.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const g = db.groups.find((x) => x.code === c);
    if (!g) return fail(res, 404, 'No group has that code. Check it with the group leader.');
    if (!g.members.includes(req.user.id)) {
      if (g.members.length >= LIMITS.membersPerGroup) return fail(res, 409, 'This group is full (50 riders).');
      g.members.push(req.user.id);
      store.save();
      broadcast(g.id, { t: 'members', group: groupView(g) });
      systemMessage(g, `${req.user.name} joined the group`);
    }
    res.json({ group: groupView(g) });
  });
  app.get('/api/groups', auth, (req, res) => {
    res.json({ groups: db.groups.filter((g) => isMember(g, req.user.id)).map(groupView) });
  });
  app.get('/api/groups/:id', auth, memberGroup, (req, res) => res.json({ group: groupView(req.group) }));
  app.post('/api/groups/:id/leave', auth, memberGroup, (req, res) => {
    const g = req.group;
    g.members = g.members.filter((m) => m !== req.user.id);
    lastLoc.get(g.id)?.delete(req.user.id);
    if (!g.members.length) {
      db.groups.splice(db.groups.indexOf(g), 1);
      db.messages = db.messages.filter((m) => m.groupId !== g.id);
    } else {
      if (g.ownerId === req.user.id) g.ownerId = g.members[0];
      broadcast(g.id, { t: 'members', group: groupView(g) });
      systemMessage(g, `${req.user.name} left the group`);
    }
    store.save();
    res.json({ ok: true });
  });
  app.put('/api/groups/:id/plan', auth, memberGroup, (req, res) => {
    const b = req.body || {};
    if (b.clear) {
      req.group.plan = null;
    } else {
      const lat = num(b.lat), lng = num(b.lng);
      if (!clean(b.destination, 120) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        return fail(res, 400, 'Pick a destination from the search results.');
      }
      req.group.plan = {
        destination: clean(b.destination, 120), lat, lng,
        meetAt: clean(b.meetAt, 40) || null, note: clean(b.note, 280) || null,
        setBy: req.user.name, updatedAt: Date.now(),
      };
      systemMessage(req.group, `${req.user.name} set the ride plan: ${req.group.plan.destination}`);
    }
    store.save();
    broadcast(req.group.id, { t: 'members', group: groupView(req.group) });
    res.json({ group: groupView(req.group) });
  });
  app.get('/api/groups/:id/messages', auth, memberGroup, (req, res) => {
    res.json({ messages: db.messages.filter((m) => m.groupId === req.group.id).slice(-100) });
  });
  app.get('/api/groups/:id/qr.svg', auth, memberGroup, async (req, res) => {
    const base = `${req.protocol}://${req.get('host')}`;
    const svg = await QRCode.toString(`${base}/?join=${req.group.code}`, { type: 'svg', margin: 1, color: { dark: '#1A222C', light: '#FFFFFF' } });
    res.type('image/svg+xml').send(svg);
  });

  // ---------- rides ----------
  app.get('/api/rides', auth, (req, res) => {
    res.json({ rides: db.rides.filter((r) => r.userId === req.user.id).map(({ points, ...r }) => ({ ...r, pointCount: points.length })).reverse() });
  });
  app.get('/api/rides/:rid', auth, (req, res) => {
    const r = db.rides.find((x) => x.id === req.params.rid && x.userId === req.user.id);
    if (!r) return fail(res, 404, 'Ride not found.');
    res.json({ ride: r });
  });
  app.post('/api/rides', auth, (req, res) => {
    const b = req.body || {};
    const points = Array.isArray(b.points) ? b.points.slice(0, LIMITS.ridePoints)
      .map((p) => [num(p[0]), num(p[1]), num(p[2]) || 0])
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180) : [];
    if (points.length < 2) return fail(res, 400, 'This ride is too short to save.');
    let distance = 0;
    for (let i = 1; i < points.length; i++) distance += haversine(points[i - 1], points[i]);
    const r = {
      id: id(), userId: req.user.id, name: clean(b.name, 60) || clean(b.destination, 80) || `Ride on ${new Date().toDateString()}`,
      destination: clean(b.destination, 80) || null, origin: clean(b.origin, 80) || null,
      groupName: clean(b.groupName, 40) || null, vehicle: req.user.vehicle?.model || null,
      startedAt: num(b.startedAt) || Date.now(), duration: Math.max(0, num(b.duration) || 0),
      distance: Math.round(distance), maxSpeed: Math.max(0, num(b.maxSpeed) || 0), points,
    };
    r.avgSpeed = r.duration > 0 ? +(r.distance / r.duration).toFixed(2) : 0; // m/s
    db.rides.push(r);
    store.save();
    const { points: _p, ...summary } = r;
    res.status(201).json({ ride: { ...summary, pointCount: points.length } });
  });
  app.delete('/api/rides/:rid', auth, (req, res) => {
    const i = db.rides.findIndex((x) => x.id === req.params.rid && x.userId === req.user.id);
    if (i < 0) return fail(res, 404, 'Ride not found.');
    db.rides.splice(i, 1);
    store.save();
    res.json({ ok: true });
  });

  // ---------- fuel log ----------
  function fuelView(uid) {
    const list = db.fuel.filter((f) => f.userId === uid).sort((a, b) => a.odometer - b.odometer);
    // Mileage uses the full-tank method: distance since the previous full fill / litres added since then.
    let lastFull = null, litresSince = 0;
    const out = list.map((f) => {
      let kmpl = null;
      litresSince += f.litres;
      if (f.full) {
        // litresSince = every litre added after the previous full tank, including this fill.
        if (lastFull && litresSince > 0) kmpl = +((f.odometer - lastFull.odometer) / litresSince).toFixed(1);
        lastFull = f;
        litresSince = 0;
      }
      return { ...f, cost: +(f.litres * f.pricePerLitre).toFixed(2), kmpl };
    });
    const withK = out.filter((f) => f.kmpl);
    return {
      entries: out.reverse(),
      stats: {
        avgKmpl: withK.length ? +(withK.reduce((s, f) => s + f.kmpl, 0) / withK.length).toFixed(1) : null,
        totalSpent: +out.reduce((s, f) => s + f.cost, 0).toFixed(2),
        totalLitres: +out.reduce((s, f) => s + f.litres, 0).toFixed(2),
      },
    };
  }
  app.get('/api/fuel', auth, (req, res) => res.json(fuelView(req.user.id)));
  app.post('/api/fuel', auth, (req, res) => {
    const b = req.body || {};
    const odometer = num(b.odometer), litres = num(b.litres), pricePerLitre = num(b.pricePerLitre);
    if (!(odometer >= 0) || !(litres > 0) || !(pricePerLitre >= 0)) {
      return fail(res, 400, 'Enter the odometer reading, litres and price per litre.');
    }
    const prev = db.fuel.filter((f) => f.userId === req.user.id);
    if (prev.some((f) => f.odometer === odometer)) return fail(res, 409, 'There is already a fill-up at that odometer reading.');
    const f = { id: id(), userId: req.user.id, odometer, litres, pricePerLitre, full: b.full !== false, date: clean(b.date, 10) || new Date().toISOString().slice(0, 10) };
    db.fuel.push(f);
    store.save();
    res.status(201).json(fuelView(req.user.id));
  });
  app.delete('/api/fuel/:fid', auth, (req, res) => {
    const i = db.fuel.findIndex((f) => f.id === req.params.fid && f.userId === req.user.id);
    if (i < 0) return fail(res, 404, 'Entry not found.');
    db.fuel.splice(i, 1);
    store.save();
    res.json(fuelView(req.user.id));
  });

  // ---------- emergency contacts ----------
  app.get('/api/contacts', auth, (req, res) => res.json({ contacts: db.contacts[req.user.id] || [] }));
  app.put('/api/contacts', auth, (req, res) => {
    const list = Array.isArray(req.body?.contacts) ? req.body.contacts : null;
    if (!list) return fail(res, 400, 'Send a list of contacts.');
    const contacts = list.slice(0, 5).map((c) => ({ name: clean(c.name, 40), phone: clean(c.phone, 20).replace(/[^\d+]/g, '') }))
      .filter((c) => c.name && c.phone.length >= 6);
    db.contacts[req.user.id] = contacts;
    store.save();
    res.json({ contacts });
  });

  // ---------- map service proxies (routing, search, weather) ----------
  const cache = new Map();
  async function upstream(url, ttl) {
    const hit = cache.get(url);
    if (hit && hit.exp > Date.now()) return hit.body;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), cfg.upstreamTimeout);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': cfg.userAgent, Accept: 'application/json' }, signal: ctrl.signal });
      if (!r.ok) throw new Error(`upstream ${r.status}`);
      const body = await r.json();
      cache.set(url, { body, exp: Date.now() + ttl });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      return body;
    } finally {
      clearTimeout(t);
    }
  }
  const coord = (s) => {
    const [lng, lat] = String(s || '').split(',').map(Number);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lng, lat] : null;
  };
  app.get('/api/route', auth, async (req, res) => {
    const from = coord(req.query.from), to = coord(req.query.to);
    if (!from || !to) return fail(res, 400, 'Route needs a start and a destination.');
    try {
      const j = await upstream(`${cfg.osrm}/route/v1/driving/${from.join(',')};${to.join(',')}?overview=full&geometries=geojson&steps=true&alternatives=3`, 10 * 60e3);
      if (!j.routes?.length) return fail(res, 404, 'No road route found between those points.');
      const shape = (r) => ({
        distance: Math.round(r.distance), duration: Math.round(r.duration), geometry: r.geometry,
        steps: (r.legs?.[0]?.steps || []).map((s) => ({
          instruction: describeStep(s), distance: Math.round(s.distance), duration: Math.round(s.duration),
          location: s.maneuver?.location, type: s.maneuver?.type, modifier: s.maneuver?.modifier || null, road: s.name || '',
        })),
      });
      const options = j.routes.slice(0, 3).map(shape);
      // OSRM lists its preferred route first. Label the others by what they offer.
      options[0].label = 'Best';
      const rest = options.slice(1).sort((a, b) => a.duration - b.duration);
      if (rest[0]) rest[0].label = rest[0].duration < options[0].duration ? 'Fastest' : 'Shorter';
      if (rest[1]) rest[1].label = 'Scenic';
      if (rest[0] && rest[0].label === 'Shorter' && rest[0].distance >= options[0].distance) rest[0].label = 'Scenic';
      res.json({ ...options[0], options });
    } catch (e) {
      fail(res, 502, 'Routing is unavailable right now. Try again in a minute.');
    }
  });
  app.get('/api/search', auth, async (req, res) => {
    const q = clean(req.query.q, 120);
    if (q.length < 2) return res.json({ results: [] });
    const near = coord(req.query.near);
    let url = `${cfg.nominatim}/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
    if (near) url += `&viewbox=${near[0] - 1},${near[1] + 1},${near[0] + 1},${near[1] - 1}`;
    try {
      const j = await upstream(url, 60 * 60e3);
      res.json({ results: (j || []).map((p) => ({ name: p.display_name, lat: +p.lat, lng: +p.lon })) });
    } catch (e) {
      fail(res, 502, 'Place search is unavailable right now. Try again in a minute.');
    }
  });
  app.get('/api/weather', auth, async (req, res) => {
    const lat = num(req.query.lat), lng = num(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail(res, 400, 'Weather needs a location.');
    // MET Norway asks for coordinates rounded to 4 decimals for caching; 2 is plenty for riding.
    try {
      const j = await upstream(`${cfg.weather}?lat=${lat.toFixed(2)}&lon=${lng.toFixed(2)}`, 30 * 60e3);
      const now = j.properties?.timeseries?.[0]?.data;
      if (!now) return fail(res, 502, 'Weather data was empty.');
      res.json({
        temp: now.instant?.details?.air_temperature ?? null,
        wind: now.instant?.details?.wind_speed ?? null,
        symbol: now.next_1_hours?.summary?.symbol_code ?? now.next_6_hours?.summary?.symbol_code ?? null,
        rain: now.next_1_hours?.details?.precipitation_amount ?? null,
      });
    } catch (e) {
      fail(res, 502, 'Weather is unavailable right now.');
    }
  });

  // ---------- static frontend ----------
  app.use('/vendor/maplibre', express.static(path.join(ROOT, 'node_modules/maplibre-gl/dist'), { maxAge: '7d' }));
  app.use('/fonts', express.static(path.join(ROOT, 'node_modules/@fontsource-variable/google-sans-flex/files'), { maxAge: '30d' }));
  app.use('/fonts', express.static(path.join(ROOT, 'node_modules/@fontsource/roboto/files'), { maxAge: '30d' }));
  app.use('/icons', express.static(path.join(ROOT, 'assets/icons/web'), { maxAge: '7d' }));
  app.use(express.static(path.join(ROOT, 'web'), { setHeaders: (res, p) => { if (p.endsWith('sw.js')) res.set('Cache-Control', 'no-cache'); } }));
  app.use('/api', (req, res) => fail(res, 404, 'Unknown API route.'));
  app.get('*', (req, res) => res.sendFile(path.join(ROOT, 'web', 'index.html')));

  // ---------- realtime: presence, live location, chat, voice, SOS ----------
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2 * 1024 * 1024 });
  const rooms = new Map(); // groupId -> Set<ws>
  const lastLoc = new Map(); // groupId -> Map<userId, loc>
  const sos = new Map(); // groupId -> Map<userId, alert>

  function online(gid, uid) {
    for (const ws of rooms.get(gid) || []) if (ws.user.id === uid) return true;
    return false;
  }
  function broadcast(gid, msg, except) {
    const data = JSON.stringify(msg);
    for (const ws of rooms.get(gid) || []) if (ws !== except && ws.readyState === 1) ws.send(data);
  }
  function systemMessage(g, text) {
    const m = { id: id(), groupId: g.id, userId: null, name: 'Rylaide', type: 'system', text, ts: Date.now() };
    pushMessage(m);
    broadcast(g.id, { t: 'chat', message: m });
  }
  function pushMessage(m) {
    db.messages.push(m);
    const mine = db.messages.filter((x) => x.groupId === m.groupId);
    if (mine.length > LIMITS.messagesKept) {
      const drop = new Set(mine.slice(0, mine.length - LIMITS.messagesKept).map((x) => x.id));
      db.messages = db.messages.filter((x) => !drop.has(x.id));
    }
    store.save();
  }
  function leaveRoom(ws) {
    if (!ws.groupId) return;
    const gid = ws.groupId;
    rooms.get(gid)?.delete(ws);
    ws.groupId = null;
    if (!online(gid, ws.user.id)) broadcast(gid, { t: 'presence', userId: ws.user.id, online: false });
  }

  wss.on('connection', (ws, req) => {
    const t = new URL(req.url, 'http://x').searchParams.get('token');
    const user = t && userByToken(t);
    if (!user) return ws.close(4001, 'unauthorised');
    ws.user = user;
    ws.alive = true;
    ws.bucket = { n: 0, at: Date.now() };
    ws.on('pong', () => (ws.alive = true));
    const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));

    ws.on('message', (raw) => {
      // Simple rate limit: 40 messages per 5 s per socket (location ~1/s + chat + voice).
      const now = Date.now();
      if (now - ws.bucket.at > 5000) ws.bucket = { n: 0, at: now };
      if (++ws.bucket.n > 40) return send({ t: 'error', error: 'Slow down: too many messages.' });
      let m;
      try { m = JSON.parse(raw); } catch { return send({ t: 'error', error: 'Bad message.' }); }

      if (m.t === 'ping') return send({ t: 'pong', ts: m.ts });
      if (m.t === 'sub') {
        const g = groupOf(m.groupId);
        if (!isMember(g, user.id)) return send({ t: 'error', error: 'Join this group first.' });
        leaveRoom(ws);
        ws.groupId = g.id;
        if (!rooms.has(g.id)) rooms.set(g.id, new Set());
        rooms.get(g.id).add(ws);
        send({
          t: 'snapshot', group: groupView(g),
          locations: [...(lastLoc.get(g.id) || new Map()).values()],
          sos: [...(sos.get(g.id) || new Map()).values()],
        });
        broadcast(g.id, { t: 'presence', userId: user.id, online: true }, ws);
        return;
      }
      const g = groupOf(ws.groupId);
      if (!isMember(g, user.id)) return send({ t: 'error', error: 'Open a group first.' });

      switch (m.t) {
        case 'loc': {
          const lat = num(m.lat), lng = num(m.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
          const loc = {
            userId: user.id, name: user.name, color: user.color, lat, lng,
            speed: Number.isFinite(num(m.speed)) ? num(m.speed) : null,
            heading: Number.isFinite(num(m.heading)) ? num(m.heading) : null, ts: now,
          };
          if (!lastLoc.has(g.id)) lastLoc.set(g.id, new Map());
          lastLoc.get(g.id).set(user.id, loc);
          broadcast(g.id, { t: 'loc', loc }, ws);
          break;
        }
        case 'chat': {
          const text = clean(m.text, LIMITS.text);
          if (!text) return;
          const msg = { id: id(), groupId: g.id, userId: user.id, name: user.name, color: user.color, type: 'text', text, ts: now };
          pushMessage(msg);
          broadcast(g.id, { t: 'chat', message: msg });
          break;
        }
        case 'voice': {
          if (typeof m.data !== 'string' || !m.data.length) return;
          if (m.data.length > LIMITS.voiceBytes) return send({ t: 'error', error: 'Voice message is too long (60 s max).' });
          const dur = Math.max(0, Math.min(60, num(m.duration) || 0));
          broadcast(g.id, { t: 'voice', from: publicUser(user), mime: clean(m.mime, 60) || 'audio/webm', data: m.data, duration: dur, ts: now }, ws);
          const msg = { id: id(), groupId: g.id, userId: user.id, name: user.name, color: user.color, type: 'voice', text: `Voice message · ${dur.toFixed(0)} s`, ts: now };
          pushMessage(msg);
          broadcast(g.id, { t: 'chat', message: msg });
          break;
        }
        case 'sos': {
          const alert = { userId: user.id, name: user.name, lat: num(m.lat), lng: num(m.lng), ts: now };
          if (!sos.has(g.id)) sos.set(g.id, new Map());
          sos.get(g.id).set(user.id, alert);
          broadcast(g.id, { t: 'sos', alert });
          systemMessage(g, `SOS from ${user.name}`);
          break;
        }
        case 'sos_cancel': {
          sos.get(g.id)?.delete(user.id);
          broadcast(g.id, { t: 'sos_cancel', userId: user.id });
          systemMessage(g, `${user.name} is safe: SOS cancelled`);
          break;
        }
        case 'typing':
          broadcast(g.id, { t: 'typing', userId: user.id, name: user.name }, ws);
          break;
        default:
          send({ t: 'error', error: 'Unknown message.' });
      }
    });
    ws.on('close', () => leaveRoom(ws));
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));

  function close() {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    store.flush();
    return new Promise((r) => server.close(r));
  }

  return { app, server, store, close, cfg };
}

function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function describeStep(s) {
  const m = s.maneuver || {};
  const road = s.name ? ` onto ${s.name}` : '';
  const mod = m.modifier ? m.modifier.replace('uturn', 'U-turn') : '';
  switch (m.type) {
    case 'depart': return `Head ${dirWord(m.bearing_after)}${s.name ? ` on ${s.name}` : ''}`;
    case 'arrive': return 'Arrive at your destination';
    case 'roundabout': case 'rotary': return `At the roundabout, take exit ${m.exit || 1}${road}`;
    case 'merge': return `Merge ${mod}${road}`.trim();
    case 'fork': return `Keep ${mod}${road}`;
    case 'on ramp': return `Take the ramp${road}`;
    case 'off ramp': return `Take the exit${road}`;
    case 'end of road': return `At the end of the road, turn ${mod}${road}`;
    case 'continue': return `Continue ${mod === 'straight' ? 'straight' : mod}${road}`.replace(/\s+/g, ' ');
    default: return mod === 'straight' ? `Go straight${road}` : `Turn ${mod}${road}`;
  }
}
function dirWord(b = 0) {
  return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(b / 45) % 8];
}

module.exports = { createApp, haversine };

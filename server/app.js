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
/** FNV-1a 32-bit of a UTF-8 string: rider and group ids inside live voice packets (docs/offline-voice.md). */
function fnv32(s) {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(String(s), 'utf8')) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const COLORS = ['#F98924', '#2FC9C3', '#E5484D', '#8B7CF6', '#F5C542', '#4CC38A', '#EC6AA8', '#5AA9FF'];

function createApp(opts = {}) {
  const cfg = {
    dataFile: opts.dataFile ?? process.env.DATA_FILE ?? path.join(ROOT, 'data', 'rylaide.json'),
    osrm: opts.osrm ?? process.env.OSRM_URL ?? 'https://router.project-osrm.org',
    nominatim: opts.nominatim ?? process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org',
    weather: opts.weather ?? process.env.WEATHER_URL ?? 'https://api.met.no/weatherapi/locationforecast/2.0/compact',
    userAgent: opts.userAgent ?? process.env.USER_AGENT ?? 'Rylaide/0.1 (https://github.com/Drakeion2532/rylaide_ui)',
    upstreamTimeout: opts.upstreamTimeout ?? 8000,
    databaseUrl: opts.databaseUrl ?? process.env.DATABASE_URL ?? '',
    supportEmail: opts.supportEmail ?? process.env.SUPPORT_EMAIL ?? '', // set once the Rylaide support address exists
    adminKey: opts.adminKey ?? process.env.ADMIN_KEY ?? '',
  };
  // Owner bike photos live next to the data file (on the persistent disk in production).
  cfg.photoDir = opts.photoDir ?? process.env.PHOTO_DIR ?? path.join(cfg.dataFile ? path.dirname(cfg.dataFile) : fs.mkdtempSync(path.join(os.tmpdir(), 'rylaide-photos-')), 'photos');
  const remote = cfg.databaseUrl ? new (require('./pg').PgBackend)(cfg.databaseUrl) : null;
  const store = new Store(cfg.dataFile, { remote });
  const db = store.data;
  const ready = store.init();
  ready.catch(() => {}); // the caller awaits it and decides what to do
  // Bike photos: database rows when DATABASE_URL is set, otherwise files in photoDir.
  const photos = remote ? {
    put: (pid, buf) => remote.putPhoto(pid, buf),
    get: (pid) => remote.getPhoto(pid),
    del: (pid) => remote.delPhoto(pid).catch((e) => console.error('Photo delete failed:', e.message)),
  } : {
    put: async (pid, buf) => { fs.mkdirSync(cfg.photoDir, { recursive: true }); fs.writeFileSync(path.join(cfg.photoDir, `${pid}.jpg`), buf); },
    get: async (pid) => { try { return fs.readFileSync(path.join(cfg.photoDir, `${pid}.jpg`)); } catch { return null; } },
    del: async (pid) => fs.promises.rm(path.join(cfg.photoDir, `${pid}.jpg`), { force: true }),
  };
  const app = express();
  app.disable('x-powered-by');
  // Hosts like Render/Railway terminate HTTPS at a proxy; trust it so QR invite links use https://.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '3mb' }));
  // Versioned API for the Android app (Figma: Implementation notes). /api/v1/... is the stable name for /api/...
  app.use((req, res, next) => { if (req.url.startsWith('/api/v1/')) req.url = `/api/${req.url.slice(8)}`; next(); });
  app.get('/api/openapi.json', (req, res) => res.json(require('./openapi')({ base: `${req.protocol}://${req.get('host')}` })));
  app.get('/api/docs', (req, res) => res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rylaide API</title></head><body style="margin:0"><redoc spec-url="/api/v1/openapi.json"></redoc><script src="https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js"></script></body></html>`));

  // ---------- helpers ----------
  const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
  const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
  const publicUser = (u) => u && { id: u.id, name: u.name, bike: u.bike, color: u.color, vehicle: activeVehicle(u), vehicleCount: vehiclesOf(u).length };
  /** A rider's vehicles (12 My vehicles). Older accounts had one `vehicle`; move it into the list on first use. */
  function vehiclesOf(u) {
    if (!Array.isArray(u.vehicles)) {
      u.vehicles = u.vehicle ? [{ id: id(), ...u.vehicle }] : [];
      u.activeVehicleId = u.vehicles[0]?.id || null;
      delete u.vehicle;
    }
    return u.vehicles;
  }
  function activeVehicle(u) {
    const vs = vehiclesOf(u);
    return vs.find((v) => v.id === u.activeVehicleId) || vs[0] || null;
  }
  // Bike shown on Home and in Garage. All fields optional; odometer in km.
  const VEHICLE_TYPES = ['classic', 'roadster', 'cruiser', 'adventure', 'sport', 'commuter', 'scooter', 'ev-scooter', 'bicycle', 'e-bike'];
  function cleanVehicle(v, prev = {}) {
    if (v === null) return null;
    if (typeof v !== 'object') return undefined;
    const odo = num(v.odometer);
    if (v.odometer !== undefined && v.odometer !== '' && v.odometer !== null && !(odo >= 0 && odo < 10_000_000)) return undefined;
    const year = num(v.year);
    if (v.year !== undefined && v.year !== '' && v.year !== null && !(year >= 1950 && year <= new Date().getFullYear() + 1)) return undefined;
    const keep = (k, f) => (v[k] === undefined ? prev?.[k] ?? null : f(v[k]));
    const type = VEHICLE_TYPES.includes(v.type) ? v.type : prev?.type && v.type === undefined ? prev.type : null;
    return {
      id: prev?.id || id(),
      type, make: clean(v.make ?? prev?.make, 30), model: clean(v.model ?? prev?.model, 40),
      odometer: v.odometer === undefined ? prev?.odometer ?? null : Number.isFinite(odo) ? Math.round(odo) : null,
      year: keep('year', () => (Number.isFinite(year) ? Math.round(year) : null)),
      reg: keep('reg', (x) => clean(x, 15).toUpperCase() || null),
      nickname: keep('nickname', (x) => clean(x, 30) || null),
      photo: prev?.photo || null, // set only through the photo upload endpoint
    };
  }
  const VEHICLE_ERROR = 'Check the bike details: odometer must be a number of km and the year between 1950 and next year.';
  const userByToken = (t) => db.users.find((u) => u.token === t);
  /** Account code (05 Sign in): how a rider gets back into their account on a new phone. No look-alike characters. */
  function newSigninCode() {
    const CH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let c;
    do c = Array.from(require('crypto').randomBytes(8), (b) => CH[b % CH.length]).join('').replace(/(.{4})/, '$1-');
    while (db.users.some((u) => u.signinCode === c));
    return c;
  }
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
      description: g.description || '', live: g.live && Date.now() - g.live.startedAt < 12 * 3600e3 ? g.live : null,
      members: g.members.map((m) => ({ ...publicUser(db.users.find((u) => u.id === m)), online: online(g.id, m) })),
    };
  }

  // ---------- accounts ----------
  app.get('/healthz', (req, res) => res.json({ ok: true, users: db.users.length, groups: db.groups.length, storage: remote ? 'database' : 'file' }));

  app.post('/api/users', (req, res) => {
    const name = clean(req.body?.name, LIMITS.name);
    if (!name) return fail(res, 400, 'Enter your name so your group knows who you are.');
    const u = {
      id: id(), token: token(), name, bike: clean(req.body?.bike, 20) || 'motorcycle',
      color: COLORS[db.users.length % COLORS.length], createdAt: Date.now(),
      vehicles: [], activeVehicleId: null, termsAt: req.body?.agreed ? Date.now() : null,
      signinCode: newSigninCode(),
    };
    const v0 = req.body?.vehicle ? cleanVehicle(req.body.vehicle) : null;
    if (v0) { u.vehicles.push(v0); u.activeVehicleId = v0.id; }
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
      // Edits the active vehicle (creates the first one), as the Home and onboarding forms expect.
      const vs = vehiclesOf(req.user), cur = activeVehicle(req.user);
      if (req.body.vehicle === null) {
        if (cur) { if (cur.photo) photos.del(cur.photo); vs.splice(vs.indexOf(cur), 1); req.user.activeVehicleId = vs[0]?.id || null; }
      } else {
        const v = cleanVehicle(req.body.vehicle, cur);
        if (v === undefined) return fail(res, 400, VEHICLE_ERROR);
        if (cur) vs[vs.indexOf(cur)] = v; else { vs.push(v); req.user.activeVehicleId = v.id; }
      }
    }
    store.save();
    res.json({ user: publicUser(req.user) });
  });

  // Owner photo of a bike: JPEG, base64, resized on the phone to about 1400 px.
  async function setVehiclePhoto(req, res, v) {
    const b64 = String(req.body?.data || '').replace(/^data:image\/jpeg;base64,/, '');
    let buf;
    try { buf = Buffer.from(b64, 'base64'); } catch { buf = null; }
    if (!buf || buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8) return fail(res, 400, 'Choose a photo (JPEG) of your bike.');
    if (buf.length > 2_000_000) return fail(res, 413, 'That photo is too large. Try a smaller one.');
    const pid = id();
    try { await photos.put(pid, buf); } catch (e) { console.error('Photo save failed:', e.message); return fail(res, 503, 'Couldn’t save the photo. Try again.'); }
    const vs = vehiclesOf(req.user);
    if (!v) { v = cleanVehicle({}); vs.push(v); req.user.activeVehicleId = v.id; }
    if (v.photo) photos.del(v.photo);
    v.photo = pid;
    store.save();
    res.json({ user: publicUser(req.user), vehicle: v });
  }
  function clearVehiclePhoto(req, res, v) {
    if (v?.photo) { photos.del(v.photo); v.photo = null; store.save(); }
    res.json({ user: publicUser(req.user), vehicle: v || null });
  }
  app.post('/api/me/photo', auth, (req, res) => setVehiclePhoto(req, res, activeVehicle(req.user)));
  app.delete('/api/me/photo', auth, (req, res) => clearVehiclePhoto(req, res, activeVehicle(req.user)));
  app.get('/photos/:pid.jpg', async (req, res) => {
    if (!/^[\w-]{8,20}$/.test(req.params.pid)) return res.status(404).end();
    try {
      const buf = await photos.get(req.params.pid);
      if (!buf) return res.status(404).end();
      res.set({ 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=2592000, immutable' }).send(buf);
    } catch (e) { console.error('Photo read failed:', e.message); res.status(503).end(); }
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
  /** Take a rider out of a group (leave, removed by the leader, or account deleted). Empty groups are deleted. */
  function dropFromGroup(g, user, how = 'left') {
    g.members = g.members.filter((m) => m !== user.id);
    lastLoc.get(g.id)?.delete(user.id);
    for (const ws of rooms.get(g.id) || []) if (ws.user.id === user.id) { rooms.get(g.id).delete(ws); ws.groupId = null; }
    if (!g.members.length) {
      deleteGroup(g);
    } else {
      if (g.ownerId === user.id) g.ownerId = g.members[0];
      broadcast(g.id, { t: 'members', group: groupView(g) });
      systemMessage(g, how === 'removed' ? `${user.name} was removed from the group` : `${user.name} left the group`);
    }
    store.save();
  }
  function deleteGroup(g) {
    db.groups.splice(db.groups.indexOf(g), 1);
    db.messages = db.messages.filter((m) => m.groupId !== g.id);
    db.expenses = (db.expenses || []).filter((x) => x.groupId !== g.id);
    db.shared = (db.shared || []).filter((x) => x.groupId !== g.id);
    lastLoc.delete(g.id); sos.delete(g.id);
  }
  app.post('/api/groups/:id/leave', auth, memberGroup, (req, res) => {
    dropFromGroup(req.group, req.user, 'left');
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
      groupName: clean(b.groupName, 40) || null, groupId: isMember(groupOf(b.groupId), req.user.id) ? b.groupId : null,
      vehicleId: vehiclesOf(req.user).some((v) => v.id === b.vehicleId) ? b.vehicleId : activeVehicle(req.user)?.id || null,
      vehicle: (vehiclesOf(req.user).find((v) => v.id === b.vehicleId) || activeVehicle(req.user))?.model || null,
      solo: !b.groupId, pillion: !!b.pillion, quick: !!b.quick,
      refills: (Array.isArray(b.refills) ? b.refills : []).slice(0, 20).map((f) => ({ litres: Math.max(0, num(f.litres) || 0), cost: Math.max(0, num(f.cost) || 0), at: num(f.at) || null })),
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
  /** Fill-ups of one vehicle. Entries from before multi-vehicle support belong to the first vehicle. */
  const fuelOf = (u, vid) => { const first = vehiclesOf(u)[0]?.id || null; return db.fuel.filter((f) => f.userId === u.id && (!vid || (f.vehicleId || first) === vid)); };
  const vehicleParam = (u, vid) => (vehiclesOf(u).some((v) => v.id === vid) ? vid : activeVehicle(u)?.id || null);
  function fuelView(u, vid) {
    const list = fuelOf(u, vid).sort((a, b) => a.odometer - b.odometer);
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
  app.get('/api/fuel', auth, (req, res) => res.json(fuelView(req.user, vehicleParam(req.user, req.query.vehicle))));
  app.post('/api/fuel', auth, (req, res) => {
    const b = req.body || {};
    let odometer = num(b.odometer); const litres = num(b.litres), pricePerLitre = num(b.pricePerLitre);
    if (!(odometer >= 0) || !(litres > 0) || !(pricePerLitre >= 0)) {
      return fail(res, 400, 'Enter the odometer reading, litres and price per litre.');
    }
    const vid = vehicleParam(req.user, b.vehicleId);
    // Refills logged mid-ride send an estimated odometer; nudge it rather than reject a clash.
    if (b.estimated) while (fuelOf(req.user, vid).some((f) => f.odometer === odometer)) odometer = Math.round((odometer + 0.1) * 10) / 10;
    if (fuelOf(req.user, vid).some((f) => f.odometer === odometer)) return fail(res, 409, 'There is already a fill-up at that odometer reading.');
    const f = { id: id(), userId: req.user.id, vehicleId: vid, odometer, litres, pricePerLitre, full: b.full !== false, date: clean(b.date, 10) || new Date().toISOString().slice(0, 10) };
    db.fuel.push(f);
    const veh = vehiclesOf(req.user).find((v) => v.id === vid);
    if (veh && odometer > (veh.odometer || 0)) veh.odometer = Math.round(odometer); // the bike's odometer follows the fuel log
    store.save();
    res.status(201).json({ ...fuelView(req.user, vid), user: publicUser(req.user) });
  });
  app.delete('/api/fuel/:fid', auth, (req, res) => {
    const i = db.fuel.findIndex((f) => f.id === req.params.fid && f.userId === req.user.id);
    if (i < 0) return fail(res, 404, 'Entry not found.');
    const vid = db.fuel[i].vehicleId || vehiclesOf(req.user)[0]?.id || null;
    db.fuel.splice(i, 1);
    store.save();
    res.json(fuelView(req.user, vid));
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

  // ---------- garage, groups, accounts, nearby (Figma: navigation map screens) ----------
  require('./features')(app, {
    db, store, cfg, auth, memberGroup, groupView, publicUser, vehiclesOf, activeVehicle, cleanVehicle, VEHICLE_ERROR,
    setVehiclePhoto, clearVehiclePhoto, photos, clean, num, fail, id, code, newSigninCode, LIMITS,
    upstream, broadcast: (...a) => broadcast(...a), systemMessage: (...a) => systemMessage(...a), toUser: (...a) => toUser(...a),
    dropFromGroup: (...a) => dropFromGroup(...a), deleteGroup: (...a) => deleteGroup(...a), userByToken, haversine, VERSION: require('../package.json').version,
  });

  // ---------- static frontend ----------
  app.use('/vendor/nsup', express.static(path.join(ROOT, 'node_modules/@sapphi-red/web-noise-suppressor/dist'), { maxAge: '30d' })); // RNNoise
  app.use('/vendor/opusdec', express.static(path.join(ROOT, 'node_modules/opus-decoder/dist'), { maxAge: '30d' })); // Opus playback where WebCodecs is missing
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
  /** Send to every open connection of one rider (any group). */
  function toUser(uid, msg) {
    const data = JSON.stringify(msg);
    for (const ws of wss.clients) if (ws.user?.id === uid && ws.readyState === 1) ws.send(data);
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

  // ---------- live voice: RVP packets (16-byte header + one 20 ms Opus frame), relayed as-is to the group ----------
  const voiceSeen = new Map(); // groupId -> Map<"sender:seq:kind", time>: a rider heard twice (direct + via a gateway) plays once
  function liveVoice(ws, raw) {
    const g = groupOf(ws.groupId);
    if (!g || !isMember(g, ws.user.id)) return;
    const b = Buffer.isBuffer(raw) ? raw : Buffer.concat([].concat(raw));
    if (b.length < 16 || b.length > 1200 || b[0] !== 1 || (b[1] !== 1 && b[1] !== 2)) return;
    if (b.readUInt32BE(6) !== fnv32(g.id)) return; // packet for another group
    const now = Date.now();
    const v = ws.voice;
    if (now - v.at > 1000) { v.n = 0; v.bytes = 0; v.at = now; }
    v.n++; v.bytes += b.length;
    if (v.n > 250 || v.bytes > 40000) return; // ~5 riders relayed through one gateway phone; beyond that, drop
    const own = fnv32(ws.user.id);
    let sender = b.readUInt32BE(2);
    const gateway = (b[13] & 1) === 1;
    // A gateway rider forwards nearby riders' voice from the offline mesh: keep their id only if they're in this group.
    if (!(gateway && sender !== own && g.members.some((m) => fnv32(m) === sender))) { sender = own; b.writeUInt32BE(own, 2); }
    if (sender === own) b[13] &= ~1;
    const key = `${sender}:${b.readUInt16BE(10)}:${b[1]}`;
    let seen = voiceSeen.get(g.id);
    if (!seen) voiceSeen.set(g.id, (seen = new Map()));
    if (seen.has(key) && now - seen.get(key) < 10000) return;
    seen.set(key, now);
    if (seen.size > 4000) for (const [k, t] of seen) { if (now - t > 10000 || seen.size > 3000) seen.delete(k); else break; }
    for (const peer of rooms.get(g.id) || []) {
      if (peer === ws || peer.readyState !== 1 || fnv32(peer.user.id) === sender) continue;
      if (peer.bufferedAmount > 64 * 1024) continue; // a slow phone skips frames rather than falling behind
      peer.send(b, { binary: true });
    }
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

    ws.voice = { n: 0, bytes: 0, at: Date.now() };
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return liveVoice(ws, raw);
      // Simple rate limit for JSON messages (location ~1/s + chat + fallback voice clips). Live voice is binary.
      const now = Date.now();
      if (now - ws.bucket.at > 5000) ws.bucket = { n: 0, at: now };
      if (++ws.bucket.n > 90) return send({ t: 'error', error: 'Slow down: too many messages.' }); // voice streams 5 slices/s
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
        case 'vchunk': {
          // Streamed voice clips (browsers that can't encode live Opus): relayed as they arrive, never stored.
          // A clip from a voice-message sender adds a chat line; live voice (live:true) doesn't.
          const sid = clean(m.sid, 16);
          if (!sid) return;
          if (m.end) {
            const v = ws.vstream?.sid === sid ? ws.vstream : null;
            broadcast(g.id, { t: 'vchunk', from: publicUser(user), sid, seq: -1, end: true, duration: Math.max(0, Math.min(60, num(m.duration) || 0)) }, ws);
            if (v && !m.live) {
              const dur = Math.max(0, Math.min(60, num(m.duration) || (now - v.at) / 1000));
              const msg = { id: id(), groupId: g.id, userId: user.id, name: user.name, color: user.color, type: 'voice', text: `Voice message · ${dur.toFixed(0)} s`, ts: now };
              pushMessage(msg);
              broadcast(g.id, { t: 'chat', message: msg });
            }
            ws.vstream = null;
            return;
          }
          if (typeof m.data !== 'string' || !m.data.length || m.data.length > 120_000) return;
          if (!ws.vstream || ws.vstream.sid !== sid) ws.vstream = { sid, bytes: 0, at: now };
          ws.vstream.bytes += m.data.length;
          if (ws.vstream.bytes > LIMITS.voiceBytes) return send({ t: 'error', error: 'Voice message is too long (60 s max).' });
          broadcast(g.id, { t: 'vchunk', from: publicUser(user), sid, seq: Math.max(0, Math.floor(num(m.seq) || 0)), mime: clean(m.mime, 60) || 'audio/webm', data: m.data }, ws);
          break;
        }
        case 'vcancel': {
          if (ws.vstream?.sid === m.sid) ws.vstream = null;
          broadcast(g.id, { t: 'vcancel', sid: clean(m.sid, 16) }, ws);
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
    return Promise.all([store.close().catch((e) => console.error('Final save failed:', e.message)), new Promise((r) => server.close(r))]);
  }

  return { app, server, store, close, cfg, ready };
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

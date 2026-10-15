const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { createApp, haversine } = require('../server/app');
const { startMockUpstream } = require('./helpers/mock-upstream');

let up, srv, base, wsBase, dataFile;

before(async () => {
  up = await startMockUpstream();
  dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rylaide-')), 'db.json');
  srv = createApp({ dataFile, osrm: up.base, nominatim: up.base, weather: `${up.base}/weather` });
  await new Promise((r) => srv.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.server.address().port}`;
  wsBase = base.replace('http', 'ws');
});
after(async () => { await srv.close(); await up.close(); });

async function api(method, p, body, tok) {
  const r = await fetch(base + p, {
    method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
const signup = async (name) => (await api('POST', '/api/users', { name, bike: 'scooter' })).body;

function socket(tok) {
  const ws = new WebSocket(`${wsBase}/ws?token=${tok}`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  ws.next = (pred, ms = 3000) => {
    const found = inbox.find(pred);
    if (found) { inbox.splice(inbox.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((res, rej) => {
      const w = { pred: (m) => { if (pred(m)) { inbox.splice(inbox.indexOf(m), 1); return true; } return false; }, res };
      waiters.push(w);
      setTimeout(() => rej(new Error('timeout waiting for ws message')), ms);
    });
  };
  ws.json = (m) => ws.send(JSON.stringify(m));
  ws.opened = new Promise((r, j) => { ws.on('open', r); ws.on('close', (c) => j(new Error(`closed ${c}`))); });
  return ws;
}

test('health and static app shell', async () => {
  assert.equal((await api('GET', '/healthz')).body.ok, true);
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /Rylaide/);
  assert.equal((await fetch(base + '/vendor/maplibre/maplibre-gl.js')).status, 200);
  assert.equal((await fetch(base + '/icons/icon-192.png')).status, 200);
  assert.equal((await fetch(base + '/fonts/barlow-latin-400-normal.woff2')).status, 200);
  assert.equal((await fetch(base + '/some/deep/link')).status, 200, 'SPA fallback');
  assert.equal((await api('GET', '/api/nope')).status, 404);
});

test('sign up validation and profile updates', async () => {
  assert.equal((await api('POST', '/api/users', { name: '   ' })).status, 400);
  const a = await signup('  Asha\u0007 ');
  assert.equal(a.user.name, 'Asha');
  assert.ok(a.token.length > 20);
  assert.equal((await api('GET', '/api/me', undefined, 'bad')).status, 401);
  assert.equal((await api('GET', '/api/me', undefined, a.token)).body.user.id, a.user.id);
  assert.equal((await api('PATCH', '/api/me', { color: 'red' }, a.token)).status, 400);
  assert.equal((await api('PATCH', '/api/me', { name: '' }, a.token)).status, 400);
  const p = await api('PATCH', '/api/me', { name: 'Asha K', color: '#2fc9c3', bike: 'cruiser' }, a.token);
  assert.deepEqual([p.body.user.name, p.body.user.color, p.body.user.bike], ['Asha K', '#2fc9c3', 'cruiser']);
  assert.equal(p.body.user.token, undefined, 'token never leaks in user objects');
});

test('groups: create, join by code, permissions, plan, QR, leave', async () => {
  const a = await signup('Leader');
  const b = await signup('Rider');
  const c = await signup('Stranger');
  assert.equal((await api('POST', '/api/groups', { name: '' }, a.token)).status, 400);
  const g = (await api('POST', '/api/groups', { name: 'Sunday Sinhagad' }, a.token)).body.group;
  assert.match(g.code, /^[A-HJ-KM-NP-Z2-9]{6}$/);
  assert.equal((await api('POST', '/api/groups/join', { code: 'ZZZZZZ' }, b.token)).status, 404);
  const joined = await api('POST', '/api/groups/join', { code: ` ${g.code.toLowerCase().slice(0, 3)}-${g.code.slice(3)} ` }, b.token);
  assert.equal(joined.status, 200, 'codes are case and punctuation insensitive');
  assert.equal(joined.body.group.members.length, 2);
  await api('POST', '/api/groups/join', { code: g.code }, b.token);
  assert.equal((await api('GET', `/api/groups/${g.id}`, undefined, b.token)).body.group.members.length, 2, 'join is idempotent');
  assert.equal((await api('GET', `/api/groups/${g.id}`, undefined, c.token)).status, 403);
  assert.equal((await api('GET', `/api/groups/${g.id}/messages`, undefined, c.token)).status, 403);
  assert.equal((await api('GET', '/api/groups/nope', undefined, a.token)).status, 404);
  assert.equal((await api('GET', '/api/groups', undefined, b.token)).body.groups.length, 1);

  assert.equal((await api('PUT', `/api/groups/${g.id}/plan`, { destination: 'Fort' }, b.token)).status, 400);
  const plan = await api('PUT', `/api/groups/${g.id}/plan`, { destination: 'Sinhagad Fort', lat: 18.36, lng: 73.75, meetAt: '06:00', note: 'Full tanks' }, b.token);
  assert.equal(plan.body.group.plan.destination, 'Sinhagad Fort');
  assert.equal(plan.body.group.plan.setBy, 'Rider');
  const msgs = (await api('GET', `/api/groups/${g.id}/messages`, undefined, a.token)).body.messages;
  assert.ok(msgs.some((m) => m.type === 'system' && /joined/.test(m.text)));
  assert.ok(msgs.some((m) => /ride plan/.test(m.text)));

  const qr = await fetch(`${base}/api/groups/${g.id}/qr.svg`, { headers: { authorization: `Bearer ${a.token}` } });
  assert.equal(qr.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
  assert.match(await qr.text(), /<svg/);

  assert.equal((await api('POST', `/api/groups/${g.id}/leave`, {}, a.token)).status, 200);
  const after = (await api('GET', `/api/groups/${g.id}`, undefined, b.token)).body.group;
  assert.equal(after.ownerId, b.user.id, 'ownership passes on');
  await api('POST', `/api/groups/${g.id}/leave`, {}, b.token);
  assert.equal((await api('GET', `/api/groups/${g.id}`, undefined, b.token)).status, 404, 'empty group is deleted');
});

test('rides: validation, distance, privacy, delete', async () => {
  const a = await signup('Ride A');
  const b = await signup('Ride B');
  assert.equal((await api('POST', '/api/rides', { points: [[18.5, 73.8]] }, a.token)).status, 400);
  const pts = [[18.5204, 73.8567, 0], [18.5304, 73.8567, 10], [18.5304, 73.8667, 20], ['x', 'y'], [200, 0]];
  const r = await api('POST', '/api/rides', { name: 'Evening loop', points: pts, duration: 1200, maxSpeed: 16.6, startedAt: 1 }, a.token);
  assert.equal(r.status, 201);
  assert.equal(r.body.ride.pointCount, 3, 'bad points dropped');
  const expected = haversine(pts[0], pts[1]) + haversine(pts[1], pts[2]);
  assert.equal(r.body.ride.distance, Math.round(expected));
  assert.ok(r.body.ride.distance > 2100 && r.body.ride.distance < 2250);
  assert.equal((await api('GET', '/api/rides', undefined, b.token)).body.rides.length, 0, 'rides are private');
  assert.equal((await api('GET', `/api/rides/${r.body.ride.id}`, undefined, b.token)).status, 404);
  assert.equal((await api('GET', `/api/rides/${r.body.ride.id}`, undefined, a.token)).body.ride.points.length, 3);
  assert.equal((await api('DELETE', `/api/rides/${r.body.ride.id}`, undefined, b.token)).status, 404);
  assert.equal((await api('DELETE', `/api/rides/${r.body.ride.id}`, undefined, a.token)).status, 200);
  assert.equal((await api('GET', '/api/rides', undefined, a.token)).body.rides.length, 0);
});

test('fuel log: full-tank mileage, partial fills, duplicates, delete', async () => {
  const a = await signup('Fuel');
  assert.equal((await api('POST', '/api/fuel', { odometer: 100, litres: 0, pricePerLitre: 105 }, a.token)).status, 400);
  await api('POST', '/api/fuel', { odometer: 1000, litres: 10, pricePerLitre: 105, full: true }, a.token);
  await api('POST', '/api/fuel', { odometer: 1200, litres: 4, pricePerLitre: 106, full: false }, a.token);
  const r = await api('POST', '/api/fuel', { odometer: 1450, litres: 6, pricePerLitre: 104, full: true }, a.token);
  // 450 km on 10 litres (4 partial + 6 to fill) = 45.0 km/l
  const top = r.body.entries[0];
  assert.equal(top.odometer, 1450);
  assert.equal(top.kmpl, 45);
  assert.equal(r.body.entries.find((e) => e.odometer === 1200).kmpl, null);
  assert.equal(r.body.stats.avgKmpl, 45);
  assert.equal(r.body.stats.totalLitres, 20);
  assert.equal(r.body.stats.totalSpent, +(1050 + 424 + 624).toFixed(2));
  assert.equal((await api('POST', '/api/fuel', { odometer: 1450, litres: 1, pricePerLitre: 1 }, a.token)).status, 409);
  const d = await api('DELETE', `/api/fuel/${top.id}`, undefined, a.token);
  assert.equal(d.body.entries.length, 2);
  assert.equal(d.body.stats.avgKmpl, null);
});

test('emergency contacts are cleaned and capped', async () => {
  const a = await signup('Safe');
  const r = await api('PUT', '/api/contacts', { contacts: [
    { name: 'Mom', phone: '+91 98765-43210' }, { name: '', phone: '12345678' }, { name: 'Short', phone: '12' },
    ...Array.from({ length: 6 }, (_, i) => ({ name: `C${i}`, phone: '9999999999' })),
  ] }, a.token);
  assert.equal(r.body.contacts[0].phone, '+919876543210');
  assert.ok(r.body.contacts.length <= 5);
  assert.ok(r.body.contacts.every((c) => c.name && c.phone.length >= 6));
  assert.equal((await api('PUT', '/api/contacts', { contacts: 'x' }, a.token)).status, 400);
});

test('routing, search and weather proxies', async () => {
  const a = await signup('Nav');
  assert.equal((await api('GET', '/api/route?from=x&to=y', undefined, a.token)).status, 400);
  const r = await api('GET', '/api/route?from=73.85,18.52&to=73.75,18.36', undefined, a.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.distance, 12346);
  assert.equal(r.body.geometry.coordinates.length, 3);
  assert.deepEqual(r.body.steps.map((s) => s.instruction), [
    'Head east on FC Road', 'Turn left onto Ganeshkhind Road', 'At the roundabout, take exit 2', 'Arrive at your destination',
  ]);
  assert.equal((await api('GET', '/api/route?from=0,0&to=1,1', undefined, a.token)).status, 404);
  assert.ok(up.calls.every((c) => /Rylaide/.test(c.ua)), 'identifies itself to OSM services');

  assert.deepEqual((await api('GET', '/api/search?q=a', undefined, a.token)).body.results, []);
  const s = await api('GET', '/api/search?q=Sinhagad&near=73.85,18.52', undefined, a.token);
  assert.equal(s.body.results[0].lat, 18.5204);
  assert.equal((await api('GET', '/api/search?q=nowhere', undefined, a.token)).body.results.length, 0);

  const w = await api('GET', '/api/weather?lat=18.52&lng=73.85', undefined, a.token);
  assert.deepEqual(w.body, { temp: 27.4, wind: 3.1, symbol: 'partlycloudy_day', rain: 0 });
  const before = up.calls.length;
  await api('GET', '/api/weather?lat=18.52&lng=73.85', undefined, a.token);
  assert.equal(up.calls.length, before, 'weather is cached');
});

test('map services down: clear 502 errors, no crash', async () => {
  const down = createApp({ dataFile: null, osrm: 'http://127.0.0.1:9', nominatim: 'http://127.0.0.1:9', weather: 'http://127.0.0.1:9', upstreamTimeout: 1000 });
  await new Promise((r) => down.server.listen(0, '127.0.0.1', r));
  const b2 = `http://127.0.0.1:${down.server.address().port}`;
  const { token } = await (await fetch(`${b2}/api/users`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"x"}' })).json();
  for (const p of ['/api/route?from=73.8,18.5&to=73.7,18.3', '/api/search?q=pune', '/api/weather?lat=1&lng=1']) {
    const r = await fetch(b2 + p, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 502, p);
    assert.match((await r.json()).error, /unavailable/);
  }
  await down.close();
});

test('realtime: presence, location, chat, voice, SOS, permissions', async () => {
  const a = await signup('WS Leader');
  const b = await signup('WS Rider');
  const c = await signup('WS Outsider');
  const g = (await api('POST', '/api/groups', { name: 'Live' }, a.token)).body.group;
  await api('POST', '/api/groups/join', { code: g.code }, b.token);

  const bad = new WebSocket(`${wsBase}/ws?token=nope`);
  const code = await new Promise((r) => bad.on('close', r));
  assert.equal(code, 4001);

  const wa = socket(a.token), wb = socket(b.token), wc = socket(c.token);
  await Promise.all([wa.opened, wb.opened, wc.opened]);

  wc.json({ t: 'sub', groupId: g.id });
  assert.match((await wc.next((m) => m.t === 'error')).error, /Join/);
  wc.json({ t: 'chat', text: 'hi' });
  assert.match((await wc.next((m) => m.t === 'error')).error, /Open a group/);

  wa.json({ t: 'sub', groupId: g.id });
  await wa.next((m) => m.t === 'snapshot');
  wa.json({ t: 'loc', lat: 18.52, lng: 73.85, speed: 12, heading: 90 });
  wa.json({ t: 'loc', lat: 999, lng: 73.85 });
  await new Promise((r) => setTimeout(r, 100));

  wb.json({ t: 'sub', groupId: g.id });
  const snap = await wb.next((m) => m.t === 'snapshot');
  assert.equal(snap.locations.length, 1, 'late joiner sees last known positions');
  assert.equal(snap.locations[0].lat, 18.52);
  assert.ok(snap.group.members.find((m) => m.id === a.user.id).online);
  assert.equal((await wa.next((m) => m.t === 'presence')).online, true);

  wb.json({ t: 'loc', lat: 18.53, lng: 73.86, speed: 'fast' });
  const loc = await wa.next((m) => m.t === 'loc');
  assert.equal(loc.loc.name, 'WS Rider');
  assert.equal(loc.loc.speed, null);

  wb.json({ t: 'chat', text: '  Fuel stop in 5 km  ' });
  const [ca, cb] = await Promise.all([wa.next((m) => m.t === 'chat' && m.message.type === 'text'), wb.next((m) => m.t === 'chat' && m.message.type === 'text')]);
  assert.equal(ca.message.text, 'Fuel stop in 5 km');
  assert.equal(cb.message.id, ca.message.id, 'sender gets their own message back');

  wa.json({ t: 'voice', mime: 'audio/webm;codecs=opus', data: Buffer.from('fake-opus').toString('base64'), duration: 2.4 });
  const v = await wb.next((m) => m.t === 'voice');
  assert.equal(Buffer.from(v.data, 'base64').toString(), 'fake-opus');
  assert.equal(v.from.name, 'WS Leader');
  await wb.next((m) => m.t === 'chat' && m.message.type === 'voice');
  wa.json({ t: 'voice', data: 'x'.repeat(1_600_000) });
  assert.match((await wa.next((m) => m.t === 'error')).error, /too long/);

  wb.json({ t: 'sos', lat: 18.53, lng: 73.86 });
  const s = await wa.next((m) => m.t === 'sos');
  assert.equal(s.alert.name, 'WS Rider');
  const ws2 = socket(a.token); await ws2.opened;
  ws2.json({ t: 'sub', groupId: g.id });
  assert.equal((await ws2.next((m) => m.t === 'snapshot')).sos.length, 1, 'active SOS shown to anyone who opens the group');
  wb.json({ t: 'sos_cancel' });
  assert.equal((await wa.next((m) => m.t === 'sos_cancel')).userId, b.user.id);

  wa.json({ t: 'what' });
  assert.match((await wa.next((m) => m.t === 'error')).error, /Unknown/);
  wa.send('not json');
  assert.match((await wa.next((m) => m.t === 'error')).error, /Bad/);

  ws2.close();
  wb.close();
  const off = await wa.next((m) => m.t === 'presence' && m.userId === b.user.id && !m.online);
  assert.equal(off.online, false);
  wa.close(); wc.close();
});

test('realtime: rate limit protects the server', async () => {
  const a = await signup('Spammer');
  const g = (await api('POST', '/api/groups', { name: 'Spam' }, a.token)).body.group;
  const w = socket(a.token); await w.opened;
  w.json({ t: 'sub', groupId: g.id });
  await w.next((m) => m.t === 'snapshot');
  for (let i = 0; i < 60; i++) w.json({ t: 'ping', ts: i });
  assert.match((await w.next((m) => m.t === 'error')).error, /Slow down/);
  w.close();
});

test('data survives a restart and corrupt files are set aside', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rylaide-')), 'db.json');
  const s1 = createApp({ dataFile: file });
  await new Promise((r) => s1.server.listen(0, '127.0.0.1', r));
  const p1 = s1.server.address().port;
  const u = await (await fetch(`http://127.0.0.1:${p1}/api/users`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"Persist"}' })).json();
  await s1.close();
  const s2 = createApp({ dataFile: file });
  await new Promise((r) => s2.server.listen(0, '127.0.0.1', r));
  const me = await (await fetch(`http://127.0.0.1:${s2.server.address().port}/api/me`, { headers: { authorization: `Bearer ${u.token}` } })).json();
  assert.equal(me.user.name, 'Persist');
  await s2.close();

  fs.writeFileSync(file, '{broken');
  const s3 = createApp({ dataFile: file });
  assert.equal(s3.store.data.users.length, 0);
  assert.ok(fs.readdirSync(path.dirname(file)).some((f) => f.includes('corrupt')));
  await s3.close();
});

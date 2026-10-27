// Garage (multi-vehicle, service), groups (info, members, expenses, shared, rides, live ride), accounts (sign in, delete), nearby, reverse geocode.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { createApp } = require('../server/app');
const { startMockUpstream } = require('./helpers/mock-upstream');

let up, srv, base;
before(async () => {
  up = await startMockUpstream();
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rylaide-f-')), 'db.json');
  srv = createApp({ dataFile, osrm: up.base, nominatim: up.base, weather: `${up.base}/weather` });
  await new Promise((r) => srv.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.server.address().port}`;
});
after(async () => { await srv.close(); await up.close(); });

async function api(method, p, body, tok) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
const signup = async (name, extra = {}) => (await api('POST', '/api/users', { name, ...extra })).body;
function socket(tok) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${tok}`);
  const inbox = [];
  ws.on('message', (d) => inbox.push(JSON.parse(d)));
  ws.next = async (pred, ms = 3000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const i = inbox.findIndex(pred); if (i >= 0) return inbox.splice(i, 1)[0]; await new Promise((r) => setTimeout(r, 20)); }
    throw new Error('timeout waiting for ws message');
  };
  ws.opened = new Promise((r) => ws.on('open', r));
  return ws;
}

test('garage: several vehicles, active one shown on Home, per-vehicle fuel and service reminders', async () => {
  const a = await signup('Garage', { vehicle: { type: 'classic', make: 'Royal Enfield', model: 'Classic 350', odometer: 31000 } });
  const t = a.token;
  const re = a.user.vehicle;
  assert.ok(re.id);
  assert.equal(a.user.vehicleCount, 1);
  // add a second vehicle; the first stays active
  let g = (await api('POST', '/api/vehicles', { type: 'ev-scooter', make: 'Ather', model: '450X', odometer: 800, year: 2024, reg: 'mh12ab1234', nickname: 'Office' }, t)).body;
  assert.equal(g.vehicles.length, 2);
  assert.equal(g.activeId, re.id);
  const ather = g.vehicle;
  assert.equal(ather.reg, 'MH12AB1234');
  assert.equal((await api('POST', '/api/vehicles', {}, t)).status, 400);
  assert.equal((await api('POST', '/api/vehicles', { make: 'X', year: 1800 }, t)).status, 400);
  // switch active: Home (GET /api/me) follows
  g = (await api('POST', `/api/vehicles/${ather.id}/active`, undefined, t)).body;
  assert.equal(g.activeId, ather.id);
  assert.equal((await api('GET', '/api/me', undefined, t)).body.user.vehicle.model, '450X');
  // edit keeps unspecified fields
  g = (await api('PATCH', `/api/vehicles/${ather.id}`, { nickname: 'Daily' }, t)).body;
  assert.equal(g.vehicle.model, '450X');
  assert.equal(g.vehicle.nickname, 'Daily');
  assert.equal(g.vehicle.reg, 'MH12AB1234');
  // photo per vehicle
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 3)]).toString('base64');
  const ph = (await api('POST', `/api/vehicles/${re.id}/photo`, { data: jpeg }, t)).body;
  assert.ok(ph.vehicle.photo);
  assert.equal(ph.user.vehicle.id, ather.id, 'photo on another bike does not change the active one');
  // fuel per vehicle; odometer follows the fuel log
  await api('POST', '/api/fuel', { vehicleId: re.id, odometer: 31200, litres: 10, pricePerLitre: 105 }, t);
  const f2 = (await api('POST', '/api/fuel', { vehicleId: re.id, odometer: 31500, litres: 9, pricePerLitre: 105 }, t)).body;
  assert.equal(f2.entries.length, 2);
  assert.equal(f2.entries[0].kmpl, 33.3);
  assert.equal((await api('GET', `/api/fuel?vehicle=${ather.id}`, undefined, t)).body.entries.length, 0);
  assert.equal((await api('GET', `/api/fuel?vehicle=${re.id}`, undefined, t)).body.entries.length, 2);
  assert.equal((await api('GET', '/api/vehicles', undefined, t)).body.vehicles.find((v) => v.id === re.id).odometer, 31500);
  // service log + reminders
  assert.equal((await api('POST', `/api/vehicles/${re.id}/service`, { type: 'nope' }, t)).status, 400);
  assert.equal((await api('POST', `/api/vehicles/${re.id}/service`, { type: 'oil', odometer: 31400, nextKm: 31000 }, t)).status, 400, 'next due before now');
  assert.equal((await api('POST', `/api/vehicles/${re.id}/service`, { type: 'oil', odometer: 31400, nextKm: 42001400 }, t)).status, 400, 'typo-sized next due');
  let s = (await api('POST', `/api/vehicles/${re.id}/service`, { type: 'oil', date: '2026-01-10', odometer: 31400, cost: 650, nextKm: 31700 }, t)).body;
  assert.equal(s.reminders[0].state, 'soon');
  assert.match(s.reminders[0].due, /in 200 km/);
  s = (await api('POST', `/api/vehicles/${re.id}/service`, { type: 'insurance', date: '2025-06-01', cost: 2100, nextDate: '2026-01-01' }, t)).body;
  assert.equal(s.reminders[0].state, 'overdue');
  assert.equal(s.reminders[0].type, 'insurance');
  assert.equal(s.stats.spent, 2750);
  s = (await api('DELETE', `/api/vehicles/${re.id}/service/${s.entries.find((e) => e.type === 'insurance').id}`, undefined, t)).body;
  assert.equal(s.entries.length, 1);
  // delete a vehicle: its fuel and service go too, active moves on
  g = (await api('DELETE', `/api/vehicles/${ather.id}`, undefined, t)).body;
  assert.equal(g.vehicles.length, 1);
  assert.equal(g.activeId, re.id);
  assert.equal((await api('GET', `/api/vehicles/${ather.id}/service`, undefined, t)).status, 404);
  // other riders can't touch my vehicles
  const b = await signup('Other');
  assert.equal((await api('PATCH', `/api/vehicles/${re.id}`, { make: 'x' }, b.token)).status, 404);
});

test('old single-bike accounts are moved into the vehicle list', async () => {
  const u = await signup('Legacy');
  const rec = srv.store.data.users.find((x) => x.id === u.user.id);
  delete rec.vehicles; delete rec.activeVehicleId;
  rec.vehicle = { type: 'cruiser', make: 'Bajaj', model: 'Avenger 220', odometer: 5000, photo: null };
  srv.store.data.fuel.push({ id: 'oldfuel1', userId: rec.id, odometer: 5000, litres: 5, pricePerLitre: 100, full: true, date: '2026-01-01' });
  const me = (await api('GET', '/api/me', undefined, u.token)).body.user;
  assert.equal(me.vehicle.model, 'Avenger 220');
  assert.ok(me.vehicle.id);
  assert.equal((await api('GET', '/api/fuel', undefined, u.token)).body.entries.length, 1, 'old fill-ups belong to the first vehicle');
});

test('groups: leader edits, removes members, hands over, deletes; others can’t', async () => {
  const lead = await signup('Leader'), b = await signup('Bea'), c = await signup('Cal');
  const g = (await api('POST', '/api/groups', { name: 'Ghat Gang' }, lead.token)).body.group;
  await api('POST', '/api/groups/join', { code: g.code }, b.token);
  await api('POST', '/api/groups/join', { code: g.code }, c.token);
  assert.equal((await api('PATCH', `/api/groups/${g.id}`, { name: 'Nope' }, b.token)).status, 403);
  const r = (await api('PATCH', `/api/groups/${g.id}`, { name: 'Ghat Gang 2', description: 'Sunday rides' }, lead.token)).body.group;
  assert.equal(r.name, 'Ghat Gang 2');
  assert.equal(r.description, 'Sunday rides');
  // new code invalidates the old one
  const nc = (await api('POST', `/api/groups/${g.id}/code`, undefined, lead.token)).body.group.code;
  assert.notEqual(nc, g.code);
  assert.equal((await api('POST', '/api/groups/join', { code: g.code }, (await signup('Late')).token)).status, 404);
  // remove Cal: Cal is told over the socket
  const wc = socket(c.token); await wc.opened;
  assert.equal((await api('POST', `/api/groups/${g.id}/members/${c.user.id}/remove`, undefined, b.token)).status, 403);
  const rm = (await api('POST', `/api/groups/${g.id}/members/${c.user.id}/remove`, undefined, lead.token)).body.group;
  assert.equal(rm.members.length, 2);
  assert.equal((await wc.next((m) => m.t === 'group_gone')).why, 'removed');
  assert.equal((await api('GET', `/api/groups/${g.id}`, undefined, c.token)).status, 403);
  // hand over leadership
  assert.equal((await api('POST', `/api/groups/${g.id}/leader`, { userId: b.user.id }, lead.token)).body.group.ownerId, b.user.id);
  assert.equal((await api('DELETE', `/api/groups/${g.id}`, undefined, lead.token)).status, 403);
  // delete
  const wl = socket(lead.token); await wl.opened;
  assert.equal((await api('DELETE', `/api/groups/${g.id}`, undefined, b.token)).status, 200);
  assert.equal((await wl.next((m) => m.t === 'group_gone')).why, 'deleted');
  assert.equal((await api('GET', '/api/groups', undefined, lead.token)).body.groups.length, 0);
  wc.close(); wl.close();
});

test('groups: expenses split and settle with fewest payments', async () => {
  const a = await signup('Asha'), b = await signup('Bilal'), c = await signup('Chetan');
  const g = (await api('POST', '/api/groups', { name: 'Split' }, a.token)).body.group;
  await api('POST', '/api/groups/join', { code: g.code }, b.token);
  await api('POST', '/api/groups/join', { code: g.code }, c.token);
  assert.equal((await api('POST', `/api/groups/${g.id}/expenses`, { title: 'Fuel', amount: 0 }, a.token)).status, 400);
  assert.equal((await api('POST', `/api/groups/${g.id}/expenses`, { amount: 10 }, a.token)).status, 400);
  await api('POST', `/api/groups/${g.id}/expenses`, { title: 'Fuel', amount: 900 }, a.token); // split 3 ways
  let e = (await api('POST', `/api/groups/${g.id}/expenses`, { title: 'Chai', amount: 60, split: [b.user.id, c.user.id] }, b.token)).body;
  assert.equal(e.total, 960);
  const bal = Object.fromEntries(e.balances.map((x) => [x.name, x.amount]));
  assert.deepEqual(bal, { Asha: 600, Bilal: -270, Chetan: -330 });
  assert.equal(e.settle.length, 2);
  assert.ok(e.settle.every((s) => s.to === a.user.id));
  // settle up: Chetan pays Asha
  e = (await api('POST', `/api/groups/${g.id}/expenses`, { settlement: true, amount: 330, paidBy: c.user.id, split: [a.user.id] }, c.token)).body;
  assert.equal(e.total, 960, 'settlements are not spending');
  assert.equal(e.balances.find((x) => x.name === 'Chetan').amount, 0);
  // only creator/payer/leader can delete
  const chai = e.expenses.find((x) => x.title === 'Chai');
  assert.equal((await api('DELETE', `/api/groups/${g.id}/expenses/${chai.id}`, undefined, c.token)).status, 403);
  assert.equal((await api('DELETE', `/api/groups/${g.id}/expenses/${chai.id}`, undefined, a.token)).status, 200);
  assert.equal((await api('GET', `/api/groups/${g.id}/expenses`, undefined, (await signup('Out')).token)).status, 403);
});

test('groups: shared places, group rides tab, live ride invites selected riders', async () => {
  const a = await signup('Ana'), b = await signup('Ben'), c = await signup('Cy');
  const g = (await api('POST', '/api/groups', { name: 'Live' }, a.token)).body.group;
  await api('POST', '/api/groups/join', { code: g.code }, b.token);
  await api('POST', '/api/groups/join', { code: g.code }, c.token);
  assert.equal((await api('POST', `/api/groups/${g.id}/shared`, { name: 'Dhaba' }, a.token)).status, 400);
  let s = (await api('POST', `/api/groups/${g.id}/shared`, { name: 'Sharma Dhaba', kind: 'food', lat: 18.4, lng: 73.8, note: 'Best parathas' }, b.token)).body;
  assert.equal(s.shared[0].byName, 'Ben');
  assert.equal((await api('DELETE', `/api/groups/${g.id}/shared/${s.shared[0].id}`, undefined, c.token)).status, 403);
  s = (await api('DELETE', `/api/groups/${g.id}/shared/${s.shared[0].id}`, undefined, a.token)).body;
  assert.equal(s.shared.length, 0);
  // rides recorded with the group show for all members
  const pts = [[18.52, 73.85, 1], [18.53, 73.86, 2]];
  await api('POST', '/api/rides', { points: pts, duration: 600, groupId: g.id, groupName: 'Live' }, b.token);
  await api('POST', '/api/rides', { points: pts, duration: 600 }, b.token); // solo: not shown
  const gr = (await api('GET', `/api/groups/${g.id}/rides`, undefined, a.token)).body.rides;
  assert.equal(gr.length, 1);
  assert.equal(gr[0].riderName, 'Ben');
  assert.equal(gr[0].points, undefined);
  // live ride: only selected riders get the invite
  const wb = socket(b.token), wc = socket(c.token);
  await Promise.all([wb.opened, wc.opened]);
  const live = (await api('POST', `/api/groups/${g.id}/ride`, { riders: [b.user.id, 'stranger'], destination: 'Sinhagad', lat: 18.36, lng: 73.75 }, a.token)).body.group.live;
  assert.deepEqual(live.riders, [a.user.id, b.user.id]);
  assert.equal((await wb.next((m) => m.t === 'ride_live')).live.destination, 'Sinhagad');
  await assert.rejects(wc.next((m) => m.t === 'ride_live', 400));
  assert.equal((await api('GET', `/api/groups/${g.id}`, undefined, c.token)).body.group.live.byName, 'Ana');
  await api('DELETE', `/api/groups/${g.id}/ride`, undefined, b.token); // not the starter: ignored
  assert.ok((await api('GET', `/api/groups/${g.id}`, undefined, a.token)).body.group.live);
  await api('DELETE', `/api/groups/${g.id}/ride`, undefined, a.token);
  assert.equal((await api('GET', `/api/groups/${g.id}`, undefined, a.token)).body.group.live, null);
  wb.close(); wc.close();
});

test('accounts: sign in on a new phone with the account code; new code; delete account', async () => {
  const a = await signup('Phone One', { agreed: true });
  const acc = (await api('GET', '/api/me/account', undefined, a.token)).body;
  assert.match(acc.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.ok(acc.termsAt);
  assert.equal(a.user.signinCode, undefined, 'the code is never in the public profile');
  const s = (await api('POST', '/api/signin', { code: acc.code.toLowerCase().replace('-', ' ') })).body;
  assert.equal(s.user.id, a.user.id);
  assert.equal(s.token, a.token);
  assert.equal((await api('POST', '/api/signin', { code: 'AAAA-AAAA' })).status, 404);
  const fresh = (await api('POST', '/api/me/account/code', undefined, a.token)).body.code;
  assert.notEqual(fresh, acc.code);
  assert.equal((await api('POST', '/api/signin', { code: acc.code })).status, 404, 'old code stops working');
  // delete: needs DELETE typed; leaves groups (leader passes on)
  const b = await signup('Stays');
  const g = (await api('POST', '/api/groups', { name: 'Left behind' }, a.token)).body.group;
  await api('POST', '/api/groups/join', { code: g.code }, b.token);
  await api('POST', '/api/rides', { points: [[18.52, 73.85, 1], [18.53, 73.86, 2]], duration: 60 }, a.token);
  assert.equal((await api('DELETE', '/api/me', { confirm: 'no' }, a.token)).status, 400);
  assert.equal((await api('DELETE', '/api/me', { confirm: 'delete' }, a.token)).status, 200);
  assert.equal((await api('GET', '/api/me', undefined, a.token)).status, 401);
  assert.equal((await api('POST', '/api/signin', { code: fresh })).status, 404);
  const g2 = (await api('GET', `/api/groups/${g.id}`, undefined, b.token)).body.group;
  assert.equal(g2.ownerId, b.user.id);
  assert.equal(g2.members.length, 1);
  assert.ok(!srv.store.data.rides.some((r) => r.userId === a.user.id));
});

test('sign-in attempts are limited', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await api('POST', '/api/signin', { code: `ZZZZ-ZZZ${i % 9 + 1}` });
  assert.equal(last.status, 429);
});

test('nearby: riders close by see each other and make a group without a code', async () => {
  const a = await signup('Near A'), b = await signup('Near B'), far = await signup('Far');
  assert.equal((await api('POST', '/api/nearby', {}, a.token)).status, 400);
  await api('POST', '/api/nearby', { lat: 18.5204, lng: 73.8567 }, b.token);
  await api('POST', '/api/nearby', { lat: 18.62, lng: 73.95 }, far.token);
  const seen = (await api('POST', '/api/nearby', { lat: 18.5210, lng: 73.8570 }, a.token)).body;
  assert.deepEqual(seen.riders.map((r) => r.name), ['Near B']);
  assert.ok(seen.riders[0].distance > 0 && seen.riders[0].distance <= 100);
  const wb = socket(b.token); await wb.opened;
  assert.equal((await api('POST', '/api/nearby/group', { riders: [far.user.id] }, a.token)).status, 400);
  const g = (await api('POST', '/api/nearby/group', { riders: [b.user.id, far.user.id], name: 'Petrol pump crew' }, a.token)).body.group;
  assert.equal(g.members.length, 2);
  assert.equal((await wb.next((m) => m.t === 'group_added')).group.name, 'Petrol pump crew');
  await api('DELETE', '/api/nearby', undefined, b.token);
  assert.equal((await api('POST', '/api/nearby', { lat: 18.5210, lng: 73.8570 }, a.token)).body.riders.length, 0);
  wb.close();
});

test('drop a pin: reverse geocode with a fallback name', async () => {
  const a = await signup('Pin');
  const r = (await api('GET', '/api/reverse?lat=18.36&lng=73.75', undefined, a.token)).body;
  assert.match(r.name, /Sinhagad Ghat Road/);
  assert.equal((await api('GET', '/api/reverse?lat=x', undefined, a.token)).status, 400);
});

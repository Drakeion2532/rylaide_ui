// Postgres persistence (free hosting): runs only when TEST_DATABASE_URL points at an empty test database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server/app');

const URL = process.env.TEST_DATABASE_URL;
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rylaide-db-')), 'db.json');

async function boot(opts) {
  const s = createApp({ databaseUrl: URL, ...opts });
  await s.ready;
  await new Promise((r) => s.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.server.address().port}`;
  const api = async (method, p, body, tok) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { s, base, api };
}

test('database: data and photos survive a restart with a wiped disk', { skip: !URL && 'set TEST_DATABASE_URL' }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: URL });
  await pool.query('drop table if exists rylaide_state, rylaide_photos');

  const a = await boot({ dataFile: tmp() });
  assert.equal((await (await fetch(`${a.base}/healthz`)).json()).storage, 'database');
  const u = (await a.api('POST', '/api/users', { name: 'Cloud', vehicle: { type: 'cruiser', make: 'Royal Enfield', model: 'Meteor 350' } })).body;
  const g = (await a.api('POST', '/api/groups', { name: 'Free Riders' }, u.token)).body.group;
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 9)]);
  const pid = (await a.api('POST', '/api/me/photo', { data: jpeg.toString('base64') }, u.token)).body.user.vehicle.photo;
  // a burst of changes is coalesced, and the last one wins
  for (let i = 0; i < 5; i++) a.api('PATCH', '/api/me', { name: `Cloud ${i}` }, u.token);
  await new Promise((r) => setTimeout(r, 100));
  await a.api('PATCH', '/api/me', { name: 'Cloud final' }, u.token);
  await a.s.close();

  // new server, new empty disk: everything comes from the database
  const b = await boot({ dataFile: tmp() });
  const me = (await b.api('GET', '/api/me', undefined, u.token)).body.user;
  assert.equal(me.name, 'Cloud final');
  assert.equal(me.vehicle.photo, pid);
  assert.equal(me.vehicle.type, 'cruiser');
  assert.equal((await b.api('GET', '/api/groups', undefined, u.token)).body.groups[0].code, g.code);
  const img = await fetch(`${b.base}/photos/${pid}.jpg`);
  assert.equal(img.status, 200);
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), jpeg);
  assert.equal((await fetch(`${b.base}/photos/AAAAAAAAAAAA.jpg`)).status, 404);
  await b.api('DELETE', '/api/me/photo', undefined, u.token);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await pool.query('select count(*)::int as n from rylaide_photos')).rows[0].n, 0);
  await b.s.close();
  await pool.end();
});

test('database unreachable: server refuses to start instead of starting empty', { skip: !URL && 'set TEST_DATABASE_URL' }, async () => {
  const s = createApp({ databaseUrl: 'postgres://nobody:wrong@127.0.0.1:1/none', dataFile: tmp() });
  await assert.rejects(s.ready);
  await s.close();
});

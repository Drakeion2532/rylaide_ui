// Screens from the Figma navigation map that need the server:
//   Garage   12 My vehicles · 11 Vehicle · 11e Add · 11f Edit · 11j Service
//   Groups   39 Group info · 41 Members · 39c Expenses · G14 Settings · G01 Rides / Shared tabs · group ride (17 Select riders)
//   Account  05 Sign in (account code) · 44 Account · delete account
//   Ride     16 Nearby · 22e Drop a pin (reverse geocode)
module.exports = function features(app, x) {
  const { db, store, cfg, auth, memberGroup, groupView, publicUser, vehiclesOf, activeVehicle, cleanVehicle, VEHICLE_ERROR,
    setVehiclePhoto, clearVehiclePhoto, photos, clean, num, fail, id, code, newSigninCode, LIMITS,
    upstream, broadcast, systemMessage, toUser, dropFromGroup, deleteGroup, haversine } = x;
  const groupOf = (gid) => db.groups.find((g) => g.id === gid);
  const userOf = (uid) => db.users.find((u) => u.id === uid);
  const nameOf = (uid) => userOf(uid)?.name || 'Former rider';
  const leaderOnly = (req, res, next) => (req.group.ownerId === req.user.id ? next() : fail(res, 403, 'Only the group leader can do that.'));

  // ================================================================ garage
  const myVehicle = (req, res, next) => {
    const v = vehiclesOf(req.user).find((y) => y.id === req.params.vid);
    if (!v) return fail(res, 404, 'Vehicle not found.');
    req.vehicle = v;
    next();
  };
  const garage = (u) => ({ vehicles: vehiclesOf(u), activeId: activeVehicle(u)?.id || null, user: publicUser(u) });

  app.get('/api/vehicles', auth, (req, res) => res.json(garage(req.user)));
  app.post('/api/vehicles', auth, (req, res) => {
    const vs = vehiclesOf(req.user);
    if (vs.length >= 10) return fail(res, 409, 'You can keep up to 10 vehicles.');
    const v = cleanVehicle(req.body || {});
    if (!v) return fail(res, 400, VEHICLE_ERROR);
    if (!v.make && !v.model && !v.type) return fail(res, 400, 'Add at least the make, model or type.');
    vs.push(v);
    if (!req.user.activeVehicleId || req.body?.makeActive) req.user.activeVehicleId = v.id;
    store.save();
    res.status(201).json({ ...garage(req.user), vehicle: v });
  });
  app.patch('/api/vehicles/:vid', auth, myVehicle, (req, res) => {
    const vs = vehiclesOf(req.user);
    const v = cleanVehicle(req.body || {}, req.vehicle);
    if (!v) return fail(res, 400, VEHICLE_ERROR);
    vs[vs.indexOf(req.vehicle)] = v;
    store.save();
    res.json({ ...garage(req.user), vehicle: v });
  });
  app.delete('/api/vehicles/:vid', auth, myVehicle, (req, res) => {
    const vs = vehiclesOf(req.user);
    if (req.vehicle.photo) photos.del(req.vehicle.photo);
    vs.splice(vs.indexOf(req.vehicle), 1);
    db.service = db.service.filter((s) => s.vehicleId !== req.vehicle.id);
    db.fuel = db.fuel.filter((f) => !(f.userId === req.user.id && f.vehicleId === req.vehicle.id));
    if (req.user.activeVehicleId === req.vehicle.id) req.user.activeVehicleId = vs[0]?.id || null;
    store.save();
    res.json(garage(req.user));
  });
  app.post('/api/vehicles/:vid/active', auth, myVehicle, (req, res) => {
    req.user.activeVehicleId = req.vehicle.id;
    store.save();
    res.json(garage(req.user));
  });
  app.post('/api/vehicles/:vid/photo', auth, myVehicle, (req, res) => setVehiclePhoto(req, res, req.vehicle));
  app.delete('/api/vehicles/:vid/photo', auth, myVehicle, (req, res) => clearVehiclePhoto(req, res, req.vehicle));

  // ---- 11j Service log with reminders (km and date based)
  const SERVICE_TYPES = {
    service: 'General service', oil: 'Engine oil', chain: 'Chain clean & lube', tyres: 'Tyres', brakes: 'Brake pads',
    battery: 'Battery', insurance: 'Insurance', puc: 'PUC certificate', other: 'Other',
  };
  function serviceView(u, v) {
    const entries = db.service.filter((s) => s.userId === u.id && s.vehicleId === v.id).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
    const seen = new Set(), reminders = [];
    for (const s of entries) {
      if (seen.has(s.type)) continue; // only the latest entry of each type sets the next due point
      seen.add(s.type);
      let state = null, dueText = [];
      if (s.nextKm && v.odometer != null) {
        const left = s.nextKm - v.odometer;
        if (left <= 0) state = 'overdue'; else if (left <= 300) state = state || 'soon';
        dueText.push(left <= 0 ? `${Math.abs(left).toLocaleString('en-IN')} km overdue` : `in ${left.toLocaleString('en-IN')} km`);
      } else if (s.nextKm) dueText.push(`at ${s.nextKm.toLocaleString('en-IN')} km`);
      if (s.nextDate) {
        if (s.nextDate < today) state = 'overdue'; else if (s.nextDate <= soon && state !== 'overdue') state = 'soon';
        dueText.push(`${s.nextDate < today ? 'was due' : 'due'} ${s.nextDate}`);
      }
      if (s.nextKm || s.nextDate) reminders.push({ type: s.type, label: SERVICE_TYPES[s.type], state: state || 'ok', due: dueText.join(' · '), nextKm: s.nextKm, nextDate: s.nextDate });
    }
    const order = { overdue: 0, soon: 1, ok: 2 };
    reminders.sort((a, b) => order[a.state] - order[b.state]);
    return {
      vehicle: v, types: SERVICE_TYPES, entries, reminders,
      stats: { count: entries.length, spent: +entries.reduce((t, s) => t + (s.cost || 0), 0).toFixed(2) },
    };
  }
  app.get('/api/vehicles/:vid/service', auth, myVehicle, (req, res) => res.json(serviceView(req.user, req.vehicle)));
  app.post('/api/vehicles/:vid/service', auth, myVehicle, (req, res) => {
    const b = req.body || {};
    if (!SERVICE_TYPES[b.type]) return fail(res, 400, 'Pick what was done.');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : new Date().toISOString().slice(0, 10);
    const odo = num(b.odometer), cost = num(b.cost), nextKm = num(b.nextKm);
    if ((b.odometer !== undefined && b.odometer !== '' && !(odo >= 0)) || (b.cost !== undefined && b.cost !== '' && !(cost >= 0))) return fail(res, 400, 'Odometer and cost must be numbers.');
    if (b.nextKm && !(nextKm > 0 && nextKm < 10_000_000)) return fail(res, 400, 'Next service km must be a number.');
    const odoNow = Number.isFinite(odo) ? odo : req.vehicle.odometer;
    if (b.nextKm && odoNow != null && nextKm <= odoNow) return fail(res, 400, 'Next due km should be more than the odometer reading.');
    if (b.nextKm && odoNow != null && nextKm - odoNow > 100_000) return fail(res, 400, 'Next due km looks too far ahead. Check the number.');
    const nextDate = /^\d{4}-\d{2}-\d{2}$/.test(b.nextDate) ? b.nextDate : null;
    const s = {
      id: id(), userId: req.user.id, vehicleId: req.vehicle.id, type: b.type, date,
      odometer: Number.isFinite(odo) ? Math.round(odo) : null, cost: Number.isFinite(cost) ? +cost.toFixed(2) : null,
      note: clean(b.note, 200) || null, nextKm: Number.isFinite(nextKm) && nextKm > 0 ? Math.round(nextKm) : null, nextDate, createdAt: Date.now(),
    };
    db.service.push(s);
    if (s.odometer && s.odometer > (req.vehicle.odometer || 0)) req.vehicle.odometer = s.odometer;
    store.save();
    res.status(201).json({ ...serviceView(req.user, req.vehicle), user: publicUser(req.user) });
  });
  app.delete('/api/vehicles/:vid/service/:sid', auth, myVehicle, (req, res) => {
    const i = db.service.findIndex((s) => s.id === req.params.sid && s.userId === req.user.id && s.vehicleId === req.vehicle.id);
    if (i < 0) return fail(res, 404, 'Entry not found.');
    db.service.splice(i, 1);
    store.save();
    res.json(serviceView(req.user, req.vehicle));
  });

  // ================================================================ groups
  app.patch('/api/groups/:id', auth, memberGroup, leaderOnly, (req, res) => {
    const g = req.group;
    if (req.body?.name !== undefined) {
      const name = clean(req.body.name, LIMITS.name);
      if (!name) return fail(res, 400, 'Give the group a name.');
      if (name !== g.name) systemMessage(g, `${req.user.name} renamed the group to ${name}`);
      g.name = name;
    }
    if (req.body?.description !== undefined) g.description = clean(req.body.description, 200);
    store.save();
    broadcast(g.id, { t: 'members', group: groupView(g) });
    res.json({ group: groupView(g) });
  });
  app.delete('/api/groups/:id', auth, memberGroup, leaderOnly, (req, res) => {
    const g = req.group;
    for (const m of g.members) if (m !== req.user.id) toUser(m, { t: 'group_gone', groupId: g.id, name: g.name, why: 'deleted' });
    deleteGroup(g);
    store.save();
    res.json({ ok: true });
  });
  // New code: old invite links and QR codes stop working (G14).
  app.post('/api/groups/:id/code', auth, memberGroup, leaderOnly, (req, res) => {
    let c;
    do c = code(); while (db.groups.some((g) => g.code === c));
    req.group.code = c;
    store.save();
    broadcast(req.group.id, { t: 'members', group: groupView(req.group) });
    res.json({ group: groupView(req.group) });
  });
  app.post('/api/groups/:id/members/:uid/remove', auth, memberGroup, leaderOnly, (req, res) => {
    const g = req.group, who = userOf(req.params.uid);
    if (!who || !g.members.includes(who.id)) return fail(res, 404, 'That rider isn’t in this group.');
    if (who.id === req.user.id) return fail(res, 400, 'Use Leave group to leave.');
    dropFromGroup(g, who, 'removed');
    toUser(who.id, { t: 'group_gone', groupId: g.id, name: g.name, why: 'removed' });
    res.json({ group: groupView(g) });
  });
  app.post('/api/groups/:id/leader', auth, memberGroup, leaderOnly, (req, res) => {
    const g = req.group, uid = req.body?.userId;
    if (!g.members.includes(uid)) return fail(res, 404, 'That rider isn’t in this group.');
    g.ownerId = uid;
    systemMessage(g, `${nameOf(uid)} is now the group leader`);
    store.save();
    broadcast(g.id, { t: 'members', group: groupView(g) });
    res.json({ group: groupView(g) });
  });

  // ---- G01 Rides tab: rides members recorded with this group
  app.get('/api/groups/:id/rides', auth, memberGroup, (req, res) => {
    const rides = db.rides.filter((r) => r.groupId === req.group.id).sort((a, b) => b.startedAt - a.startedAt).slice(0, 50)
      .map(({ points, ...r }) => ({ ...r, riderName: nameOf(r.userId), mine: r.userId === req.user.id }));
    res.json({ rides });
  });

  // ---- 17 Select riders → live group ride (others get "Asha started a ride · Join")
  app.post('/api/groups/:id/ride', auth, memberGroup, (req, res) => {
    const g = req.group, b = req.body || {};
    const riders = [...new Set([req.user.id, ...(Array.isArray(b.riders) ? b.riders : [])])].filter((u) => g.members.includes(u));
    const lat = num(b.lat), lng = num(b.lng);
    g.live = {
      by: req.user.id, byName: req.user.name, riders, startedAt: Date.now(),
      destination: clean(b.destination, 120) || null, lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null,
    };
    const others = riders.filter((u) => u !== req.user.id).map(nameOf);
    systemMessage(g, `${req.user.name} started a ride${g.live.destination ? ` to ${g.live.destination}` : ''}${others.length ? ` with ${others.join(', ')}` : ''}`);
    store.save();
    broadcast(g.id, { t: 'members', group: groupView(g) });
    for (const u of riders) if (u !== req.user.id) toUser(u, { t: 'ride_live', groupId: g.id, groupName: g.name, live: g.live });
    res.json({ group: groupView(g) });
  });
  app.delete('/api/groups/:id/ride', auth, memberGroup, (req, res) => {
    const g = req.group;
    if (g.live && (g.live.by === req.user.id || g.ownerId === req.user.id)) {
      g.live = null;
      store.save();
      broadcast(g.id, { t: 'members', group: groupView(g) });
    }
    res.json({ group: groupView(g) });
  });

  // ---- 39c Expenses: split fuel, food and tolls; who owes whom
  function expensesView(g) {
    const list = db.expenses.filter((e) => e.groupId === g.id).sort((a, b) => b.ts - a.ts);
    const bal = new Map();
    const add = (u, v) => bal.set(u, (bal.get(u) || 0) + v);
    for (const e of list) {
      const share = e.amount / e.split.length;
      add(e.paidBy, e.amount);
      for (const u of e.split) add(u, -share);
    }
    for (const m of g.members) if (!bal.has(m)) bal.set(m, 0);
    const balances = [...bal].map(([userId, amount]) => ({ userId, name: nameOf(userId), amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount);
    // Fewest payments: biggest debtor pays biggest creditor, repeat.
    const cred = balances.filter((b) => b.amount > 0.009).map((b) => ({ ...b })), debt = balances.filter((b) => b.amount < -0.009).map((b) => ({ ...b, amount: -b.amount }));
    const settle = [];
    while (cred.length && debt.length) {
      const c = cred[0], d = debt[0], amt = Math.min(c.amount, d.amount);
      settle.push({ from: d.userId, fromName: d.name, to: c.userId, toName: c.name, amount: Math.round(amt * 100) / 100 });
      c.amount -= amt; d.amount -= amt;
      if (c.amount < 0.01) cred.shift();
      if (d.amount < 0.01) debt.shift();
    }
    const total = +list.filter((e) => !e.settlement).reduce((t, e) => t + e.amount, 0).toFixed(2);
    return { expenses: list.map((e) => ({ ...e, paidByName: nameOf(e.paidBy) })), balances, settle, total };
  }
  app.get('/api/groups/:id/expenses', auth, memberGroup, (req, res) => res.json(expensesView(req.group)));
  app.post('/api/groups/:id/expenses', auth, memberGroup, (req, res) => {
    const g = req.group, b = req.body || {};
    const amount = num(b.amount);
    const title = clean(b.title, 60);
    if (!title && !b.settlement) return fail(res, 400, 'Say what it was for, like Fuel or Lunch.');
    if (!(amount > 0 && amount < 10_000_000)) return fail(res, 400, 'Enter the amount.');
    const paidBy = g.members.includes(b.paidBy) ? b.paidBy : req.user.id;
    const split = (Array.isArray(b.split) ? [...new Set(b.split)] : g.members).filter((u) => g.members.includes(u));
    if (!split.length) return fail(res, 400, 'Pick who it’s split between.');
    if (db.expenses.filter((e) => e.groupId === g.id).length >= 500) return fail(res, 409, 'This group has too many expenses. Delete some old ones.');
    const e = { id: id(), groupId: g.id, title: title || 'Settled up', amount: Math.round(amount * 100) / 100, paidBy, split, settlement: !!b.settlement, createdBy: req.user.id, ts: Date.now() };
    db.expenses.push(e);
    store.save();
    if (!e.settlement) systemMessage(g, `${nameOf(paidBy)} paid ₹${e.amount.toLocaleString('en-IN')} for ${e.title}`);
    broadcast(g.id, { t: 'expenses', groupId: g.id });
    res.status(201).json(expensesView(g));
  });
  app.delete('/api/groups/:id/expenses/:eid', auth, memberGroup, (req, res) => {
    const i = db.expenses.findIndex((e) => e.id === req.params.eid && e.groupId === req.group.id);
    if (i < 0) return fail(res, 404, 'Expense not found.');
    const e = db.expenses[i];
    if (e.createdBy !== req.user.id && e.paidBy !== req.user.id && req.group.ownerId !== req.user.id) return fail(res, 403, 'Only who added it or the leader can delete it.');
    db.expenses.splice(i, 1);
    store.save();
    broadcast(req.group.id, { t: 'expenses', groupId: req.group.id });
    res.json(expensesView(req.group));
  });

  // ---- G01 Shared tab: places the group keeps (meet points, fuel stops, dhabas, viewpoints)
  const sharedView = (g) => ({ shared: db.shared.filter((s) => s.groupId === g.id).sort((a, b) => b.ts - a.ts) });
  app.get('/api/groups/:id/shared', auth, memberGroup, (req, res) => res.json(sharedView(req.group)));
  app.post('/api/groups/:id/shared', auth, memberGroup, (req, res) => {
    const g = req.group, b = req.body || {};
    const lat = num(b.lat), lng = num(b.lng);
    const name = clean(b.name, 80);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return fail(res, 400, 'Give the place a name and a location.');
    const KINDS = ['meet', 'fuel', 'food', 'view', 'stay', 'repair', 'other'];
    const s = { id: id(), groupId: g.id, kind: KINDS.includes(b.kind) ? b.kind : 'other', name, note: clean(b.note, 200) || null, lat, lng, by: req.user.id, byName: req.user.name, ts: Date.now() };
    db.shared.push(s);
    const mine = db.shared.filter((x) => x.groupId === g.id);
    if (mine.length > 100) db.shared.splice(db.shared.indexOf(mine.sort((a2, b2) => a2.ts - b2.ts)[0]), 1);
    store.save();
    systemMessage(g, `${req.user.name} shared a place: ${name}`);
    broadcast(g.id, { t: 'shared', groupId: g.id });
    res.status(201).json(sharedView(g));
  });
  app.delete('/api/groups/:id/shared/:sid', auth, memberGroup, (req, res) => {
    const i = db.shared.findIndex((s) => s.id === req.params.sid && s.groupId === req.group.id);
    if (i < 0) return fail(res, 404, 'Place not found.');
    if (db.shared[i].by !== req.user.id && req.group.ownerId !== req.user.id) return fail(res, 403, 'Only who shared it or the leader can remove it.');
    db.shared.splice(i, 1);
    store.save();
    broadcast(req.group.id, { t: 'shared', groupId: req.group.id });
    res.json(sharedView(req.group));
  });

  // ================================================================ accounts
  // 44 Account: the code to sign in on another phone.
  app.get('/api/me/account', auth, (req, res) => {
    if (!req.user.signinCode) { req.user.signinCode = newSigninCode(); store.save(); }
    res.json({ code: req.user.signinCode, createdAt: req.user.createdAt, termsAt: req.user.termsAt || null });
  });
  app.post('/api/me/account/code', auth, (req, res) => {
    req.user.signinCode = newSigninCode();
    store.save();
    res.json({ code: req.user.signinCode });
  });
  app.post('/api/me/terms', auth, (req, res) => { req.user.termsAt = Date.now(); store.save(); res.json({ ok: true }); });

  // 05 Sign in. Limited per address so codes can't be guessed.
  const tries = new Map();
  app.post('/api/signin', (req, res) => {
    const ip = req.ip || 'x', now = Date.now();
    const t = tries.get(ip) || { n: 0, at: now };
    if (now - t.at > 10 * 60e3) { t.n = 0; t.at = now; }
    if (t.n >= 10) return fail(res, 429, 'Too many tries. Wait 10 minutes and try again.');
    t.n++; tries.set(ip, t);
    if (tries.size > 5000) tries.delete(tries.keys().next().value);
    const c = clean(req.body?.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})/, '$1-');
    const u = c.length === 9 && db.users.find((x) => x.signinCode === c);
    if (!u) return fail(res, 404, 'That code doesn’t match an account. Check it in Settings → Account on your old phone.');
    t.n = Math.max(0, t.n - 1);
    res.json({ user: publicUser(u), token: u.token });
  });

  // Delete account: leaves groups, removes rides, fuel, service, photos and contacts.
  app.delete('/api/me', auth, (req, res) => {
    const u = req.user;
    if (clean(req.body?.confirm, 20).toUpperCase() !== 'DELETE') return fail(res, 400, 'Type DELETE to confirm.');
    for (const g of db.groups.filter((gr) => gr.members.includes(u.id))) dropFromGroup(g, u, 'left');
    for (const v of vehiclesOf(u)) if (v.photo) photos.del(v.photo);
    db.rides = db.rides.filter((r) => r.userId !== u.id);
    db.fuel = db.fuel.filter((f) => f.userId !== u.id);
    db.service = db.service.filter((s) => s.userId !== u.id);
    delete db.contacts[u.id];
    db.users.splice(db.users.indexOf(u), 1);
    nearby.delete(u.id);
    store.save();
    res.json({ ok: true });
  });

  // ================================================================ 16 Nearby
  // Riders who have the Nearby screen open within 500 m see each other and can form a group without codes.
  const nearby = new Map(); // userId -> { lat, lng, ts }
  const NEAR_M = 500, NEAR_TTL = 60e3;
  const nearList = (u, here) => [...nearby].filter(([uid, p]) => uid !== u.id && Date.now() - p.ts < NEAR_TTL && userOf(uid))
    .map(([uid, p]) => ({ id: uid, name: nameOf(uid), color: userOf(uid).color, distance: Math.round(haversine([here.lat, here.lng], [p.lat, p.lng]) / 10) * 10 }))
    .filter((r) => r.distance <= NEAR_M).sort((a, b) => a.distance - b.distance);
  app.post('/api/nearby', auth, (req, res) => {
    const lat = num(req.body?.lat), lng = num(req.body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return fail(res, 400, 'Nearby needs your location.');
    nearby.set(req.user.id, { lat, lng, ts: Date.now() });
    for (const [uid, p] of nearby) if (Date.now() - p.ts > NEAR_TTL) nearby.delete(uid);
    res.json({ riders: nearList(req.user, { lat, lng }), radius: NEAR_M });
  });
  app.delete('/api/nearby', auth, (req, res) => { nearby.delete(req.user.id); res.json({ ok: true }); });
  app.post('/api/nearby/group', auth, (req, res) => {
    const me = nearby.get(req.user.id);
    if (!me) return fail(res, 400, 'Open Nearby first.');
    const near = new Set(nearList(req.user, me).map((r) => r.id));
    const picked = (Array.isArray(req.body?.riders) ? req.body.riders : []).filter((u) => near.has(u));
    if (!picked.length) return fail(res, 400, 'Pick at least one rider who’s still nearby.');
    const name = clean(req.body?.name, LIMITS.name) || `${req.user.name}’s ride`;
    let c;
    do c = code(); while (db.groups.some((g) => g.code === c));
    const g = { id: id(), code: c, name, ownerId: req.user.id, members: [req.user.id, ...picked].slice(0, LIMITS.membersPerGroup), plan: null, createdAt: Date.now() };
    db.groups.push(g);
    store.save();
    systemMessage(g, `${req.user.name} made this group with riders nearby`);
    for (const u of picked) toUser(u, { t: 'group_added', group: groupView(g), by: req.user.name });
    res.status(201).json({ group: groupView(g) });
  });

  // ================================================================ 22e Drop a pin
  app.get('/api/reverse', auth, async (req, res) => {
    const lat = num(req.query.lat), lng = num(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail(res, 400, 'Pick a point on the map.');
    try {
      const j = await upstream(`${cfg.nominatim}/reverse?format=jsonv2&zoom=16&lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}`, 24 * 3600e3);
      res.json({ name: j?.display_name || `Dropped pin, ${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng });
    } catch {
      res.json({ name: `Dropped pin, ${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng, offline: true });
    }
  });
};

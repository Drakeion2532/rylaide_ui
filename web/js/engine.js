// Ride engine: location, live group, recording, navigation, voice, SOS. Screens listen through state.on().
import { store, haversine, distToLine, fmtDist, vibrate, native } from './util.js';
import { api } from './api.js';
import { ctx, rt, emit, setting } from './state.js';
import { PushToTalk, VoicePlayer } from './voice.js';
import { setThemePosition } from './theme.js';

// ---------------------------------------------------------------- groups
export async function loadGroups() {
  ctx.groups = (await api.get('/api/groups')).groups;
  const want = store.get('groupId');
  openGroup(ctx.groups.find((g) => g.id === want) || ctx.groups[0] || null);
  emit('groups', ctx.groups);
}

export function openGroup(g) {
  const changed = ctx.group?.id !== g?.id;
  ctx.group = g;
  store.set('groupId', g?.id || null);
  if (changed) {
    ctx.locs.clear(); ctx.sos.clear(); ctx.messages = []; ctx.unread = 0;
    rt.subscribe(g?.id || null);
    if (g) loadMessages(g.id);
  }
  emit('group', g);
}

export async function createGroup(name) {
  const { group } = await api.post('/api/groups', { name });
  ctx.groups.push(group);
  openGroup(group);
  emit('groups', ctx.groups);
  return group;
}

export async function joinGroup(code) {
  const { group } = await api.post('/api/groups/join', { code });
  if (!ctx.groups.some((g) => g.id === group.id)) ctx.groups.push(group);
  openGroup(group);
  emit('groups', ctx.groups);
  return group;
}

export async function leaveGroup(g) {
  await api.post(`/api/groups/${g.id}/leave`);
  ctx.groups = ctx.groups.filter((x) => x.id !== g.id);
  if (ctx.group?.id === g.id) openGroup(ctx.groups[0] || null);
  emit('groups', ctx.groups);
}

async function loadMessages(gid) {
  try {
    const { messages } = await api.get(`/api/groups/${gid}/messages`);
    if (ctx.group?.id !== gid) return;
    ctx.messages = messages;
    emit('messages', ctx.messages);
  } catch { /* shown when chat opens */ }
}

export const onlineRiders = () => (ctx.group ? ctx.group.members.filter((m) => m.online || m.id === ctx.user?.id) : []);

// ---------------------------------------------------------------- realtime
export function wireRealtime() {
  rt.on('status', (s) => {
    ctx.conn = s === 'online' ? 'internet' : s === 'connecting' ? (ctx.connEver ? 'reconnecting' : 'connecting') : (ctx.connEver ? 'reconnecting' : 'disconnected');
    if (s === 'online') { if (ctx.connLost) emit('banner', { tone: 'ok', icon: 'check_circle', title: 'Everyone’s back', sub: `${onlineRiders().length} riders connected`, ms: 3000 }); ctx.connEver = true; ctx.connLost = false; }
    if (s === 'offline' && ctx.connEver && !ctx.connLost) { ctx.connLost = true; emit('banner', { tone: 'bad', icon: 'link_off', title: 'Connection lost', sub: 'Trying to reconnect… Navigation still works', sticky: true }); }
    emit('conn', ctx.conn);
  });
  rt.on('snapshot', (m) => {
    if (m.group.id !== ctx.group?.id) return;
    Object.assign(ctx.group, m.group);
    m.locations.forEach(onLoc);
    m.sos.forEach(onSos);
    if (ctx.pos) sendLoc(true);
    emit('group', ctx.group);
  });
  rt.on('members', (m) => {
    if (m.group.id !== ctx.group?.id) return;
    for (const old of ctx.group.members) if (!m.group.members.some((x) => x.id === old.id)) { ctx.locs.delete(old.id); emit('rider-left', old.id); }
    Object.assign(ctx.group, m.group);
    emit('group', ctx.group);
  });
  rt.on('presence', (m) => {
    const mem = ctx.group?.members.find((x) => x.id === m.userId);
    if (!mem) return;
    mem.online = m.online;
    if (!m.online && ctx.ride) emit('banner', { tone: 'warn', icon: 'person_off', title: `${mem.name.split(' ')[0]} disconnected`, sub: 'Trying to reconnect…', ms: 5000 });
    emit('group', ctx.group);
  });
  rt.on('loc', (m) => onLoc(m.loc));
  rt.on('chat', (m) => {
    if (m.message.groupId !== ctx.group?.id) return;
    if (ctx.messages.some((x) => x.id === m.message.id)) return;
    ctx.messages.push(m.message);
    if (ctx.messages.length > 300) ctx.messages.shift();
    if (!ctx.chatOpen && m.message.type === 'text' && m.message.userId !== ctx.user.id) ctx.unread++;
    emit('chat', m.message);
  });
  rt.on('typing', (m) => emit('typing', m));
  rt.on('voice', (m) => { if (ctx.voiceOn) player.enqueue(m); });
  rt.on('sos', (m) => onSos(m.alert));
  rt.on('sos_cancel', (m) => { ctx.sos.delete(m.userId); emit('sos-cancel', m.userId); });
  rt.on('error', (m) => emit('snack', m.error));
}

function onLoc(loc) {
  if (loc.userId === ctx.user?.id) return;
  ctx.locs.set(loc.userId, loc);
  const mem = ctx.group?.members.find((x) => x.id === loc.userId);
  if (mem && (mem.name !== loc.name || mem.color !== loc.color)) { Object.assign(mem, { name: loc.name, color: loc.color }); emit('group', ctx.group); }
  emit('loc', loc);
}

function onSos(a) {
  ctx.sos.set(a.userId, a);
  if (a.userId !== ctx.user?.id) vibrate([400, 150, 400, 150, 800]);
  emit('sos', a);
}

// ---------------------------------------------------------------- location
let watchId = null;
export function startLocation() {
  if (!navigator.geolocation) { ctx.gps = 'unsupported'; emit('gps', ctx.gps); return; }
  if (watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(onPosition, (e) => {
    ctx.gps = e.code === 1 ? 'denied' : 'searching';
    emit('gps', ctx.gps);
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}

function onPosition(p) {
  const c = p.coords;
  const prev = ctx.pos;
  const pos = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, speed: c.speed, heading: c.heading, ts: p.timestamp || Date.now() };
  if (!Number.isFinite(pos.speed) && prev) {
    const dt = (pos.ts - prev.ts) / 1000;
    if (dt > 0.5) pos.speed = haversine([prev.lat, prev.lng], [pos.lat, pos.lng]) / dt;
  }
  // A GPS jump (tunnel, indoors) can imply impossible speeds; don't show or record them.
  if (Number.isFinite(pos.speed) && pos.speed > 70) pos.speed = Number.isFinite(prev?.speed) && prev.speed <= 70 ? prev.speed : null;
  if (!Number.isFinite(pos.heading) && prev && haversine([prev.lat, prev.lng], [pos.lat, pos.lng]) > 4) {
    const y = Math.sin((pos.lng - prev.lng) * Math.PI / 180) * Math.cos(pos.lat * Math.PI / 180);
    const x = Math.cos(prev.lat * Math.PI / 180) * Math.sin(pos.lat * Math.PI / 180) - Math.sin(prev.lat * Math.PI / 180) * Math.cos(pos.lat * Math.PI / 180) * Math.cos((pos.lng - prev.lng) * Math.PI / 180);
    pos.heading = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  const first = !prev;
  const wasWeak = ctx.gps === 'weak';
  ctx.pos = pos;
  ctx.gps = pos.acc > 60 ? 'weak' : 'ok';
  if (first) { setThemePosition(pos.lat, pos.lng); loadWeather(); }
  if (wasWeak && ctx.gps === 'ok' && ctx.ride) emit('banner', { tone: 'ok', icon: 'my_location', title: 'GPS is back', sub: 'You’re on route', ms: 3000 });
  emit('pos', pos);
  emit('gps', ctx.gps);
  sendLoc(false);
  updateRide(pos);
  updateNav(pos);
}

let lastSent = null, trailing = null;
export function sendLoc(force) {
  if (!ctx.pos || !ctx.group || !setting('share', true) || ctx.ride?.solo) return; // solo rides stay private
  const now = Date.now();
  const moved = lastSent ? haversine([lastSent.lat, lastSent.lng], [ctx.pos.lat, ctx.pos.lng]) : Infinity;
  if (!force && lastSent && moved < 10 && now - lastSent.at < 15000) return;
  if (!force && lastSent && now - lastSent.at < 2000) {
    if (!trailing) trailing = setTimeout(() => { trailing = null; sendLoc(false); }, 2000 - (now - lastSent.at));
    return;
  }
  clearTimeout(trailing); trailing = null;
  if (rt.send({ t: 'loc', lat: ctx.pos.lat, lng: ctx.pos.lng, speed: ctx.pos.speed, heading: ctx.pos.heading })) lastSent = { lat: ctx.pos.lat, lng: ctx.pos.lng, at: now };
}

export async function loadWeather() {
  if (!ctx.pos || (ctx.weatherAt && Date.now() - ctx.weatherAt < 30 * 60e3)) return;
  ctx.weatherAt = Date.now();
  try {
    ctx.weather = await api.get(`/api/weather?lat=${ctx.pos.lat}&lng=${ctx.pos.lng}`);
    emit('weather', ctx.weather);
  } catch { ctx.weatherAt = Date.now() - 25 * 60e3; }
}
setInterval(loadWeather, 5 * 60e3);

// ---------------------------------------------------------------- ride
/** Begin a ride from the setup flow (or a quick ride with no destination). */
export function startRide({ dest = null, route = null, solo = !ctx.group } = {}) {
  ctx.ride = {
    startedAt: Date.now(), points: ctx.pos ? [[ctx.pos.lat, ctx.pos.lng, Date.now()]] : [], dist: 0, maxSpeed: 0,
    dest, route, k: route ? Math.min(1, route.steps.length - 1) : 0, spoken: {}, off: 0, lastReroute: 0,
    solo, groupName: solo ? null : ctx.group?.name || null, origin: ctx.originName || null,
  };
  store.set('activeRide', { startedAt: ctx.ride.startedAt });
  requestWakeLock();
  if (route) speak(`Starting navigation to ${short(dest.name)}. ${route.steps[ctx.ride.k]?.instruction || ''}`);
  emit('ride', ctx.ride);
}

function updateRide(pos) {
  const r = ctx.ride;
  if (!r) return;
  if (Number.isFinite(pos.speed)) r.maxSpeed = Math.max(r.maxSpeed, pos.speed);
  if (pos.acc <= 50) {
    const last = r.points[r.points.length - 1];
    const d = last ? haversine(last, [pos.lat, pos.lng]) : Infinity;
    if (d >= 5) {
      if (last) r.dist += d;
      r.points.push([pos.lat, pos.lng, Date.now()]);
      emit('track', r.points);
    }
  }
  emit('ride-tick', r);
}

/** End and save. Returns the saved ride summary (or a local one if offline). */
export async function endRide() {
  const r = ctx.ride;
  if (!r) return null;
  ctx.ride = null;
  store.del('activeRide');
  releaseWakeLock();
  emit('ride', null);
  const duration = (Date.now() - r.startedAt) / 1000;
  const payload = {
    points: r.points, duration, maxSpeed: r.maxSpeed, startedAt: r.startedAt,
    destination: r.dest ? short(r.dest.name) : null, origin: r.origin, groupName: r.groupName,
  };
  if (r.points.length < 2 || r.dist < 50) return { tooShort: true, duration, distance: Math.round(r.dist) };
  try {
    const { ride } = await api.post('/api/rides', payload);
    return { ...ride, points: r.points };
  } catch {
    const unsent = store.get('unsentRides', []);
    unsent.push(payload);
    store.set('unsentRides', unsent.slice(-5));
    return { ...payload, distance: Math.round(r.dist), avgSpeed: duration ? r.dist / duration : 0, offline: true };
  }
}

export async function flushUnsentRides() {
  const unsent = store.get('unsentRides', []);
  if (!unsent.length) return;
  const left = [];
  for (const r of unsent) { try { await api.post('/api/rides', r); } catch { left.push(r); } }
  store.set('unsentRides', left);
  if (left.length < unsent.length) emit('snack', 'Saved your earlier ride');
}
window.addEventListener('online', flushUnsentRides);

// ---------------------------------------------------------------- navigation
export const short = (name = '') => name.split(',')[0].trim();

export function speak(text) {
  if (!setting('speak', true)) return;
  const A = native();
  if (A) { try { A.speak(text); } catch { /* ignore */ } return; } // Android WebView has no speechSynthesis
  if (!window.speechSynthesis) return;
  try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch { /* ignore */ }
}

export async function fetchRoute(dest, from) {
  const f = from || (ctx.pos ? [ctx.pos.lng, ctx.pos.lat] : null);
  if (!f) throw new Error('Waiting for your location. Step outside for a better GPS signal.');
  return api.get(`/api/route?from=${f[0]},${f[1]}&to=${dest.lng},${dest.lat}`);
}

function updateNav(pos) {
  const r = ctx.ride;
  if (!r?.route) return;
  const steps = r.route.steps;
  const toDest = haversine([pos.lat, pos.lng], [r.dest.lat, r.dest.lng]);
  if (toDest < 35 && !r.arrived) {
    r.arrived = true;
    speak('You have arrived.');
    emit('arrived', r.dest);
    return emit('nav', navState());
  }
  const off = distToLine([pos.lat, pos.lng], r.route.geometry.coordinates);
  r.off = off > 70 ? r.off + 1 : 0;
  if (r.off >= 2 && Date.now() - r.lastReroute > 20000) {
    r.lastReroute = Date.now();
    speak('Rerouting');
    fetchRoute(r.dest).then((route) => {
      if (ctx.ride !== r) return;
      r.route = route; r.k = Math.min(1, route.steps.length - 1); r.spoken = {}; r.off = 0;
      emit('route', route);
    }).catch(() => {});
  }
  let step = steps[r.k];
  let d = haversine([pos.lat, pos.lng], [step.location[1], step.location[0]]);
  while (d < 25 && r.k < steps.length - 1) {
    r.k++;
    step = steps[r.k];
    d = haversine([pos.lat, pos.lng], [step.location[1], step.location[0]]);
  }
  for (const [mark, say] of [[600, `In ${fmtDist(500)}, `], [150, '']]) {
    const key = `${r.k}:${mark}`;
    if (d <= mark && !r.spoken[key]) { r.spoken[key] = true; speak(`${say}${step.instruction}`); break; }
  }
  r.toNext = d;
  emit('nav', navState());
}

/** What the maneuver card and ETA panel show right now. */
export function navState() {
  const r = ctx.ride;
  if (!r?.route) return null;
  const steps = r.route.steps;
  const step = steps[r.k] || steps[steps.length - 1];
  const d = r.toNext ?? step.distance;
  const rest = steps.slice(r.k + 1).reduce((s, x) => s + x.distance, 0) + d;
  const secs = steps.slice(r.k + 1).reduce((s, x) => s + x.duration, 0) + (step.distance ? (d / step.distance) * step.duration : 0);
  return { step, toNext: d, remaining: rest, secs: secs || r.route.duration, arrived: !!r.arrived, dest: r.dest };
}

let wakeLock = null;
async function requestWakeLock() { try { native()?.keepAwake(true); wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* unsupported */ } }
function releaseWakeLock() { try { native()?.keepAwake(false); } catch { /* ignore */ } wakeLock?.release().catch(() => {}); wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx.ride) requestWakeLock(); });

// ---------------------------------------------------------------- voice
export const ptt = new PushToTalk();
export const player = new VoicePlayer({
  onStart: (m) => { ctx.speaking = m.from.id; emit('speaking', m.from); },
  onEnd: () => { ctx.speaking = null; emit('speaking', null); },
  onBlocked: (resume) => emit('snack', { text: 'New voice message', action: { label: 'Play', run: () => { player.unlock(); resume(); } }, ms: 10000 }),
});

export async function talkStart() {
  if (!ctx.group) throw new Error('Join a group to talk to your riders.');
  if (rt.status !== 'online') throw new Error('You’re offline. Talk works again when you reconnect.');
  player.unlock();
  await ptt.start({ noiseSuppression: ctx.noiseCancel });
  emit('talking', true);
}
export async function talkStop() {
  emit('talking', false);
  if (!ptt.active) return 'idle';
  const clip = await ptt.stop();
  if (!clip) return 'short';
  if (!rt.send({ t: 'voice', ...clip })) return 'offline';
  return 'sent';
}

// ---------------------------------------------------------------- SOS
export function sendSos() {
  const p = ctx.pos;
  ctx.mySos = true;
  return !!ctx.group && rt.send({ t: 'sos', lat: p?.lat, lng: p?.lng });
}
export function cancelSos() {
  if (ctx.mySos) rt.send({ t: 'sos_cancel' });
  ctx.mySos = false;
}

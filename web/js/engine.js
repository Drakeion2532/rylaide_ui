// Ride engine: location, live group, recording, navigation, voice, SOS. Screens listen through state.on().
import { store, haversine, distToLine, fmtDist, vibrate, native } from './util.js';
import { api } from './api.js';
import { ctx, rt, emit, setting, setSetting } from './state.js';
import { PushToTalk, VoicePlayer } from './voice.js';
import { LiveMic, LivePlayer, RVP, fnv32 } from './livevoice.js';
import { setThemePosition } from './theme.js';

// ---------------------------------------------------------------- groups
export async function loadGroups() {
  // Kept on the phone too, so a group ride (and offline voice with nearby riders) can start with no signal.
  try { ctx.groups = (await api.get('/api/groups')).groups; store.set('groupsCache', ctx.groups); }
  catch (e) { const cached = store.get('groupsCache', null); if (!cached || e.status === 401) throw e; ctx.groups = cached; }
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
    live.reset();
    if (ctx.ride) syncVoice();
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
    nativeVoice()?.voiceConfig(JSON.stringify({ online: s === 'online' }));
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
  rt.on('voice', (m) => { if (ctx.voiceOn) player.enqueue(m); }); // older apps: whole clip after release
  rt.on('vchunk', (m) => { if (ctx.voiceOn) player.chunk(m); });  // streamed while the rider talks
  rt.on('vcancel', (m) => player.cancel(m.sid));
  rt.on('voice-packet', onVoicePacket);                             // live voice
  rt.on('sos', (m) => onSos(m.alert));
  rt.on('sos_cancel', (m) => { ctx.sos.delete(m.userId); emit('sos-cancel', m.userId); });
  rt.on('error', (m) => emit('snack', m.error));
  // Removed by the leader, or the group was deleted.
  rt.on('group_gone', (m) => {
    ctx.groups = ctx.groups.filter((g) => g.id !== m.groupId);
    if (ctx.group?.id === m.groupId) openGroup(ctx.groups[0] || null);
    emit('groups', ctx.groups);
    emit('group-gone', m);
    emit('snack', m.why === 'removed' ? `You were removed from ${m.name}` : `${m.name} was deleted by its leader`);
  });
  // Made a group with you from Nearby.
  rt.on('group_added', (m) => {
    if (!ctx.groups.some((g) => g.id === m.group.id)) ctx.groups.push(m.group);
    openGroup(m.group);
    emit('groups', ctx.groups);
    emit('snack', `${m.by} added you to ${m.group.name}`);
  });
  // A rider started a group ride and picked you (17 Select riders).
  rt.on('ride_live', (m) => emit('ride-live', m));
  rt.on('expenses', (m) => emit('group-data', { kind: 'expenses', groupId: m.groupId }));
  rt.on('shared', (m) => emit('group-data', { kind: 'shared', groupId: m.groupId }));
}

/** Refresh one group's details (members, live ride) from the server. */
export async function refreshGroup(gid) {
  const { group } = await api.get(`/api/groups/${gid}`);
  const i = ctx.groups.findIndex((g) => g.id === gid);
  if (i >= 0) ctx.groups[i] = group;
  if (ctx.group?.id === gid) { Object.assign(ctx.group, group); emit('group', ctx.group); }
  emit('groups', ctx.groups);
  return group;
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
export function startRide({ dest = null, route = null, solo = !ctx.group, pillion = false, riders = null, quick = false } = {}) {
  ctx.ride = {
    startedAt: Date.now(), points: ctx.pos ? [[ctx.pos.lat, ctx.pos.lng, Date.now()]] : [], dist: 0, maxSpeed: 0,
    dest, route, k: route ? Math.min(1, route.steps.length - 1) : 0, spoken: {}, off: 0, lastReroute: 0,
    solo, groupName: solo ? null : ctx.group?.name || null, groupId: solo ? null : ctx.group?.id || null, origin: ctx.originName || null,
    pillion: !!pillion, quick, vehicleId: ctx.user?.vehicle?.id || null, nextBreak: Date.now() + setting('breakMins', 45) * 60e3,
  };
  store.set('activeRide', { startedAt: ctx.ride.startedAt });
  requestWakeLock();
  crash.start();
  syncVoice();
  // Group ride: tell the riders picked in 17 Select riders (they get "… started a ride · Join").
  if (!solo && ctx.group) {
    api.post(`/api/groups/${ctx.group.id}/ride`, { riders: riders || onlineRiders().map((m) => m.id), destination: dest ? short(dest.name) : null, lat: dest?.lat, lng: dest?.lng }).catch(() => {});
  }
  if (route) speak(`Starting navigation to ${short(dest.name)}. ${route.steps[ctx.ride.k]?.instruction || ''}`);
  emit('ride', ctx.ride);
}

/** 25q refills: a fill-up during the ride goes into the bike's fuel log; the odometer is estimated from the ride. */
export async function logRefill({ litres, pricePerLitre, full = true }) {
  const r = ctx.ride;
  const v = ctx.user?.vehicle;
  const odometer = (v?.odometer || 0) + (r ? r.dist / 1000 : 0) + 0.1;
  const d = await api.post('/api/fuel', { vehicleId: v?.id, odometer: +odometer.toFixed(1), litres, pricePerLitre, full, estimated: true });
  if (d.user) { ctx.user = d.user; store.set('user', d.user); emit('user', d.user); }
  if (r) { (r.refills ||= []).push({ litres: +litres, cost: +(litres * pricePerLitre).toFixed(2), at: Date.now() }); emit('refill', r); }
  return d;
}

/** 32 Arrived → Keep riding: stop directions, keep recording. */
export function keepRiding() {
  const r = ctx.ride;
  if (!r) return;
  r.route = null; r.keptRiding = true;
  emit('nav', null); emit('ride', r);
}

// ---------------------------------------------------------------- 25u pillion: break reminders
setInterval(() => {
  const r = ctx.ride;
  if (!r || !(r.pillion || setting('breaks', false)) || Date.now() < r.nextBreak) return;
  r.nextBreak = Date.now() + setting('breakMins', 45) * 60e3;
  speak(r.pillion ? 'Time for a short break. Check on your pillion.' : 'Time for a short break.', 'alert');
  vibrate([200, 100, 200]);
  emit('banner', { tone: 'warn', icon: 'free_breakfast', title: 'Time for a break', sub: r.pillion ? 'Stop safely, stretch and check on your pillion' : 'Stop safely and stretch for a few minutes', ms: 15000 });
  emit('break', r);
}, 15000);
export function snoozeBreak(mins) { if (ctx.ride) { ctx.ride.nextBreak = Date.now() + mins * 60e3; emit('break', ctx.ride); } }

// ---------------------------------------------------------------- 30a crash detection
// A hard impact (over ~3.5 g) while moving, followed by the bike staying still, opens a countdown.
// If the rider doesn't cancel it, SOS goes to the group and the emergency contacts screen opens.
export const crash = {
  on: false, armed: true, lastSpeed: 0,
  start() {
    if (this.on || !setting('crash', true)) return;
    this.on = true;
    this.handler = (e) => {
      const a = e.accelerationIncludingGravity || e.acceleration;
      if (!a || !ctx.ride) return;
      const g = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2) / 9.81;
      if (g > 3.5 && this.armed && (ctx.pos?.speed ?? 0) * 3.6 >= 15) this.suspect(g);
    };
    window.addEventListener('devicemotion', this.handler);
  },
  stop() { if (this.handler) window.removeEventListener('devicemotion', this.handler); this.on = false; this.handler = null; },
  suspect(g, { test = false } = {}) {
    this.armed = false;
    const before = Math.round((ctx.pos?.speed || 0) * 3.6);
    // Wait a few seconds: a real crash leaves the bike stopped; a pothole doesn't.
    setTimeout(() => {
      const still = test || !ctx.pos || !Number.isFinite(ctx.pos.speed) || ctx.pos.speed < 1.5;
      if (still && (ctx.ride || test)) emit('crash', { g: +g.toFixed(1), before, test, at: Date.now() });
      setTimeout(() => (this.armed = true), 60e3);
    }, test ? 0 : 6000);
  },
};

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
  crash.stop();
  syncVoice();
  if (r.groupId) api.del(`/api/groups/${r.groupId}/ride`).catch(() => {});
  emit('ride', null);
  const duration = (Date.now() - r.startedAt) / 1000;
  const payload = {
    points: r.points, duration, maxSpeed: r.maxSpeed, startedAt: r.startedAt,
    destination: r.dest ? short(r.dest.name) : null, origin: r.origin, groupName: r.groupName,
    groupId: r.groupId, vehicleId: r.vehicleId, pillion: r.pillion, quick: !!r.quick, refills: r.refills || [],
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

/**
 * Voice guidance, like Google Maps: 'on' (directions + alerts), 'alerts' (only safety alerts, no turn-by-turn), 'off'.
 * kind: 'nav' for directions, 'alert' for arrival, rerouting, breaks, crash and SOS.
 */
export const voiceGuide = () => setting('voiceGuide', setting('speak', true) ? 'on' : 'off');
export function setVoiceGuide(mode) {
  setSetting('voiceGuide', mode); setSetting('speak', mode !== 'off');
  if (mode === 'off') { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } }
  emit('voice-guide', mode);
}
export function speak(text, kind = 'nav', { force } = {}) {
  const mode = voiceGuide();
  if (!force && (mode === 'off' || (mode === 'alerts' && kind !== 'alert'))) return;
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
    speak('You have arrived.', 'alert');
    emit('arrived', r.dest);
    return emit('nav', navState());
  }
  const off = distToLine([pos.lat, pos.lng], r.route.geometry.coordinates);
  r.off = off > 70 ? r.off + 1 : 0;
  if (r.off >= 2 && Date.now() - r.lastReroute > 20000) {
    r.lastReroute = Date.now();
    speak('Rerouting', 'alert');
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
// Live group voice: the mic is open for the whole group ride and you just talk. One tap mutes or unmutes,
// and that choice is remembered. Nothing is held or pressed while riding.
// In the Android app the phone's own voice engine runs it (works with the screen off and offline between
// nearby riders); in a browser the web engine below does, over the internet.
export const ptt = new PushToTalk();           // holds the processed mic chain; also sends clips where Opus can't be encoded
export const player = new VoicePlayer({        // plays clips from those older senders
  onStart: () => {}, onEnd: () => {},
  onBlocked: (resume) => emit('snack', { text: 'Tap to hear your group', action: { label: 'Play', run: () => { player.unlock(); live.unlock(); resume(); } }, ms: 10000 }),
});
export const live = new LivePlayer({
  onSpeakers: (set) => setSpeakers([...set]),
  onBlocked: (resume) => emit('snack', { text: 'Tap to hear your group', action: { label: 'Play', run: () => { resume(); player.unlock(); } }, ms: 10000 }),
});
ctx.speakers = new Set();
ctx.micMuted = store.get('micMuted', false);
ctx.mesh = { peers: 0 };
let mic = null, micStarting = null;

const nativeVoice = () => { const n = native(); try { return n && typeof n.voiceStart === 'function' && n.voiceSupported() ? n : null; } catch { return null; } };
const memberByHash = (hash) => ctx.group?.members.find((m) => fnv32(m.id) === hash) || null;
function setSpeakers(hashes) {
  ctx.speakers = new Set(hashes.map((x) => memberByHash(x)?.id).filter(Boolean));
  ctx.speaking = [...ctx.speakers][0] || null;
  emit('speaking', ctx.speaking ? ctx.group.members.find((m) => m.id === ctx.speaking) : null);
}
export const isSpeaking = (uid) => (uid === ctx.user?.id ? !!ctx.talking : ctx.speakers.has(uid));

/** 'off' (solo / no group / voice chat off) · 'muted' · 'starting' · 'live' · 'error' */
export function micState() {
  if (!ctx.ride || ctx.ride.solo || !ctx.group) return 'off';
  if (!ctx.voiceOn) return 'off';
  if (ctx.micMuted) return 'muted';
  return ctx.micState || 'starting';
}
function setMicState(s, error) { ctx.micState = s; ctx.micError = error || null; emit('mic', micState()); }

const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); };
const unb64 = (str) => { const bin = atob(str); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };

/** Start or stop voice to match the ride, the group, Voice chat and Mute. Safe to call any time. */
export function syncVoice() {
  const want = !!(ctx.ride && !ctx.ride.solo && ctx.group && ctx.voiceOn);
  const nv = nativeVoice();
  if (nv) {
    if (want) {
      nv.voiceStart(JSON.stringify({
        userId: ctx.user.id, groupId: ctx.group.id, groupName: ctx.group.name, online: rt.status === 'online',
        muted: ctx.micMuted, noiseCancel: ctx.noiseCancel, sensitivity: setting('voiceSensitivity', 'normal'),
      }));
      if (!ctx.micMuted && !ctx.micState) setMicState('starting');
    } else { nv.voiceStop(); ctx.micState = null; emit('mic', micState()); }
    return;
  }
  if (want && !ctx.micMuted) startMic();
  else stopMic();
  emit('mic', micState());
}
/** Older name kept for screens. */
export const voiceReady = () => syncVoice();

async function startMic() {
  const gid = ctx.group.id;
  if (mic && mic.groupId === gid) return;
  if (mic) stopMic();
  if (micStarting) return;
  setMicState('starting');
  micStarting = (async () => {
    const m = new LiveMic({
      chain: ptt.chain, sender: fnv32(ctx.user.id), group: fnv32(gid), sensitivity: setting('voiceSensitivity', 'normal'),
      onPacket: (bytes) => rt.sendBinary(bytes),
      onTalking: (on) => { ctx.talking = on; emit('talking', on); },
      onSpurt: (edge) => clipFallback(m, edge),
    });
    m.groupId = gid;
    ptt.keepWarm = true;
    try {
      await m.start({ noiseCancel: ctx.noiseCancel });
      // Muted, ended or switched group while the mic was starting.
      if (!ctx.ride || ctx.micMuted || !ctx.voiceOn || ctx.group?.id !== gid) { m.stop(); return; }
      mic = m;
      setMicState('live');
    } catch (e) {
      m.stop();
      setMicState('error', e.message);
      emit('snack', e.message);
    }
  })().finally(() => { micStarting = null; });
}

/** Where WebCodecs can't encode Opus (older Safari): each spoken sentence goes as a streamed clip. */
async function clipFallback(m, edge) {
  if (m.opus) return;
  try {
    if (edge === 'start') await ptt.start({ noiseSuppression: ctx.noiseCancel, onChunk: (c) => rt.send({ t: 'vchunk', ...c }) });
    else if (ptt.active) {
      const r = await ptt.stop();
      if (r?.short) rt.send({ t: 'vcancel', sid: r.sid });
      else if (r) rt.send({ t: 'vchunk', sid: r.sid, seq: -1, end: true, live: true, duration: r.duration });
    }
  } catch { /* mic busy */ }
}

function stopMic() {
  mic?.stop();
  mic = null;
  if (ptt.active) ptt.cancel();
  ptt.keepWarm = false;
  ptt.chain.close();
  if (ctx.talking) { ctx.talking = false; emit('talking', false); }
  ctx.micState = null;
}

/** The one control riders need: tap to mute, tap again to talk. Remembered between rides. */
export function setMicMuted(muted) {
  ctx.micMuted = !!muted;
  store.set('micMuted', ctx.micMuted);
  const nv = nativeVoice();
  if (nv) { nv.voiceMute(ctx.micMuted); if (ctx.micMuted) { ctx.talking = false; emit('talking', false); } emit('mic', micState()); }
  else syncVoice();
  live.unlock(); player.unlock();
  vibrate(ctx.micMuted ? [40] : [20, 40, 20]);
}
export function setVoiceOn(on) {
  ctx.voiceOn = !!on;
  store.set('voiceOn', ctx.voiceOn);
  if (!on) live.reset();
  syncVoice();
}
export function setNoiseCancel(on) {
  ctx.noiseCancel = !!on;
  store.set('noiseCancel', ctx.noiseCancel);
  ptt.chain.setNoiseCancel(ctx.noiseCancel);
  nativeVoice()?.voiceConfig(JSON.stringify({ noiseCancel: ctx.noiseCancel }));
}
export function setVoiceSensitivity(level) {
  setSetting('voiceSensitivity', level);
  mic?.setSensitivity(level);
  nativeVoice()?.voiceConfig(JSON.stringify({ sensitivity: level }));
}
/** Live voice stats for the voice check in Settings (and tests). */
export const voiceStats = () => ({ mic: mic ? { ...mic.stats, opus: mic.opus, talking: !!ctx.talking } : null, player: { ...live.stats }, mesh: ctx.mesh });

function onVoicePacket(bytes) {
  if (!ctx.voiceOn) return;
  const nv = nativeVoice();
  if (nv) { nv.voiceIn(b64(bytes)); return; } // the app plays it and forwards it to nearby riders who are offline
  live.packet(RVP.parse(bytes));
}

// The Android app's voice engine calls these.
window.__rylaideVoice = {
  /** A packet to send to the server (the rider's own voice, or a nearby offline rider's, as a gateway). */
  out(str) { rt.sendBinary(unb64(str)); },
  /** {talking, speakers:[hash], peers, mic:'live'|'muted'|'error', error} */
  state(json) {
    let s; try { s = JSON.parse(json); } catch { return; }
    if (s.talking !== undefined && s.talking !== ctx.talking) { ctx.talking = !!s.talking; emit('talking', ctx.talking); }
    if (s.speakers) setSpeakers(s.speakers);
    if (s.peers !== undefined && s.peers !== ctx.mesh.peers) { ctx.mesh = { peers: s.peers }; emit('mesh', ctx.mesh); emit('conn', ctx.conn); }
    if (typeof s.muted === 'boolean' && s.muted !== ctx.micMuted) { ctx.micMuted = s.muted; store.set('micMuted', s.muted); } // Mute from the notification
    if (s.meshError !== undefined) ctx.meshError = s.meshError;
    if (s.mic) setMicState(s.mic, s.error);
  },
};

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

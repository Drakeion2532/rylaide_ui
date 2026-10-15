import { $, $$, h, toast, vibrate, store, fmtDist, fmtDur, fmtEta, fmtKm, fmtTime, initials, haversine, distToLine } from './util.js';
import { api, Realtime } from './api.js';
import { RideMap } from './map.js';
import { PushToTalk, VoicePlayer, MicTest, listMics } from './voice.js';
import { renderChecklist, renderFuel, renderRides, initTools } from './tools.js';

const ACCENTS = ['#2FC9C3', '#F98924', '#8B7CF6', '#4CC38A', '#5AA9FF', '#EC6AA8'];
const RIDER_COLORS = ['#F98924', '#2FC9C3', '#E5484D', '#8B7CF6', '#F5C542', '#4CC38A', '#EC6AA8', '#5AA9FF'];
const STALE_MS = 2 * 60 * 1000;

export const ctx = {
  user: null,
  groups: [],
  group: null,
  members: new Map(),
  locs: new Map(),
  sos: new Map(),
  pos: null,
  ride: null,
  nav: null,
  contacts: [],
  settings: {
    theme: store.get('theme', 'system'), accent: store.get('accent', ACCENTS[0]), glove: store.get('glove', false),
    speak: store.get('speak', true), share: store.get('share', true),
  },
  unread: 0,
  openSheet: null,
};
const rt = new Realtime();
const ptt = new PushToTalk();
let map;
const player = new VoicePlayer({
  onStart: (m) => { $('#btn-ptt').classList.add('hearing'); $('#ptt-label').textContent = m.from.name.split(' ')[0]; ctx.hearingToast = toast(`${m.from.name} is talking`, { ms: Math.max(2000, m.duration * 1000) }); },
  onEnd: () => { $('#btn-ptt').classList.remove('hearing'); $('#ptt-label').textContent = 'Hold to talk'; },
  onBlocked: (resume) => toast('New voice message', { ms: 10000, action: { label: 'Play', run: () => { player.unlock(); resume(); } } }),
});
export const micTest = new MicTest({
  onLevel: (l) => { $('#mic-meter').style.width = `${Math.round(l * 100)}%`; },
  onStatus: (s) => { $('#mic-status').textContent = s; },
});

// ---------------------------------------------------------------- theme
function isDark() {
  const t = ctx.settings.theme;
  return t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}
function applyAppearance() {
  const root = document.documentElement;
  if (ctx.settings.theme === 'system') delete root.dataset.theme; else root.dataset.theme = ctx.settings.theme;
  root.style.setProperty('--accent', ctx.settings.accent);
  root.style.setProperty('--accent-ink', ['#2FC9C3', '#F98924', '#4CC38A', '#5AA9FF'].includes(ctx.settings.accent) ? '#0E1A1A' : '#FFFFFF');
  root.classList.toggle('glove', !!ctx.settings.glove);
  document.querySelector('meta[name=theme-color]').content = isDark() ? '#1A222C' : '#EEF2F4';
  map?.setTheme(isDark());
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);

// ---------------------------------------------------------------- sheets
export function openSheet(name) {
  if (ctx.openSheet === name) return;
  closeSheet(true);
  $$('.tab').forEach((t) => t.setAttribute('aria-current', t.dataset.sheet === (name || '') ? 'page' : 'false'));
  if (!name) return;
  const el = $(`#sheet-${name}`);
  ctx.openSheet = name;
  el.hidden = false;
  el.classList.add('enter');
  $('#scrim').hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('enter')));
  if (name === 'chat') { ctx.unread = 0; updateBadge(); scrollChat(); }
  if (name === 'group') renderGroup();
  if (name === 'tools') initTools.onOpen?.();
  if (name === 'you') renderYou();
}
export function closeSheet(silent) {
  const name = ctx.openSheet;
  if (!name) return;
  const el = $(`#sheet-${name}`);
  ctx.openSheet = null;
  $('#scrim').hidden = true;
  el.classList.add('enter');
  setTimeout(() => { if (ctx.openSheet !== name) el.hidden = true; }, 380);
  if (name === 'tools') micTest.stop();
  if (!silent) $$('.tab').forEach((t) => t.setAttribute('aria-current', t.dataset.sheet === '' ? 'page' : 'false'));
}

// ---------------------------------------------------------------- boot
async function boot() {
  applyAppearance();
  const splashMin = new Promise((r) => setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1500));
  const joinCode = new URLSearchParams(location.search).get('join');
  if (joinCode) store.set('pendingJoin', joinCode);

  let signedIn = false;
  if (api.token) {
    try { ctx.user = (await api.get('/api/me')).user; signedIn = true; } catch (e) { if (e.status !== 401 && e.status !== 0) toast(e.message, { error: true }); if (e.status === 0) signedIn = !!store.get('user'); ctx.user = ctx.user || store.get('user'); }
  }
  await splashMin;
  $('#splash').classList.add('done');
  if (signedIn) await startApp(); else showOnboarding();
  if ('serviceWorker' in navigator && location.hostname !== '127.0.0.1') navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function showOnboarding() {
  $('#onboard').hidden = false;
  $('#app').hidden = true;
  const chips = $$('#ob-bike .chip');
  chips.forEach((c) => c.addEventListener('click', () => chips.forEach((x) => x.setAttribute('aria-checked', String(x === c)))));
  $('#ob-name').focus();
  $('#onboard-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('#onboard-form button[type=submit]');
    btn.disabled = true;
    $('#ob-error').textContent = '';
    try {
      const bike = $('#ob-bike [aria-checked=true]').dataset.v;
      const r = await api.post('/api/users', { name: $('#ob-name').value, bike });
      api.setToken(r.token);
      ctx.user = r.user;
      $('#onboard').hidden = true;
      await startApp();
    } catch (err) {
      $('#ob-error').textContent = err.message;
    } finally { btn.disabled = false; }
  };
}

let started = false;
async function startApp() {
  store.set('user', ctx.user);
  $('#app').hidden = false;
  if (started) return;
  started = true;
  map = new RideMap($('#map'), { onBanner: (t) => showBanner(t, 9000) });
  $('#map').addEventListener('follow', (e) => $('#btn-locate').classList.toggle('active', e.detail));
  map.init(isDark());
  wireUi();
  initTools(ctx, { map, startNavigation, setPlanFromPlace, fetchRoute });
  rt.connect();
  startLocation();
  await loadGroups();
  const pending = store.get('pendingJoin');
  if (pending) {
    store.del('pendingJoin');
    history.replaceState(null, '', '/');
    await joinGroup(pending);
  }
  api.get('/api/contacts').then((r) => (ctx.contacts = r.contacts)).catch(() => {});
  setInterval(() => map.markStale(STALE_MS), 15000);
}

window.addEventListener('rylaide:signedout', () => {
  if (!api.token) return;
  api.setToken(null);
  store.del('user');
  toast('Your session ended. Sign in again to keep riding.', { error: true });
  setTimeout(() => location.reload(), 1500);
});

// ---------------------------------------------------------------- groups
async function loadGroups() {
  try {
    ctx.groups = (await api.get('/api/groups')).groups;
  } catch (e) { toast(e.message, { error: true }); return; }
  const want = store.get('groupId');
  setGroup(ctx.groups.find((g) => g.id === want) || ctx.groups[0] || null);
}

function setGroup(g, { fresh = true } = {}) {
  const changed = ctx.group?.id !== g?.id;
  ctx.group = g;
  store.set('groupId', g?.id || null);
  if (g) g.members.forEach((m) => ctx.members.set(m.id, m));
  if (changed && fresh) {
    ctx.locs.clear(); ctx.sos.clear(); map?.clearRiders(); hideAlert();
    $('#chat-list').replaceChildren();
    rt.subscribe(g?.id || null);
    if (g) loadMessages();
    if (g?.plan) map?.setDestination(g.plan.lng, g.plan.lat); else map?.setDestination(null);
  }
  renderPill();
  $('#btn-ptt').classList.toggle('disabled', !g);
  $('#chat-title').textContent = g ? g.name : 'Chat';
  if (ctx.openSheet === 'group') renderGroup();
  renderChatEmpty();
}

async function createGroup(name) {
  const r = await api.post('/api/groups', { name });
  ctx.groups.push(r.group);
  setGroup(r.group);
  toast(`Group created. Share code ${r.group.code} with your riders.`);
}
async function joinGroup(code) {
  try {
    const r = await api.post('/api/groups/join', { code });
    if (!ctx.groups.some((g) => g.id === r.group.id)) ctx.groups.push(r.group);
    setGroup(r.group);
    toast(`You joined ${r.group.name}`);
    return true;
  } catch (e) { toast(e.message, { error: true }); return false; }
}
async function leaveGroup() {
  const g = ctx.group;
  if (!g || !confirm(`Leave ${g.name}? You can rejoin with the code ${g.code}.`)) return;
  try {
    await api.post(`/api/groups/${g.id}/leave`);
    ctx.groups = ctx.groups.filter((x) => x.id !== g.id);
    setGroup(ctx.groups[0] || null);
    toast(`You left ${g.name}`);
  } catch (e) { toast(e.message, { error: true }); }
}

function onlineCount() {
  return ctx.group ? ctx.group.members.filter((m) => m.online || m.id === ctx.user.id).length : 0;
}
function renderPill() {
  const g = ctx.group;
  $('#group-pill-text').textContent = g ? `${g.name} · ${onlineCount()}/${g.members.length} riding` : 'Create or join a group';
}

function renderGroup() {
  const body = $('#group-body');
  const g = ctx.group;
  const joinForm = h('form', { class: 'stack', onsubmit: async (e) => { e.preventDefault(); const v = e.target.code.value; if (await joinGroup(v)) e.target.reset(); } },
    h('label', { class: 'field' }, h('span', {}, 'Join with a code'), h('input', { name: 'code', maxlength: 9, placeholder: '6-letter code', autocapitalize: 'characters', required: true, style: 'text-transform:uppercase;letter-spacing:.12em' })),
    h('button', { class: 'btn', type: 'submit' }, 'Join group'));
  const createForm = h('form', { class: 'stack', onsubmit: async (e) => { e.preventDefault(); try { await createGroup(e.target.gname.value); e.target.reset(); } catch (err) { toast(err.message, { error: true }); } } },
    h('label', { class: 'field' }, h('span', {}, 'Start a new group'), h('input', { name: 'gname', maxlength: 40, placeholder: 'Sunday ride to Lonavala', required: true })),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create group'));

  if (!g) {
    body.replaceChildren(
      h('div', { class: 'stack' }, h('h2', {}, 'Ride with your crew'), h('p', { class: 'muted' }, 'Create a group and share the code, or join one with a code from your group leader.')),
      createForm, joinForm);
    return;
  }

  const shareUrl = `${location.origin}/?join=${g.code}`;
  const qr = h('img', { class: 'qr', alt: `QR code to join ${g.name}`, width: 104, height: 104 });
  fetch(`/api/groups/${g.id}/qr.svg`, { headers: { authorization: `Bearer ${api.token}` } })
    .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) qr.src = URL.createObjectURL(b); }).catch(() => {});

  const members = [...g.members].sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name)).map((m) => {
    const loc = ctx.locs.get(m.id);
    const me = m.id === ctx.user.id;
    let where = me ? 'You' : m.online ? 'Online' : 'Offline';
    if (!me && loc && ctx.pos) where += ` · ${fmtDist(haversine([ctx.pos.lat, ctx.pos.lng], [loc.lat, loc.lng]))} away`;
    if (ctx.sos.has(m.id)) where = 'SOS active';
    return h('li', { class: 'member' },
      h('span', { class: `avatar${m.online || me ? ' online' : ''}`, style: `background:${m.color}` }, initials(m.name)),
      h('span', { class: 'who' }, h('b', {}, m.name + (m.id === g.ownerId ? ' (leader)' : '')), h('small', { class: ctx.sos.has(m.id) ? 'danger' : 'muted' }, where)),
      loc && !me ? h('button', { class: 'link', type: 'button', onclick: () => { closeSheet(); map.setFollow(false); map.centerOn(loc.lng, loc.lat); } }, 'Find') : null);
  });

  const plan = g.plan
    ? h('div', { class: 'plan' },
      h('b', {}, `Ride plan: ${g.plan.destination}`),
      g.plan.meetAt || g.plan.note ? h('span', { class: 'muted' }, [g.plan.meetAt && `Meet at ${g.plan.meetAt}`, g.plan.note].filter(Boolean).join('. ')) : null,
      h('small', { class: 'muted' }, `Set by ${g.plan.setBy}`),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => startNavigation({ name: g.plan.destination, lat: g.plan.lat, lng: g.plan.lng }) }, 'Navigate there'),
        h('button', { class: 'link', type: 'button', onclick: async () => { try { const r = await api.put(`/api/groups/${g.id}/plan`, { clear: true }); setGroup(r.group, { fresh: false }); map.setDestination(null); } catch (e) { toast(e.message, { error: true }); } } }, 'Clear plan')))
    : h('div', { class: 'plan' }, h('b', {}, 'No ride plan yet'), h('span', { class: 'muted' }, 'Search a destination in Tools → Route and tap “Set as group plan”.'),
      h('div', {}, h('button', { class: 'btn', type: 'button', onclick: () => { openSheet('tools'); initTools.show('route'); } }, 'Plan a ride')));

  const others = ctx.groups.filter((x) => x.id !== g.id);
  body.replaceChildren(...[
    h('div', { class: 'stack' },
      h('h2', {}, g.name),
      h('div', { class: 'code-card' },
        h('div', { class: 'stack tight' },
          h('small', { class: 'muted' }, 'Group code (tap to copy)'),
          h('button', { class: 'code-big', type: 'button', 'aria-label': `Copy group code ${g.code.split('').join(' ')}`, onclick: () => copy(g.code, 'Code copied') }, g.code),
          h('div', { class: 'row gap' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => shareInvite(g, shareUrl) }, 'Invite riders'))),
        qr)),
    plan,
    h('div', { class: 'stack tight' }, h('h2', {}, `Riders (${g.members.length})`), h('ul', { class: 'members' }, members)),
    others.length ? h('div', { class: 'stack tight' }, h('h2', {}, 'Your other groups'), h('div', { class: 'group-switch' }, others.map((o) => h('button', { class: 'chip', type: 'button', onclick: () => setGroup(o) }, o.name)))) : null,
    h('details', {}, h('summary', { class: 'link' }, 'Join or create another group'), h('div', { class: 'stack', style: 'margin-top:12px' }, joinForm, createForm)),
    h('button', { class: 'link danger', type: 'button', onclick: leaveGroup }, 'Leave this group')].filter(Boolean));
}

async function shareInvite(g, url) {
  const text = `Ride with me on Rylaide. Join “${g.name}” with code ${g.code}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Join my ride', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  copy(`${text}: ${url}`, 'Invite link copied');
}
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch { prompt('Copy this:', text); }
}

// ---------------------------------------------------------------- realtime
function wireRealtime() {
  rt.on('status', (s) => {
    const dot = $('#conn-dot');
    dot.className = `dot ${s === 'online' ? 'on' : s === 'connecting' ? 'wait' : ''}`;
    if (s === 'offline' && started) showBanner('Connection lost. Reconnecting…');
    if (s === 'online') hideBanner();
  });
  rt.on('snapshot', (m) => {
    if (m.group.id !== ctx.group?.id) return;
    Object.assign(ctx.group, m.group);
    const idx = ctx.groups.findIndex((g) => g.id === m.group.id);
    if (idx >= 0) ctx.groups[idx] = ctx.group;
    m.group.members.forEach((x) => ctx.members.set(x.id, x));
    m.locations.forEach(onLoc);
    m.sos.forEach(onSos);
    renderPill();
    if (ctx.pos) sendLoc(true);
    if (ctx.openSheet === 'group') renderGroup();
    if (ctx.group.plan) map.setDestination(ctx.group.plan.lng, ctx.group.plan.lat);
  });
  rt.on('members', (m) => {
    if (m.group.id !== ctx.group?.id) return;
    const removed = ctx.group.members.filter((x) => !m.group.members.some((y) => y.id === x.id));
    removed.forEach((x) => { map.removeRider(x.id); ctx.locs.delete(x.id); });
    setGroup(Object.assign(ctx.group, m.group), { fresh: false });
    if (m.group.plan) map.setDestination(m.group.plan.lng, m.group.plan.lat); else map.setDestination(null);
  });
  rt.on('presence', (m) => {
    const mem = ctx.group?.members.find((x) => x.id === m.userId);
    if (mem) { mem.online = m.online; renderPill(); if (ctx.openSheet === 'group') renderGroup(); }
  });
  rt.on('loc', (m) => onLoc(m.loc));
  rt.on('chat', (m) => {
    if (m.message.groupId !== ctx.group?.id) return;
    addMessage(m.message);
    if (ctx.openSheet !== 'chat' && m.message.type !== 'system' && m.message.userId !== ctx.user.id) { ctx.unread++; updateBadge(); }
  });
  rt.on('typing', (m) => {
    $('#typing').textContent = `${m.name} is typing…`;
    clearTimeout(ctx.typingT);
    ctx.typingT = setTimeout(() => ($('#typing').textContent = ''), 3000);
  });
  rt.on('voice', (m) => player.enqueue(m));
  rt.on('sos', (m) => onSos(m.alert));
  rt.on('sos_cancel', (m) => {
    ctx.sos.delete(m.userId);
    map.setSos(m.userId, false);
    if (ctx.alertFor === m.userId) hideAlert();
    if (ctx.openSheet === 'group') renderGroup();
  });
  rt.on('error', (m) => toast(m.error, { error: true }));
}

function onLoc(loc) {
  if (loc.userId === ctx.user.id) return;
  ctx.locs.set(loc.userId, loc);
  // The server stamps each update with the rider's current name and colour, so it wins over cached member data.
  const mem = ctx.group?.members.find((m) => m.id === loc.userId);
  if (mem && (mem.name !== loc.name || mem.color !== loc.color)) {
    Object.assign(mem, { name: loc.name, color: loc.color });
    ctx.members.set(mem.id, mem);
    if (ctx.openSheet === 'group') renderGroup();
  }
  map.upsertRider(loc);
}

function onSos(a) {
  ctx.sos.set(a.userId, a);
  map.setSos(a.userId, true);
  if (a.userId === ctx.user.id) return;
  vibrate([400, 150, 400, 150, 800]);
  const bar = $('#alert-bar');
  ctx.alertFor = a.userId;
  const dist = ctx.pos && Number.isFinite(a.lat) ? ` · ${fmtDist(haversine([ctx.pos.lat, ctx.pos.lng], [a.lat, a.lng]))} from you` : '';
  bar.replaceChildren(
    h('b', {}, `SOS from ${a.name}`),
    h('span', {}, `Sent at ${fmtTime(a.ts)}${dist}`),
    h('div', { class: 'row' },
      Number.isFinite(a.lat) ? h('button', { class: 'btn', type: 'button', onclick: () => { map.setFollow(false); map.centerOn(a.lng, a.lat, 16); } }, 'Show on map') : null,
      Number.isFinite(a.lat) ? h('button', { class: 'btn', type: 'button', onclick: () => startNavigation({ name: `${a.name} (SOS)`, lat: a.lat, lng: a.lng }) }, 'Navigate to them') : null,
      h('button', { class: 'btn', type: 'button', onclick: hideAlert }, 'Dismiss')));
  bar.hidden = false;
  if (ctx.openSheet === 'group') renderGroup();
}
function hideAlert() { $('#alert-bar').hidden = true; ctx.alertFor = null; }

// ---------------------------------------------------------------- chat
async function loadMessages() {
  const gid = ctx.group.id;
  try {
    const { messages } = await api.get(`/api/groups/${gid}/messages`);
    if (ctx.group?.id !== gid) return;
    $('#chat-list').replaceChildren();
    messages.forEach((m) => addMessage(m, false));
    renderChatEmpty();
    scrollChat();
  } catch (e) { toast(e.message, { error: true }); }
}
function addMessage(m, animate = true) {
  const list = $('#chat-list');
  if (list.querySelector(`[data-id="${m.id}"]`)) return;
  list.querySelector('.chat-empty')?.remove();
  const mine = m.userId === ctx.user.id;
  const li = h('li', { class: `msg ${m.type === 'system' ? 'system' : ''} ${m.type === 'voice' ? 'voice' : ''} ${mine ? 'mine' : ''}`, dataset: { id: m.id }, style: animate ? '' : 'animation:none' },
    m.type !== 'system' && !mine ? h('span', { class: 'from', style: `color:${m.color}` }, m.name) : null,
    m.text,
    m.type !== 'system' ? h('time', { datetime: new Date(m.ts).toISOString() }, fmtTime(m.ts)) : null);
  list.append(li);
  if (list.children.length > 200) list.firstElementChild.remove();
  scrollChat();
}
function renderChatEmpty() {
  const list = $('#chat-list');
  if (list.children.length) return;
  list.append(h('li', { class: 'chat-empty' }, ctx.group ? 'No messages yet. Say hi, or hold the talk button to send a voice message.' : 'Join a group to chat with your riders.'));
}
function scrollChat() { const l = $('#chat-list'); l.scrollTop = l.scrollHeight; }
function updateBadge() {
  const b = $('#chat-badge');
  b.hidden = !ctx.unread;
  b.textContent = ctx.unread > 9 ? '9+' : String(ctx.unread);
}

// ---------------------------------------------------------------- location
function startLocation() {
  if (!navigator.geolocation) { showBanner('This device can’t share its location.'); return; }
  navigator.geolocation.watchPosition(onPosition, (e) => {
    if (e.code === 1) showBanner('Location is off. Allow location for Rylaide so your group can see you and navigation can work.');
    else if (!ctx.pos) showBanner('Waiting for GPS…', 6000);
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}

function onPosition(p) {
  const c = p.coords;
  const prev = ctx.pos;
  const pos = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, speed: c.speed, heading: c.heading, ts: p.timestamp || Date.now() };
  // Browsers often omit speed; derive it from the last fix.
  if (!Number.isFinite(pos.speed) && prev) {
    const dt = (pos.ts - prev.ts) / 1000;
    if (dt > 0.5) pos.speed = haversine([prev.lat, prev.lng], [pos.lat, pos.lng]) / dt;
  }
  const first = !prev;
  ctx.pos = pos;
  map.upsertRider({ ...pos, name: ctx.user.name, color: ctx.user.color }, true);
  if (first) {
    map.centerOn(pos.lng, pos.lat, 15);
    loadWeather();
    if ($('#map-banner').textContent.startsWith('Waiting for GPS') || $('#map-banner').textContent.startsWith('Location is off')) hideBanner();
  }
  sendLoc(false);
  updateRide(pos);
  updateNav(pos);
}

let lastSent = null;
let trailing = null;
function sendLoc(force) {
  if (!ctx.pos || !ctx.group || !ctx.settings.share) return;
  const now = Date.now();
  const moved = lastSent ? haversine([lastSent.lat, lastSent.lng], [ctx.pos.lat, ctx.pos.lng]) : Infinity;
  if (!force && lastSent && moved < 10 && now - lastSent.at < 15000) return;
  if (!force && lastSent && now - lastSent.at < 2000) {
    // Throttled: make sure the newest position still goes out, even if GPS goes quiet.
    if (!trailing) trailing = setTimeout(() => { trailing = null; sendLoc(false); }, 2000 - (now - lastSent.at));
    return;
  }
  clearTimeout(trailing); trailing = null;
  if (rt.send({ t: 'loc', lat: ctx.pos.lat, lng: ctx.pos.lng, speed: ctx.pos.speed, heading: ctx.pos.heading })) {
    lastSent = { lat: ctx.pos.lat, lng: ctx.pos.lng, at: now };
  }
}

async function loadWeather() {
  if (!ctx.pos || (ctx.weatherAt && Date.now() - ctx.weatherAt < 30 * 60e3)) return;
  ctx.weatherAt = Date.now();
  try {
    const w = await api.get(`/api/weather?lat=${ctx.pos.lat}&lng=${ctx.pos.lng}`);
    ctx.weather = w;
    const sym = w.symbol || '';
    const icon = /thunder/.test(sym) ? '⛈' : /rain|sleet|drizzle/.test(sym) ? '🌧' : /snow/.test(sym) ? '❄' : /fog/.test(sym) ? '🌫' : /cloud/.test(sym) ? '⛅' : /night/.test(sym) ? '🌙' : '☀';
    const el = $('#weather');
    el.textContent = `${icon} ${Math.round(w.temp)}°${w.wind !== null ? ` · ${Math.round(w.wind * 3.6)} km/h wind` : ''}`;
    el.title = w.rain ? `${w.rain} mm rain expected in the next hour` : 'No rain expected in the next hour';
    el.hidden = false;
    if (w.rain > 0.2) toast('Rain expected within the hour. Pack your rain gear.');
  } catch { ctx.weatherAt = Date.now() - 25 * 60e3; /* retry in ~5 min */ }
}
setInterval(loadWeather, 5 * 60e3);

// ---------------------------------------------------------------- banner
function showBanner(text, ms) {
  const b = $('#map-banner');
  b.textContent = text;
  b.hidden = false;
  clearTimeout(ctx.bannerT);
  if (ms) ctx.bannerT = setTimeout(hideBanner, ms);
}
function hideBanner() { $('#map-banner').hidden = true; }

// ---------------------------------------------------------------- ride recording
function toggleRide() {
  if (ctx.ride) return stopRide();
  if (!ctx.pos) toast('Waiting for GPS. Your ride starts recording as soon as it’s found.');
  ctx.ride = { points: [], start: Date.now(), dist: 0, maxSpeed: 0 };
  if (ctx.pos) ctx.ride.points.push([ctx.pos.lat, ctx.pos.lng, Date.now()]);
  $('#btn-ride').textContent = 'Stop ride';
  $('#btn-ride').classList.add('recording');
  $('#hud').hidden = false;
  map.setTrack(ctx.ride.points);
  map.setFollow(true);
  ctx.rideTimer = setInterval(renderHud, 1000);
  renderHud();
  requestWakeLock();
  vibrate(60);
}
function updateRide(pos) {
  const r = ctx.ride;
  if (!r) return;
  if (Number.isFinite(pos.speed)) r.maxSpeed = Math.max(r.maxSpeed, pos.speed);
  if (pos.acc > 50) return renderHud(); // ignore poor fixes for distance
  const last = r.points[r.points.length - 1];
  const d = last ? haversine(last, [pos.lat, pos.lng]) : Infinity;
  if (d >= 5) {
    if (last) r.dist += d;
    r.points.push([pos.lat, pos.lng, Date.now()]);
    map.setTrack(r.points);
  }
  renderHud();
}
function renderHud() {
  const r = ctx.ride;
  if (!r) return;
  const sp = ctx.pos && Number.isFinite(ctx.pos.speed) ? ctx.pos.speed * 3.6 : 0;
  $('#hud-speed').textContent = sp < 1 ? '0' : Math.round(sp);
  $('#hud-dist').textContent = fmtKm(r.dist);
  $('#hud-time').textContent = fmtDur((Date.now() - r.start) / 1000);
}
async function stopRide() {
  const r = ctx.ride;
  ctx.ride = null;
  clearInterval(ctx.rideTimer);
  $('#btn-ride').textContent = 'Start ride';
  $('#btn-ride').classList.remove('recording');
  $('#hud').hidden = true;
  releaseWakeLock();
  if (r.points.length < 2 || r.dist < 50) {
    map.setTrack(null);
    toast('Ride was too short to save.');
    return;
  }
  try {
    const { ride } = await api.post('/api/rides', { points: r.points, duration: (Date.now() - r.start) / 1000, maxSpeed: r.maxSpeed, startedAt: r.start });
    toast(`Ride saved: ${fmtKm(ride.distance)} km in ${fmtDur(ride.duration)}`);
    renderRides();
  } catch (e) {
    // Keep the ride locally so it isn't lost when offline.
    const unsent = store.get('unsentRides', []);
    unsent.push({ points: r.points, duration: (Date.now() - r.start) / 1000, maxSpeed: r.maxSpeed, startedAt: r.start });
    store.set('unsentRides', unsent.slice(-5));
    toast('Couldn’t save the ride right now. It’s kept on this phone and will upload when you’re back online.', { error: true, ms: 6000 });
  }
}
async function flushUnsentRides() {
  const unsent = store.get('unsentRides', []);
  if (!unsent.length) return;
  const left = [];
  for (const r of unsent) { try { await api.post('/api/rides', r); } catch { left.push(r); } }
  store.set('unsentRides', left);
  if (left.length < unsent.length) { toast('Saved your earlier ride.'); renderRides(); }
}
window.addEventListener('online', flushUnsentRides);

let wakeLock = null;
async function requestWakeLock() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ } }
function releaseWakeLock() { wakeLock?.release().catch(() => {}); wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (!document.hidden && (ctx.ride || ctx.nav)) requestWakeLock(); });

// ---------------------------------------------------------------- navigation
function speak(text) {
  if (!ctx.settings.speak || !window.speechSynthesis) return;
  try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch { /* ignore */ }
}

export async function fetchRoute(dest) {
  const from = ctx.pos ? [ctx.pos.lng, ctx.pos.lat] : map.map ? map.map.getCenter().toArray() : null;
  if (!from) throw new Error('Waiting for your location.');
  return api.get(`/api/route?from=${from[0]},${from[1]}&to=${dest.lng},${dest.lat}`);
}

export async function startNavigation(dest, route) {
  try {
    route ||= await fetchRoute(dest);
  } catch (e) { toast(e.message, { error: true }); return; }
  ctx.nav = { dest, route, k: Math.min(1, route.steps.length - 1), spoken: {}, off: 0, lastReroute: 0 };
  map.setRoute(route.geometry);
  map.setDestination(dest.lng, dest.lat);
  hideAlert();
  closeSheet();
  $('#nav-card').hidden = false;
  document.body.classList.add('navving');
  renderNav(ctx.pos ? haversine([ctx.pos.lat, ctx.pos.lng], [route.steps[ctx.nav.k].location[1], route.steps[ctx.nav.k].location[0]]) : route.steps[0]?.distance || 0);
  speak(`Starting navigation to ${dest.name.split(',')[0]}. ${route.steps[ctx.nav.k]?.instruction || ''}`);
  requestWakeLock();
  setTimeout(() => map.setFollow(true), 1500);
}

function updateNav(pos) {
  const n = ctx.nav;
  if (!n) return;
  const steps = n.route.steps;
  const toDest = haversine([pos.lat, pos.lng], [n.dest.lat, n.dest.lng]);
  if (toDest < 35) {
    speak('You have arrived.');
    toast(`You’ve arrived at ${n.dest.name.split(',')[0]}`);
    return endNavigation();
  }
  // Off-route detection with hysteresis, then reroute at most every 20 s.
  const off = distToLine([pos.lat, pos.lng], n.route.geometry.coordinates);
  n.off = off > 70 ? n.off + 1 : 0;
  if (n.off >= 2 && Date.now() - n.lastReroute > 20000) {
    n.lastReroute = Date.now();
    speak('Rerouting');
    fetchRoute(n.dest).then((route) => {
      if (ctx.nav !== n) return;
      n.route = route; n.k = Math.min(1, route.steps.length - 1); n.spoken = {}; n.off = 0;
      map.setRoute(route.geometry);
      map.setFollow(true);
    }).catch(() => {});
  }
  let step = steps[n.k];
  let d = haversine([pos.lat, pos.lng], [step.location[1], step.location[0]]);
  while (d < 25 && n.k < steps.length - 1) {
    n.k++;
    step = steps[n.k];
    d = haversine([pos.lat, pos.lng], [step.location[1], step.location[0]]);
  }
  for (const [mark, say] of [[600, `In ${fmtDist(500)}, `], [150, '']]) {
    const key = `${n.k}:${mark}`;
    if (d <= mark && !n.spoken[key]) { n.spoken[key] = true; speak(`${say}${step.instruction}`); break; }
  }
  renderNav(d);
}
function renderNav(d) {
  const n = ctx.nav;
  const steps = n.route.steps;
  const step = steps[n.k];
  const rest = steps.slice(n.k + 1).reduce((s, x) => s + x.distance, 0) + d;
  const secs = steps.slice(n.k + 1).reduce((s, x) => s + x.duration, 0) + (step.distance ? (d / step.distance) * step.duration : 0);
  $('#nav-dist').textContent = fmtDist(d);
  $('#nav-instr').textContent = step.instruction;
  $('#nav-remaining').textContent = `${fmtKm(rest)} km · ${fmtEta(secs || n.route.duration)} to ${n.dest.name.split(',')[0]}`;
}
function endNavigation() {
  ctx.nav = null;
  $('#nav-card').hidden = true;
  document.body.classList.remove('navving');
  map.setRoute(null);
  if (ctx.group?.plan) map.setDestination(ctx.group.plan.lng, ctx.group.plan.lat); else map.setDestination(null);
  if (!ctx.ride) releaseWakeLock();
}

async function setPlanFromPlace(place, extra = {}) {
  if (!ctx.group) { toast('Join or create a group first.', { error: true }); return false; }
  try {
    const r = await api.put(`/api/groups/${ctx.group.id}/plan`, { destination: place.name.split(',').slice(0, 2).join(','), lat: place.lat, lng: place.lng, ...extra });
    setGroup(Object.assign(ctx.group, r.group), { fresh: false });
    map.setDestination(place.lng, place.lat);
    toast('Ride plan shared with your group');
    return true;
  } catch (e) { toast(e.message, { error: true }); return false; }
}

// ---------------------------------------------------------------- push to talk
function wirePtt() {
  const btn = $('#btn-ptt');
  let pressing = false;
  const down = async (e) => {
    e.preventDefault();
    player.unlock();
    if (!ctx.group) { toast('Join a group to talk to your riders.'); return; }
    if (rt.status !== 'online') { toast('You’re offline. Voice will work when you reconnect.', { error: true }); return; }
    if (pressing) return;
    pressing = true;
    btn.setPointerCapture?.(e.pointerId);
    btn.classList.add('live');
    $('#ptt-label').textContent = 'Talking…';
    vibrate(30);
    ptt.onLimit = () => up();
    try {
      await ptt.start();
      if (!pressing) up(); // released while the mic was starting
    } catch (err) {
      pressing = false;
      btn.classList.remove('live');
      $('#ptt-label').textContent = 'Hold to talk';
      toast(err.message, { error: true, ms: 6000 });
    }
  };
  const up = async () => {
    if (!pressing) return;
    pressing = false;
    btn.classList.remove('live');
    $('#ptt-label').textContent = 'Hold to talk';
    if (!ptt.active) return;
    const clip = await ptt.stop();
    if (!clip) { toast('Hold the button while you talk.'); return; }
    vibrate(20);
    if (!rt.send({ t: 'voice', ...clip })) toast('Couldn’t send. You’re offline.', { error: true });
  };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('lostpointercapture', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) down(e); });
  btn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') up(); });
}

// ---------------------------------------------------------------- SOS
function wireSos() {
  const btn = $('#btn-sos');
  let holdT, countT, count;
  const startHold = (e) => {
    e.preventDefault();
    btn.classList.add('holding');
    vibrate(40);
    holdT = setTimeout(() => { btn.classList.remove('holding'); beginCountdown(); }, 1500);
  };
  const endHold = () => {
    if (!btn.classList.contains('holding')) return;
    btn.classList.remove('holding');
    clearTimeout(holdT);
    toast('Hold SOS for 1.5 seconds to alert your group.');
  };
  btn.addEventListener('pointerdown', startHold);
  btn.addEventListener('pointerup', endHold);
  btn.addEventListener('pointerleave', endHold);
  btn.addEventListener('pointercancel', endHold);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.repeat) startHold(e); });
  btn.addEventListener('keyup', (e) => { if (e.key === 'Enter') endHold(); });

  function beginCountdown() {
    count = 5;
    $('#sos-title').firstChild.textContent = 'Sending SOS in ';
    $('#sos-count').textContent = count;
    $('#sos-count').hidden = false;
    $('#sos-desc').textContent = ctx.group ? 'Your group will get an alert with your location.' : 'You’re not in a group, so only your emergency contacts below can help.';
    renderSosContacts();
    $('#sos-cancel').textContent = 'Cancel';
    $('#sos-overlay').hidden = false;
    vibrate([200, 100, 200]);
    countT = setInterval(() => {
      count--;
      $('#sos-count').textContent = count;
      vibrate(80);
      if (count <= 0) { clearInterval(countT); sendSos(); }
    }, 1000);
  }
  function sendSos() {
    ctx.sosActive = true;
    const p = ctx.pos;
    const sent = ctx.group && rt.send({ t: 'sos', lat: p?.lat, lng: p?.lng });
    $('#sos-title').firstChild.textContent = sent ? 'SOS sent to your group' : ctx.group ? 'Couldn’t reach your group' : 'Call for help';
    $('#sos-count').hidden = true;
    $('#sos-desc').textContent = sent ? 'They can see where you are. Call someone below if you can.' : 'You’re offline. Call or text an emergency contact or 112.';
    $('#sos-cancel').textContent = 'I’m safe: cancel SOS';
    vibrate([500, 200, 500]);
  }
  $('#sos-cancel').addEventListener('click', () => {
    clearInterval(countT);
    if (ctx.sosActive) { rt.send({ t: 'sos_cancel' }); ctx.sosActive = false; toast('SOS cancelled. Your group knows you’re safe.'); }
    $('#sos-overlay').hidden = true;
  });
}
function renderSosContacts() {
  const p = ctx.pos;
  const mapLink = p ? `https://www.openstreetmap.org/?mlat=${p.lat.toFixed(5)}&mlon=${p.lng.toFixed(5)}#map=17/${p.lat.toFixed(5)}/${p.lng.toFixed(5)}` : '';
  const body = encodeURIComponent(`SOS from ${ctx.user.name} on Rylaide. I need help.${mapLink ? ` My location: ${mapLink}` : ''}`);
  const rows = ctx.contacts.map((c) => h('div', { class: 'row gap' },
    h('a', { class: 'btn grow', href: `tel:${c.phone}` }, `Call ${c.name}`),
    h('a', { class: 'btn', href: `sms:${c.phone}?&body=${body}` }, 'Text')));
  rows.push(h('a', { class: 'btn', href: 'tel:112' }, 'Call 112 (emergency)'));
  if (!ctx.contacts.length) rows.unshift(h('p', { class: 'small' }, 'Add emergency contacts in the You tab so they appear here.'));
  $('#sos-contacts').replaceChildren(...rows);
}

// ---------------------------------------------------------------- You / settings
function renderYou() {
  $('#pf-name').value = ctx.user.name;
  $('#pf-bike').value = ctx.user.bike;
  const sw = (host, list, current, onPick, label) => host.replaceChildren(...list.map((c) => h('button', {
    type: 'button', class: 'swatch', role: 'radio', 'aria-checked': String(c.toLowerCase() === String(current).toLowerCase()),
    'aria-label': `${label} ${c}`, style: `background:${c}`,
    onclick: (e) => { onPick(c); host.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-checked', String(x === e.currentTarget))); },
  })));
  sw($('#pf-colors'), RIDER_COLORS, ctx.pickColor || ctx.user.color, (c) => (ctx.pickColor = c), 'Map colour');
  sw($('#set-accent'), ACCENTS, ctx.settings.accent, (c) => setSetting('accent', c), 'Accent');
  $$('#set-theme button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === ctx.settings.theme)));
  $('#set-glove').checked = !!ctx.settings.glove;
  $('#set-voice').checked = !!ctx.settings.speak;
  $('#set-share').checked = !!ctx.settings.share;
  renderContacts();
}
function setSetting(k, v) {
  ctx.settings[k] = v;
  store.set(k, v);
  applyAppearance();
}
function renderContacts() {
  const rows = $('#contacts-rows');
  const list = ctx.contacts.length ? ctx.contacts : [{ name: '', phone: '' }];
  rows.replaceChildren(...list.map(contactRow));
}
function contactRow(c) {
  const row = h('div', { class: 'row gap contact-row' },
    h('input', { 'aria-label': 'Contact name', placeholder: 'Name', value: c.name, maxlength: 40, class: 'c-name' }),
    h('input', { 'aria-label': 'Phone number', placeholder: 'Phone', value: c.phone, type: 'tel', inputmode: 'tel', maxlength: 20, class: 'c-phone' }),
    h('button', { class: 'link danger', type: 'button', 'aria-label': 'Remove contact', onclick: () => row.remove() }, 'Remove'));
  return row;
}

// ---------------------------------------------------------------- wiring
function wireUi() {
  wireRealtime();
  wirePtt();
  wireSos();
  $$('.tab').forEach((t) => t.addEventListener('click', () => (t.dataset.sheet ? (ctx.openSheet === t.dataset.sheet ? closeSheet() : openSheet(t.dataset.sheet)) : closeSheet())));
  $('#scrim').addEventListener('click', () => closeSheet());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  $('#group-pill').addEventListener('click', () => openSheet('group'));
  $('#btn-locate').addEventListener('click', () => {
    if (!ctx.pos) { toast('Waiting for GPS…'); return; }
    map.setFollow(true);
    $('#btn-locate').classList.add('active');
    map.centerOn(ctx.pos.lng, ctx.pos.lat, 16);
  });
  $('#btn-fit').addEventListener('click', () => { map.setFollow(false); $('#btn-locate').classList.remove('active'); if (map.fitRiders() === false) toast('No riders on the map yet.'); });
  $('#btn-ride').addEventListener('click', toggleRide);
  $('#nav-stop').addEventListener('click', () => { endNavigation(); toast('Navigation ended'); });
  document.addEventListener('pointerdown', () => player.unlock(), { once: true });

  // swipe a sheet's grabber down to close
  $$('.sheet').forEach((s) => {
    let y0 = null;
    s.querySelector('.grabber').addEventListener('pointerdown', (e) => { y0 = e.clientY; });
    window.addEventListener('pointerup', (e) => { if (y0 !== null && e.clientY - y0 > 60) closeSheet(); y0 = null; });
  });

  // chat
  let lastTyping = 0;
  $('#chat-input').addEventListener('input', () => { if (Date.now() - lastTyping > 2500) { lastTyping = Date.now(); rt.send({ t: 'typing' }); } });
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    if (!ctx.group) { toast('Join a group to chat.'); return; }
    if (!rt.send({ t: 'chat', text })) { toast('You’re offline. Your message wasn’t sent.', { error: true }); return; }
    input.value = '';
  });

  // you
  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const body = { name: $('#pf-name').value, bike: $('#pf-bike').value };
      if (ctx.pickColor) body.color = ctx.pickColor;
      ctx.user = (await api.patch('/api/me', body)).user;
      store.set('user', ctx.user);
      ctx.pickColor = null;
      if (ctx.pos) map.upsertRider({ ...ctx.pos, name: ctx.user.name, color: ctx.user.color }, true);
      toast('Profile saved');
      renderYou();
    } catch (err) { toast(err.message, { error: true }); }
  });
  $$('#set-theme button').forEach((b) => b.addEventListener('click', () => { setSetting('theme', b.dataset.v); renderYou(); }));
  $('#set-glove').addEventListener('change', (e) => setSetting('glove', e.target.checked));
  $('#set-voice').addEventListener('change', (e) => setSetting('speak', e.target.checked));
  $('#set-share').addEventListener('change', (e) => { setSetting('share', e.target.checked); if (e.target.checked) sendLoc(true); });
  $('#contacts-add').addEventListener('click', () => {
    if ($$('.contact-row').length >= 5) { toast('You can add up to 5 contacts.'); return; }
    $('#contacts-rows').append(contactRow({ name: '', phone: '' }));
  });
  $('#contacts-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const contacts = $$('.contact-row').map((r) => ({ name: r.querySelector('.c-name').value, phone: r.querySelector('.c-phone').value })).filter((c) => c.name || c.phone);
    try {
      const r = await api.put('/api/contacts', { contacts });
      const dropped = contacts.length - r.contacts.length;
      ctx.contacts = r.contacts;
      renderContacts();
      toast(dropped ? `Saved ${r.contacts.length}. ${dropped} skipped: each needs a name and a full phone number.` : 'Emergency contacts saved');
    } catch (err) { toast(err.message, { error: true }); }
  });
  $('#btn-signout').addEventListener('click', () => {
    if (!confirm('Sign out? This prototype has no passwords, so you can’t sign back in to this account. You’ll start fresh, and your rides and fuel log stay with the old account.')) return;
    rt.close();
    api.setToken(null);
    ['user', 'groupId'].forEach(store.del);
    location.reload();
  });
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#btn-install').hidden = false; });
  $('#btn-install').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#btn-install').hidden = true; });

  // mic test
  const refreshMics = async () => {
    const mics = await listMics();
    const sel = $('#mic-device');
    const cur = store.get('micId', '');
    sel.replaceChildren(h('option', { value: '' }, 'Default microphone'), ...mics.filter((m) => m.deviceId && m.deviceId !== 'default').map((m, i) => h('option', { value: m.deviceId, selected: m.deviceId === cur }, m.label || `Microphone ${i + 1}`)));
  };
  $('#mic-start').addEventListener('click', async () => {
    try {
      await micTest.start($('#mic-device').value);
      $('#mic-record').disabled = false;
      $('#mic-start').textContent = 'Restart test';
      refreshMics();
    } catch (e) { $('#mic-status').textContent = e.message; }
  });
  $('#mic-device').addEventListener('change', (e) => { store.set('micId', e.target.value); if (micTest.stream) $('#mic-start').click(); });
  $('#mic-record').addEventListener('click', async () => {
    $('#mic-record').disabled = true;
    try { if (await micTest.record(3000)) $('#mic-play').disabled = false; } catch (e) { $('#mic-status').textContent = e.message; }
    $('#mic-record').disabled = false;
  });
  $('#mic-play').addEventListener('click', () => micTest.play().catch(() => ($('#mic-status').textContent = 'Couldn’t play the recording.')));
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    refreshMics();
    toast('Audio device changed. Rylaide will use it for your next message.');
  });

  setInterval(() => { if (ctx.openSheet === 'group') renderGroup(); }, 20000);
  flushUnsentRides();
}

// Exposed for automated tests and debugging in the console.
window.__rylaide = { ctx, rt, get map() { return map; }, startNavigation, endNavigation, renderChecklist, renderFuel };

boot();

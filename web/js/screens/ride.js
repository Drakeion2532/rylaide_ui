// 25r Ride hub (Map · Speed · Group) · 25 Full-screen map · 30 SOS countdown
import { h, fmtDist, fmtKm, fmtEta, haversine, store, vibrate } from '../util.js';
import { ctx, onMany } from '../state.js';
import { ic, button, iconButton, avatar, connectionStatus, segmented, rideControl, switchEl, ring, dialog, snackbar, sheet, listItem } from '../ui.js';
import { register, push, back, tab, current } from '../router.js';
import { RideMap } from '../map.js';
import * as engine from '../engine.js';
import { joinSheet } from './groups.js';

const STALE = 2 * 60e3;
const maneuverIcon = (s) => {
  if (!s) return 'straight';
  if (s.type === 'arrive') return 'flag';
  if (s.type === 'roundabout' || s.type === 'rotary') return 'roundabout_right';
  if (s.type === 'depart') return 'navigation';
  const m = s.modifier || '';
  return { left: 'turn_left', right: 'turn_right', 'slight left': 'turn_slight_left', 'slight right': 'turn_slight_right', 'sharp left': 'turn_sharp_left', 'sharp right': 'turn_sharp_right', uturn: 'u_turn_left', straight: 'straight' }[m] || 'straight';
};
const shortInstr = (s) => (s?.instruction || '').replace(/^Turn /, '').replace(/^(\w)/, (c) => c.toUpperCase()).replace(' onto ', ' · ');

function maneuverCard(ns) {
  if (!ns) return null;
  const el = h('div', { class: `maneuver${ns.arrived ? ' arrive' : ''}`, role: 'status', 'aria-live': 'polite' },
    ic(ns.arrived ? 'flag' : maneuverIcon(ns.step), { size: 36 }),
    h('div', { class: 'main' }, h('span', { class: 'ride-instruction tabular' }, ns.arrived ? 'Arrived' : fmtDist(ns.toNext)), h('span', { class: 'body-m' }, ns.arrived ? engine.short(ns.dest.name) : shortInstr(ns.step))));
  return el;
}
const speedKmh = () => (ctx.pos && Number.isFinite(ctx.pos.speed) ? Math.max(0, Math.round(ctx.pos.speed * 3.6)) : 0);
const arriveAt = (secs) => new Date(Date.now() + secs * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** The three in-ride controls (Riders · Mic · SOS). Shared by the hub and the full-screen map. */
function rideControls({ onRiders } = {}) {
  const g = ctx.ride?.solo ? null : ctx.group;
  const riders = g ? rideControl({ type: 'group', icon: 'groups', label: `${engine.onlineRiders().length} ${engine.onlineRiders().length === 1 ? 'rider' : 'riders'}`, onclick: onRiders })
    : rideControl({ type: 'group', icon: 'person', label: 'Solo ride', onclick: () => snackbar('Solo ride: your location stays private. Start a group ride to share it.') });
  const mic = rideControl({ type: ctx.voiceOn && g ? 'mic-idle' : 'mic-off', icon: ctx.voiceOn && g ? 'mic' : 'mic_off', label: ctx.voiceOn && g ? 'Hold to talk' : 'Mic off', cls: 'mic-ctl' });
  wirePtt(mic, () => g);
  const sos = rideControl({ type: 'sos', icon: 'SOS', label: 'SOS', hold: 1500, cls: 'sos-ctl', onHold: () => push('sos', {}, { anim: 'up' }), onclick: () => snackbar('Hold SOS for 1.5 seconds to alert your group.') });
  const el = h('div', { class: 'ride-controls' }, riders, mic, sos);
  const offs = onMany({
    group: () => { const n = engine.onlineRiders().length; if (ctx.group) riders.setState({ label: `${n} ${n === 1 ? 'rider' : 'riders'}` }); },
    speaking: (who) => mic.classList.toggle('hearing', !!who),
  });
  el.cleanup = offs;
  return el;
}

function wirePtt(ctl, groupFor = () => ctx.group) {
  let pressing = false;
  const reset = () => ctl.setState(ctx.voiceOn && groupFor() ? { type: 'mic-idle', label: 'Hold to talk', icon: 'mic' } : { type: 'mic-off', label: 'Mic off', icon: 'mic_off' });
  const down = async (e) => {
    e.preventDefault();
    engine.player.unlock();
    if (!groupFor()) return snackbar(ctx.ride?.solo ? 'Talk works on group rides.' : 'Join a group to talk to your riders.');
    if (!ctx.voiceOn) return snackbar('Voice chat is off. Turn it on in the Group view.');
    if (pressing) return;
    pressing = true;
    ctl.setPointerCapture?.(e.pointerId);
    ctl.classList.add('live');
    ctl.setState({ type: 'mic', label: 'You’re live', icon: 'mic' });
    engine.ptt.onLimit = () => up();
    try {
      await engine.talkStart();
      // Released while the mic was still starting: stop it now so it never keeps recording.
      if (!pressing) { await engine.talkStop(); snackbar('Hold the mic while you talk.'); }
    } catch (err) { pressing = false; ctl.classList.remove('live'); reset(); snackbar(err.message); }
  };
  const up = async () => {
    if (!pressing) return;
    pressing = false;
    ctl.classList.remove('live');
    reset();
    if (!engine.ptt.active) return; // mic still starting — down() finishes the job
    const r = await engine.talkStop();
    if (r === 'short') snackbar('Hold the mic while you talk.');
    if (r === 'offline') snackbar('Couldn’t send. You’re offline.');
  };
  ctl.addEventListener('pointerdown', down);
  ctl.addEventListener('pointerup', up);
  ctl.addEventListener('pointercancel', up);
  ctl.addEventListener('lostpointercapture', up);
  ctl.addEventListener('contextmenu', (e) => e.preventDefault());
  ctl.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) down(e); });
  ctl.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') up(); });
}

function connChip() {
  const state = ctx.conn === 'internet' && ctx.group && engine.onlineRiders().length > 1 ? 'connected' : ctx.conn;
  return connectionStatus(state === 'internet' ? 'internet' : state, true);
}

async function confirmEnd() {
  if (!(await dialog({ title: 'End this ride?', body: 'Your route, time and speed are saved to History.', confirm: 'End ride' }))) return;
  const r = await engine.endRide();
  if (r?.tooShort) { snackbar('Ride was too short to save.'); tab('home'); return; }
  if (r) push('summary', { ride: r, justEnded: true }, { replace: true });
}

// ---------------------------------------------------------------- ride hub
register('ride', (el) => {
  if (!ctx.ride) { setTimeout(() => tab('home'), 0); return; }
  let view = store.get('hubView', 'map');
  let map = null;
  const timer = h('span', { class: 'title-l tabular' });
  const chips = h('div', { class: 'hub-chips' });
  const nc = () => h('button', { type: 'button', class: `status compact ${ctx.noiseCancel ? 'accent' : 'neutral'}`, style: 'border:0', 'aria-pressed': String(ctx.noiseCancel), onclick: () => { ctx.noiseCancel = !ctx.noiseCancel; store.set('noiseCancel', ctx.noiseCancel); renderChips(); snackbar(`Noise cancel ${ctx.noiseCancel ? 'on' : 'off'}`); } }, ic('noise_control_off'), `Noise cancel ${ctx.noiseCancel ? 'on' : 'off'}`);
  const renderChips = () => chips.replaceChildren(connChip(), nc(), ctx.gps === 'denied' ? h('span', { class: 'status compact warn' }, ic('location_off'), 'Location off') : ctx.gps === 'weak' ? h('span', { class: 'status compact warn' }, ic('gps_not_fixed'), 'Weak GPS') : null);
  const more = iconButton('more_vert', { label: 'Ride options', onclick: () => sheet((close) => h('div', { class: 'list' },
    listItem({ icon: 'record_voice_over', title: 'Spoken directions', trail: switchEl({ checked: store.get('speak', true), label: 'Spoken directions', onchange: (v) => store.set('speak', v) }) }),
    listItem({ icon: 'campaign', title: 'Voice chat', sub: 'Hear your group', trail: switchEl({ checked: ctx.voiceOn, label: 'Voice chat', onchange: (v) => { ctx.voiceOn = v; store.set('voiceOn', v); render(); } }) }),
    listItem({ icon: 'forum', title: 'Group chat', onclick: () => { close(); if (ctx.group) push('group', { id: ctx.group.id }); } }),
    listItem({ icon: 'stop_circle', title: 'End ride', onclick: () => { close(); confirmEnd(); } }))) });
  const end = button('End ride', { style: 'danger-outlined', icon: 'stop_circle', onclick: confirmEnd });
  const seg = segmented([{ value: 'map', label: 'Map' }, { value: 'speed', label: 'Speed' }, { value: 'group', label: 'Group' }], view, (v) => { view = v; store.set('hubView', v); render(); }, { label: 'Ride view' });
  const content = h('div', { class: 'hub-content' });
  const bannerHost = h('div', { 'data-banner-host': '', style: 'padding:0 16px' });
  let controls = rideControls({ onRiders: () => { seg.set('group'); view = 'group'; render(); } });
  el.append(
    h('div', { class: 'hub-top' },
      iconButton('keyboard_arrow_down', { label: 'Minimise ride', style: 'tonal', onclick: () => tab('home') }),
      h('div', { class: 'timer' }, h('span', { class: 'label-m variant' }, 'Ride time'), timer), more, end),
    chips, h('div', { class: 'hub-switch' }, seg), bannerHost, content, h('div', { style: 'padding:0 16px' }, controls));

  const tick = () => {
    if (!ctx.ride) return;
    const s2 = Math.floor((Date.now() - ctx.ride.startedAt) / 1000);
    timer.textContent = [Math.floor(s2 / 3600), Math.floor((s2 % 3600) / 60), s2 % 60].map((n) => String(n).padStart(2, '0')).join(':');
  };
  const tickT = setInterval(tick, 1000);
  tick();

  // ---- views
  let speedBubble = null, maneuverSlot = null, strip = null, gauge = null;
  const mapView = () => {
    const mapEl = h('div', { class: 'map' });
    maneuverSlot = h('div');
    speedBubble = h('div', { class: 'speed-bubble', 'aria-label': 'Speed' }, h('b', { class: 'tabular' }, '0'), h('span', { class: 'body-s' }, 'km/h'));
    const card = h('div', { class: 'map-card' }, mapEl, maneuverSlot, speedBubble,
      h('button', { type: 'button', class: 'btn fs-btn', onclick: () => push('ridemap') }, ic('open_in_full'), 'Full screen'));
    strip = h('div', { class: 'trip-strip' });
    content.replaceChildren(card, strip);
    map = new RideMap(mapEl, { zoom: 16, onFollowChange: () => {} });
    map.init().then(() => map.resize());
    if (ctx.ride.route) { map.setRoutes([ctx.ride.route], 0, { fit: false, labels: false }); map.setDestination(ctx.ride.dest.lng, ctx.ride.dest.lat); }
    map.setTrack(ctx.ride.points);
    if (ctx.pos) map.setMe(ctx.pos);
    for (const l of ctx.locs.values()) map.upsertRider(l, { sos: ctx.sos.has(l.userId) });
    updateMapView();
  };
  const updateMapView = () => {
    if (!strip) return;
    const ns = engine.navState();
    maneuverSlot.replaceChildren(maneuverCard(ns) || '');
    speedBubble.querySelector('b').textContent = speedKmh();
    const r = ctx.ride;
    strip.replaceChildren(ns
      ? h('div', { class: 'main' }, h('span', { class: 'ride-metric' }, fmtEta(ns.secs)), h('span', { class: 'body-m variant' }, `${fmtKm(ns.remaining)} km left · Arrive ${arriveAt(ns.secs)}`))
      : h('div', { class: 'main' }, h('span', { class: 'ride-metric' }, `${fmtKm(r.dist)} km`), h('span', { class: 'body-m variant' }, 'Ridden so far · free ride')),
    h('div', { class: 'side' }, h('span', { class: 'label-m variant' }, ctx.weather ? 'Weather' : 'Top speed'), h('span', { class: 'title-s' }, ctx.weather ? `${Math.round(ctx.weather.temp)}° ${ctx.weather.rain > 0.2 ? '· rain' : ''}` : `${Math.round(r.maxSpeed * 3.6)} km/h`)));
  };

  const speedView = () => {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 300 300');
    const add = (tag, a) => { const e = document.createElementNS(NS, tag); Object.entries(a).forEach(([k, v]) => e.setAttribute(k, v)); svg.append(e); return e; };
    // 270° arc, 0–160 km/h
    const R = 130, C = 150, A0 = 135, SPAN = 270;
    const pt = (deg, r = R) => [C + r * Math.cos((deg * Math.PI) / 180), C + r * Math.sin((deg * Math.PI) / 180)];
    const arc = (a, b) => { const [x0, y0] = pt(a), [x1, y1] = pt(b); return `M ${x0} ${y0} A ${R} ${R} 0 ${b - a > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
    add('path', { d: arc(A0, A0 + SPAN), class: 'arc-track', fill: 'none', 'stroke-width': 14, 'stroke-linecap': 'round' });
    const val = add('path', { d: arc(A0, A0 + SPAN), class: 'arc', fill: 'none', 'stroke-width': 14, 'stroke-linecap': 'round', pathLength: 100, 'stroke-dasharray': 100, 'stroke-dashoffset': 100 });
    for (let k = 0; k <= 16; k++) {
      const deg = A0 + (SPAN * k) / 16, major = k % 4 === 0;
      const [x0, y0] = pt(deg, R - 22), [x1, y1] = pt(deg, R - (major ? 34 : 28));
      add('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'tick', 'stroke-width': major ? 2.5 : 1.5, 'stroke-linecap': 'round' });
      if (major) { const [tx, ty] = pt(deg, R - 50); add('text', { x: tx, y: ty + 4, 'text-anchor': 'middle', class: 'tick-l' }).textContent = String(k * 10); }
    }
    const num = h('span', { class: 'ride-speed tabular' }, '0');
    gauge = h('div', { class: 'gauge' }, svg, h('div', { class: 'readout' }, num, h('span', { class: 'title-m variant' }, 'km/h')));
    gauge.set = (v) => { num.textContent = String(v); val.setAttribute('stroke-dashoffset', 100 - Math.min(100, (v / 160) * 100)); val.style.opacity = v > 0 ? 1 : 0; gauge.classList.toggle('over', v > 80); };
    const stats = h('div', { class: 'speed-stats' });
    gauge.stats = () => {
      const r = ctx.ride, el2 = (Date.now() - r.startedAt) / 1000;
      stats.replaceChildren(
        h('div', { class: 'stat tile' }, h('div', { class: 'v' }, h('span', { class: 'ride-metric' }, fmtKm(r.dist)), h('span', { class: 'u' }, 'km')), h('span', { class: 'l' }, 'Distance')),
        h('div', { class: 'stat tile' }, h('div', { class: 'v' }, h('span', { class: 'ride-metric' }, String(Math.round(el2 > 0 ? (r.dist / el2) * 3.6 : 0))), h('span', { class: 'u' }, 'km/h')), h('span', { class: 'l' }, 'Average')),
        h('div', { class: 'stat tile' }, h('div', { class: 'v' }, h('span', { class: 'ride-metric' }, String(Math.round(r.maxSpeed * 3.6))), h('span', { class: 'u' }, 'km/h')), h('span', { class: 'l' }, 'Top')));
    };
    const ns = engine.navState();
    content.replaceChildren(h('div', { class: 'speed-view' }, ns ? maneuverCard(ns) : null, gauge, h('span', { class: 'tag' }, 'Over 80 km/h turns amber'), stats));
    gauge.set(speedKmh()); gauge.stats();
  };

  const groupView = () => {
    const g = ctx.ride?.solo ? null : ctx.group;
    if (!g) {
      content.replaceChildren(h('div', { class: 'empty' }, ic('person'), h('p', { class: 'title-m', style: 'color:var(--on-surface)' }, 'Solo ride'),
        h('p', { class: 'body-m' }, ctx.group ? `Your location stays private. Start a group ride to ride with ${ctx.group.name}.` : 'Join a group to see your riders here and talk to them.'),
        ctx.group ? null : button('Join a group', { style: 'tonal', onclick: () => joinSheet({ stay: true }) })));
      return;
    }
    const riders = [...g.members].sort((a, b) => (a.id === ctx.user.id ? -1 : b.id === ctx.user.id ? 1 : (b.online - a.online)));
    const row = (m) => {
      const me = m.id === ctx.user.id, loc = ctx.locs.get(m.id);
      const speaking = me ? engine.ptt.active : ctx.speaking === m.id;
      let sub = me ? (engine.ptt.active ? 'Speaking' : ctx.voiceOn ? 'Listening' : 'Mic off') : !m.online ? 'Disconnected' : speaking ? 'Speaking' : ctx.voiceOn ? 'Listening' : 'Connected';
      if (!me && loc && ctx.pos) { const d = haversine([ctx.pos.lat, ctx.pos.lng], [loc.lat, loc.lng]); sub += ` · ${fmtDist(d).replace('now', 'with you')}${d >= 50 ? ' away' : ''}`; }
      if (ctx.sos.has(m.id)) sub = 'SOS · needs help';
      return h('div', { class: `rider-row${ctx.sos.has(m.id) ? ' selected' : ''}` },
        avatar(me ? `${ctx.user.name}` : m.name, { status: ctx.sos.has(m.id) ? 'off' : speaking ? 'speaking' : me || m.online ? 'connected' : 'off', size: 'l', accent: me }),
        h('span', { class: 'main' }, h('span', { class: 'body-l' }, me ? 'You' : m.name), h('span', { class: 'body-m variant' }, sub)),
        loc && !me ? iconButton('my_location', { label: `Show ${m.name} on the map`, onclick: () => push('ridemap', { focus: loc }) }) : null);
    };
    content.replaceChildren(h('div', { class: 'screen-body', style: 'margin:0 -16px;padding:0 16px' },
      h('div', { class: 'row', style: 'justify-content:space-between;padding:4px 0 12px' }, h('span', { class: 'title-s variant' }, 'In this ride'),
        h('button', { type: 'button', class: 'btn tonal', style: 'height:40px', onclick: () => push('ridemap') }, ic('open_in_full', { size: 18 }), 'Full screen')),
      h('div', { class: 'list' }, riders.map(row)),
      h('div', { class: 'row gap8 body-s variant', style: 'padding:16px 4px' }, ic('two_wheeler', { size: 16 }), `${g.name} · ${riders.length} ${riders.length === 1 ? 'rider' : 'riders'}`),
      h('div', { class: 'list' }, listItem({ icon: 'campaign', title: 'Voice chat', sub: ctx.voiceOn ? 'On · your group can hear you' : 'Off · you won’t hear your group', trail: switchEl({ checked: ctx.voiceOn, label: 'Voice chat', onchange: (v) => { ctx.voiceOn = v; store.set('voiceOn', v); render(); } }) }))));
  };

  const render = () => {
    map?.destroy(); map = null; strip = null; gauge = null;
    controls.cleanup?.();
    const fresh = rideControls({ onRiders: () => { seg.set('group'); view = 'group'; render(); } });
    controls.replaceWith(fresh); controls = fresh;
    renderChips();
    ({ map: mapView, speed: speedView, group: groupView })[view]();
  };
  render();

  const offs = onMany({
    pos: (p) => { map?.setMe(p); if (speedBubble && strip) speedBubble.querySelector('b').textContent = speedKmh(); if (gauge) { gauge.set(speedKmh()); gauge.stats(); } },
    nav: () => { if (view === 'map') updateMapView(); },
    'ride-tick': () => { if (view === 'map') updateMapView(); },
    track: (pts) => map?.setTrack(pts),
    route: (r) => map?.setRoutes([r], 0, { fit: false, labels: false }),
    loc: (l) => { map?.upsertRider(l, { sos: ctx.sos.has(l.userId) }); if (view === 'group') groupView(); },
    'rider-left': (id) => map?.removeRider(id),
    sos: (a) => { map?.setSos(a.userId, true); if (view === 'group') groupView(); },
    'sos-cancel': (id) => { map?.setSos(id, false); if (view === 'group') groupView(); },
    group: () => { renderChips(); if (view === 'group') groupView(); },
    speaking: () => { if (view === 'group') groupView(); },
    talking: () => { if (view === 'group') groupView(); },
    conn: renderChips, gps: renderChips, weather: () => view === 'map' && updateMapView(),
    arrived: (d) => snackbar(`You’ve arrived at ${engine.short(d.name)}`, { action: { label: 'End ride', run: confirmEnd }, ms: 10000 }),
    ride: (r) => { if (!r && current()?.name === 'ride') tab('home'); },
  });
  const staleT = setInterval(() => map?.markStale(STALE), 15000);
  if (ctx.gps === 'denied') setTimeout(() => import('../state.js').then(({ emit }) => emit('banner', { tone: 'warn', icon: 'location_off', title: 'Location access is off', sub: 'Needed for navigation and ride tracking', sticky: true })), 400);
  return () => { clearInterval(tickT); clearInterval(staleT); offs(); controls.cleanup?.(); map?.destroy(); };
});

// ---------------------------------------------------------------- full-screen map
register('ridemap', (el, params) => {
  const mapEl = h('div', { class: 'map' });
  const top = h('div', { class: 'fs-top' });
  const bannerHost = h('div', { 'data-banner-host': '', style: 'width:100%' });
  const recenter = iconButton('my_location', { label: 'Centre on me', style: 'surface', onclick: () => { if (ctx.pos) { map.setFollow(true); map.centerOn(ctx.pos.lng, ctx.pos.lat, 16); } } });
  const fit = iconButton('fit_screen', { label: 'Show everyone', style: 'surface', onclick: () => { map.setFollow(false); map.fitAll(); } });
  const closeBtn = iconButton('close_fullscreen', { label: 'Close full screen', style: 'surface', onclick: back });
  const panel = h('div', { class: 'ride-panel' });
  const fabs = h('div', { class: 'map-fab stack gap12' }, closeBtn, fit, recenter);
  el.append(mapEl, top, fabs, panel);
  const map = new RideMap(mapEl, { zoom: 16, onFollowChange: (f) => recenter.classList.toggle('filled', f) });
  map.init();
  if (params.focus) { map.follow = false; map.centerOn(params.focus.lng, params.focus.lat, 16); }
  if (ctx.ride?.route) { map.setRoutes([ctx.ride.route], 0, { fit: false, labels: false }); map.setDestination(ctx.ride.dest.lng, ctx.ride.dest.lat); }
  if (ctx.ride) map.setTrack(ctx.ride.points);
  if (ctx.pos) map.setMe(ctx.pos);
  for (const l of ctx.locs.values()) map.upsertRider(l, { sos: ctx.sos.has(l.userId) });

  let controls = null;
  const renderTop = () => {
    const ns = engine.navState();
    top.replaceChildren(...[maneuverCard(ns), connChip(), bannerHost].filter(Boolean));
  };
  const renderPanel = () => {
    controls?.cleanup?.();
    const ns = engine.navState();
    controls = ctx.ride ? rideControls({ onRiders: () => { store.set('hubView', 'group'); back(); } }) : null;
    panel.replaceChildren(
      h('div', { class: 'eta' },
        h('div', { class: 'main' }, ns ? h('span', { class: 'headline-m' }, fmtEta(ns.secs)) : h('span', { class: 'headline-s' }, ctx.ride ? `${fmtKm(ctx.ride.dist)} km ridden` : ctx.group ? ctx.group.name : 'Map'),
          h('span', { class: 'body-m variant' }, ns ? `${fmtKm(ns.remaining)} km left · Arrive ${arriveAt(ns.secs)}` : ctx.group ? `${engine.onlineRiders().length} riding now` : 'No ride in progress')),
        h('div', { class: 'speed-bubble' }, h('b', { class: 'tabular' }, String(speedKmh())), h('span', { class: 'body-s' }, 'km/h'))),
      controls);
    requestAnimationFrame(() => (fabs.style.bottom = `${panel.offsetHeight + 24}px`));
  };
  renderTop(); renderPanel();
  const offs = onMany({
    pos: (p) => { map.setMe(p); const b = panel.querySelector('.speed-bubble b'); if (b) b.textContent = speedKmh(); },
    nav: () => { renderTop(); const ns = engine.navState(); if (ns) { panel.querySelector('.eta .main').firstChild.textContent = fmtEta(ns.secs); } },
    track: (pts) => map.setTrack(pts),
    route: (r) => map.setRoutes([r], 0, { fit: false, labels: false }),
    loc: (l) => map.upsertRider(l, { sos: ctx.sos.has(l.userId) }),
    'rider-left': (id) => map.removeRider(id),
    sos: (a) => map.setSos(a.userId, true),
    'sos-cancel': (id) => map.setSos(id, false),
    conn: renderTop, group: renderPanel,
  });
  const staleT = setInterval(() => map.markStale(STALE), 15000);
  return () => { offs(); clearInterval(staleT); controls?.cleanup?.(); map.destroy(); };
});

// ---------------------------------------------------------------- SOS countdown
register('sos', (el) => {
  el.classList.add('sos-screen');
  el.dataset.blockBack = '1';
  const SECS = 5;
  let left = SECS, sent = false;
  const num = h('span', { class: 'count tabular' }, String(left));
  const r = ring(1, { size: 200, stroke: 14, center: num });
  const title = h('h1', { class: 'headline-s' }, 'Sending SOS');
  const desc = h('p', { class: 'title-l' }, `Alerting your group in ${left} s`);
  const note = h('p', { class: 'body-m' }, ctx.group ? 'Your group gets your live location. Tap below if you’re OK.' : 'You’re not in a group, so call one of your contacts below.');
  const contacts = h('div', { class: 'sos-contacts' });
  const cancel = button('I’m OK, cancel', { size: 'large', wide: true, icon: 'check_circle' });
  const sendNow = button('Send now', { size: 'large', wide: true, style: 'on-error-cont' });
  el.append(h('div', { class: 'screen-body' }, ic('sos', { size: 40 }), title, r, desc, note, contacts), h('div', { class: 'screen-foot stack gap8' }, cancel, sendNow));
  requestAnimationFrame(() => r.set(0));
  r.querySelector('.bar').style.transitionDuration = `${SECS}s`;

  const renderContacts = () => {
    const p = ctx.pos;
    const link = p ? `https://www.openstreetmap.org/?mlat=${p.lat.toFixed(5)}&mlon=${p.lng.toFixed(5)}#map=17/${p.lat.toFixed(5)}/${p.lng.toFixed(5)}` : '';
    const body = encodeURIComponent(`SOS from ${ctx.user.name} on Rylaide. I need help.${link ? ` My location: ${link}` : ''}`);
    contacts.replaceChildren(...ctx.contacts.map((c) => h('div', { class: 'row gap8' },
      h('a', { class: 'btn on-error-cont grow', href: `tel:${c.phone}` }, ic('call', { size: 18 }), `Call ${c.name}`),
      h('a', { class: 'btn on-error-cont', href: `sms:${c.phone}?&body=${body}`, 'aria-label': `Text ${c.name}` }, ic('sms', { size: 18 })))),
      h('a', { class: 'btn on-error-cont', href: 'tel:112' }, ic('emergency', { size: 18 }), 'Call 112'));
  };
  const send = () => {
    if (sent) return;
    sent = true;
    clearInterval(t);
    const ok = engine.sendSos();
    vibrate([500, 200, 500]);
    title.textContent = ok ? 'Help on the way' : 'Call for help';
    r.replaceWith(h('span', { class: 'avatar', style: 'width:120px;height:120px;background:#ba1a1a;color:#fff' }, ic('sos', { size: 56 })));
    desc.textContent = ok ? 'Your group has your location' : ctx.group ? 'Couldn’t reach your group' : 'No group to alert';
    note.textContent = ok ? 'They see you on their map. Call someone below if you can.' : 'You’re offline or riding solo. Call a contact or 112.';
    renderContacts();
    sendNow.remove();
    cancel.lastChild.textContent = 'I’m safe, cancel SOS';
  };
  const t = setInterval(() => {
    left--;
    num.textContent = String(left);
    desc.textContent = `Alerting your group in ${left} s`;
    vibrate(80);
    if (left <= 0) send();
  }, 1000);
  cancel.onclick = () => {
    clearInterval(t);
    if (sent) { engine.cancelSos(); snackbar('SOS cancelled. Your group knows you’re safe.'); }
    el.dataset.blockBack = '0';
    back();
  };
  sendNow.onclick = send;
  setTimeout(() => { const top = current(); if (top?.name === 'sos') top.onBackBlocked = () => snackbar('Tap “I’m OK, cancel” to leave this screen.'); }, 0);
  return () => clearInterval(t);
});

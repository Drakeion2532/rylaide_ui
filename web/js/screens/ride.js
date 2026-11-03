// Copyright (c) 2026 Shubhan Punde · https://github.com/Drakeion2532/rylaide_ui · All rights reserved · sp2532-ce395384fbda
// 25r Ride hub (Map · Speed · Group) · 25u with pillion (Map · Speed · Pillion) · 25 Full-screen map · 30 SOS countdown
import { h, fmtDist, fmtKm, fmtEta, haversine, store, vibrate } from '../util.js';
import { ctx, onMany } from '../state.js';
import { ic, button, iconButton, avatar, connectionStatus, segmented, rideControl, switchEl, ring, dialog, snackbar, sheet, listItem, voiceGuideButton, VOICE_MODES } from '../ui.js';
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
  const mic = micToggle();
  const sos = rideControl({ type: 'sos', icon: 'SOS', label: 'SOS', hold: 1500, cls: 'sos-ctl', onHold: () => push('sos', {}, { anim: 'up' }), onclick: () => snackbar('Hold SOS for 1.5 seconds to alert your group.') });
  const el = h('div', { class: 'ride-controls' }, riders, mic, sos);
  const offs = onMany({
    group: () => { const n = engine.onlineRiders().length; if (ctx.group) riders.setState({ label: `${n} ${n === 1 ? 'rider' : 'riders'}` }); },
    speaking: (who) => mic.classList.toggle('hearing', !!who),
  });
  el.cleanup = () => { offs(); mic.cleanup(); };
  return el;
}

/**
 * Mic: open the whole group ride, so riders never take a hand off the bar or reach for the helmet.
 * One tap mutes, one tap unmutes, and the choice is kept for the next ride.
 */
function micToggle() {
  const ctl = rideControl({ type: 'mic-off', icon: 'mic_off', label: 'Mic off', cls: 'mic-ctl' });
  const look = () => {
    const s = engine.micState();
    const [type, icon, label] = {
      off: ['mic-off', 'mic_off', ctx.ride?.solo || !ctx.group ? 'Mic off' : 'Voice off'],
      muted: ['mic-muted', 'mic_off', 'Muted'],
      starting: ['mic', 'mic', 'Mic on'],
      live: ['mic', 'mic', ctx.talking ? 'Talking' : 'Mic on'],
      error: ['mic-off', 'mic_off', 'No mic'],
    }[s];
    ctl.setState({ type, icon, label });
    ctl.dataset.mic = s;
    ctl.setAttribute('aria-pressed', String(s === 'muted'));
    ctl.setAttribute('aria-label', s === 'muted' ? 'Unmute mic' : s === 'live' || s === 'starting' ? 'Mute mic' : label);
    ctl.classList.toggle('live', s === 'live' && !!ctx.talking);
  };
  ctl.addEventListener('click', () => {
    engine.live.unlock(); engine.player.unlock();
    const s = engine.micState();
    if (!ctx.ride || ctx.ride.solo || !ctx.group) return snackbar('Voice works on group rides.');
    if (s === 'off') { engine.setVoiceOn(true); return snackbar('Voice chat on. Your group can hear you.'); }
    if (s === 'error') { engine.syncVoice(); return; }
    engine.setMicMuted(s !== 'muted');
    snackbar(ctx.micMuted ? 'Mic muted. You can still hear your group.' : 'Mic on. Just talk, your group hears you.');
  });
  look();
  ctl.cleanup = onMany({ mic: look, talking: look, ride: look, group: look });
  return ctl;
}

function connChip() {
  // Offline but nearby riders reached directly phone-to-phone (Android app): voice keeps working.
  if (ctx.conn !== 'internet' && ctx.mesh?.peers > 0) return connectionStatus('nearby', true);
  const state = ctx.conn === 'internet' && ctx.group && engine.onlineRiders().length > 1 ? 'connected' : ctx.conn;
  return connectionStatus(state === 'internet' ? 'internet' : state, true);
}

/** Map turns with you (heading up, like Google Maps) or stays north up. One tap switches; remembered. */
function compassButton(getMap) {
  const btn = h('button', { type: 'button', class: 'icon-btn surface compass-btn' });
  const look = () => {
    const on = engine.mapTurns();
    btn.replaceChildren(ic(on ? 'navigation' : 'explore', { fill: on }));
    btn.classList.toggle('on', on);
    btn.dataset.mapTurns = String(on);
    btn.setAttribute('aria-label', on ? 'Map turns with you. Tap for north up' : 'North up. Tap so the map turns with you');
    btn.setAttribute('aria-pressed', String(on));
  };
  btn.onclick = async () => {
    const on = !engine.mapTurns();
    await engine.setMapTurns(on);
    if (on) { const m = getMap(); if (m && ctx.pos) { m.setFollow(true); m.centerOn(ctx.pos.lng, ctx.pos.lat, 16); } }
    snackbar(on ? 'Map turns with you' : 'North up', { ms: 2000 });
  };
  look();
  btn.cleanup = onMany({ 'map-turns': look });
  return btn;
}

/** 25q: log a fuel stop mid-ride. */
function refillSheet() {
  sheet((close) => {
    const litres = h('input', { type: 'number', inputmode: 'decimal', min: 0.1, step: '0.01', placeholder: ' ', name: 'litres' });
    const price = h('input', { type: 'number', inputmode: 'decimal', min: 0, step: '0.01', placeholder: ' ', name: 'price', value: store.get('lastPrice', '') });
    let full = true;
    const err = h('p', { class: 'body-s', style: 'color:var(--error);margin:0' });
    const go = button('Save refill', { size: 'large', wide: true, type: 'submit' });
    return h('form', { class: 'stack gap16', onsubmit: async (e) => {
      e.preventDefault();
      go.disabled = true;
      try {
        await engine.logRefill({ litres: litres.value, pricePerLitre: price.value, full });
        store.set('lastPrice', price.value);
        close(); snackbar(`Refill saved to ${ctx.user?.vehicle?.model || 'your bike'}’s fuel log`);
      } catch (x) { err.textContent = x.message; go.disabled = false; }
    } }, h('h2', { class: 'headline-s' }, 'Log a refill'),
      h('div', { class: 'row gap12' }, h('label', { class: 'field on-surface grow' }, litres, h('label', {}, 'Litres')), h('label', { class: 'field on-surface grow' }, price, h('label', {}, 'Price per litre (₹)'))),
      listItem({ title: 'Filled to full tank', sub: 'Needed to work out mileage', trail: switchEl({ checked: true, label: 'Filled to full tank', onchange: (v) => (full = v) }), cls: 'switch-row' }),
      err, go);
  });
}

async function confirmEnd() {
  if (!(await dialog({ title: 'End this ride?', body: 'Your route, time and speed are saved to History.', confirm: 'End ride' }))) return;
  const r = await engine.endRide();
  if (r?.tooShort) { snackbar('Ride was too short to save.'); tab('home'); return; }
  if (r) push('summary', { ride: r, justEnded: true }, { replace: true });
}

/** Speedometer (Figma: 29 gauge) with distance / average / top tiles. */
function speedGauge() {
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
  const gauge = h('div', { class: 'gauge' }, svg, h('div', { class: 'readout' }, num, h('span', { class: 'title-m variant' }, 'km/h')));
  gauge.set = (v) => { num.textContent = String(v); val.setAttribute('stroke-dashoffset', 100 - Math.min(100, (v / 160) * 100)); val.style.opacity = v > 0 ? 1 : 0; gauge.classList.toggle('over', v > 80); };
  const stats = h('div', { class: 'speed-stats' });
  gauge.stats = () => {
    const r = ctx.ride, el2 = (Date.now() - r.startedAt) / 1000;
    stats.replaceChildren(
      h('div', { class: 'stat tile' }, h('div', { class: 'v' }, h('span', { class: 'ride-metric' }, fmtKm(r.dist)), h('span', { class: 'u' }, 'km')), h('span', { class: 'l' }, 'Distance')),
      h('div', { class: 'stat tile' }, h('div', { class: 'v' }, h('span', { class: 'ride-metric' }, String(Math.round(el2 > 0 ? (r.dist / el2) * 3.6 : 0))), h('span', { class: 'u' }, 'km/h')), h('span', { class: 'l' }, 'Average')),
      h('div', { class: 'stat tile' }, h('div', { class: 'v' }, h('span', { class: 'ride-metric' }, String(Math.round(r.maxSpeed * 3.6))), h('span', { class: 'u' }, 'km/h')), h('span', { class: 'l' }, 'Top')));
  };
  gauge.statsEl = stats;
  return gauge;
}

// ---------------------------------------------------------------- ride hub
register('ride', (el) => {
  if (!ctx.ride) { setTimeout(() => tab('home'), 0); return; }
  // 25r group (Map · Speed · Group) · 25t solo (Map · Speed) · 25u pillion (Map · Speed · Pillion) · 25q quick (Map · Speed)
  const third = ctx.ride.quick ? null : ctx.ride.pillion && ctx.ride.solo ? 'pillion' : ctx.ride.solo ? null : 'group';
  let view = store.get('hubView', 'map');
  if (view === 'group' || view === 'pillion') view = third || 'map';
  let map = null;
  const timer = h('span', { class: 'title-l tabular' });
  const chips = h('div', { class: 'hub-chips' });
  const nc = () => h('button', { type: 'button', class: `status compact ${ctx.noiseCancel ? 'accent' : 'neutral'}`, style: 'border:0', 'aria-pressed': String(ctx.noiseCancel), onclick: () => { engine.setNoiseCancel(!ctx.noiseCancel); renderChips(); snackbar(`Noise cancel ${ctx.noiseCancel ? 'on' : 'off'}`); } }, ic('noise_control_off'), `Noise cancel ${ctx.noiseCancel ? 'on' : 'off'}`);
  const renderChips = () => chips.replaceChildren(connChip(), nc(), refillBtn(), ctx.gps === 'denied' ? h('span', { class: 'status compact warn' }, ic('location_off'), 'Location off') : ctx.gps === 'weak' ? h('span', { class: 'status compact warn' }, ic('gps_not_fixed'), 'Weak GPS') : null);
  const more = iconButton('more_vert', { label: 'Ride options', onclick: () => sheet((close) => h('div', { class: 'list' },
    h('div', { style: 'padding:4px 0 12px' }, h('div', { class: 'title-s', style: 'padding:0 4px 8px' }, 'Voice guidance'),
      segmented(VOICE_MODES.map((m) => ({ value: m.value, label: m.label })), engine.voiceGuide(), (v) => engine.setVoiceGuide(v), { label: 'Voice guidance' })),
    listItem({ icon: 'campaign', title: 'Voice chat', sub: 'Talk and hear your group, hands-free', trail: switchEl({ checked: ctx.voiceOn, label: 'Voice chat', onchange: (v) => { engine.setVoiceOn(v); render(); } }) }),
    listItem({ icon: 'forum', title: 'Group chat', onclick: () => { close(); if (ctx.group) push('group', { id: ctx.group.id }); } }),
    listItem({ icon: 'local_gas_station', title: 'Log a refill', sub: 'Goes into this bike’s fuel log', onclick: () => { close(); refillSheet(); } }),
    listItem({ icon: 'stop_circle', title: 'End ride', onclick: () => { close(); confirmEnd(); } }))) });
  const end = button('End ride', { style: 'danger-outlined', icon: 'stop_circle', onclick: confirmEnd });
  const refillBtn = () => h('button', { type: 'button', class: 'status compact neutral', style: 'border:0', 'data-refill': '', onclick: refillSheet }, ic('local_gas_station'), ctx.ride?.refills?.length ? `Refills ${ctx.ride.refills.length}` : 'Log refill');
  const seg = segmented([{ value: 'map', label: 'Map' }, { value: 'speed', label: 'Speed' }, third === 'pillion' ? { value: 'pillion', label: 'Pillion' } : third === 'group' ? { value: 'group', label: 'Group' } : null].filter(Boolean), view, (v) => { view = v; store.set('hubView', v); render(); }, { label: 'Ride view' });
  const content = h('div', { class: 'hub-content' });
  const bannerHost = h('div', { 'data-banner-host': '', style: 'padding:0 16px' });
  const onRiders = () => { if (third === 'group') { seg.set(third); view = third; render(); } else push('ridegroup'); };
  let controls = rideControls({ onRiders });
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
  let speedBubble = null, maneuverSlot = null, strip = null, gauge = null, cardCompass = null;
  const mapView = () => {
    const mapEl = h('div', { class: 'map' });
    maneuverSlot = h('div');
    speedBubble = h('div', { class: 'speed-bubble', 'aria-label': 'Speed' }, h('b', { class: 'tabular' }, '0'), h('span', { class: 'body-s' }, 'km/h'));
    const vg = voiceGuideButton({ getMode: engine.voiceGuide, setMode: engine.setVoiceGuide });
    cardCompass?.cleanup();
    cardCompass = compassButton(() => map);
    const card = h('div', { class: 'map-card' }, mapEl, maneuverSlot, speedBubble, h('div', { class: 'vg-on-card stack gap12' }, vg, cardCompass),
      h('button', { type: 'button', class: 'btn fs-btn', onclick: () => push('ridemap') }, ic('open_in_full'), 'Full screen'));
    strip = h('div', { class: 'trip-strip' });
    content.replaceChildren(card, strip);
    map = new RideMap(mapEl, { zoom: 16, onFollowChange: () => {} });
    const m = map;
    m.init().then(() => m.resize()); // map may already be replaced if the rider switched views
    m.setHeadingUp(engine.mapTurns());
    if (ctx.heading) m.setHeading(ctx.heading.deg);
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
    gauge = speedGauge();
    const ns = engine.navState();
    content.replaceChildren(h('div', { class: 'speed-view' }, ns ? maneuverCard(ns) : null, gauge,
      h('div', { class: 'row gap8' }, h('span', { class: 'tag' }, 'Over 80 km/h turns amber'), h('button', { type: 'button', class: 'btn tonal', style: 'height:32px', onclick: () => push('ridegauge') }, ic('open_in_full', { size: 18 }), 'Full screen')), gauge.statsEl));
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
      const speaking = engine.isSpeaking(m.id);
      let sub = me ? (speaking ? 'Talking' : ctx.micMuted && ctx.voiceOn ? 'Muted' : ctx.voiceOn ? 'Mic on' : 'Voice off') : !m.online ? 'Disconnected' : speaking ? 'Speaking' : ctx.voiceOn ? 'Listening' : 'Connected';
      if (!me && loc && ctx.pos) { const d = haversine([ctx.pos.lat, ctx.pos.lng], [loc.lat, loc.lng]); sub += ` · ${fmtDist(d).replace('now', 'with you')}${d >= 50 ? ' away' : ''}`; }
      if (ctx.sos.has(m.id)) sub = 'SOS · needs help';
      return h('div', { class: `rider-row${ctx.sos.has(m.id) ? ' selected' : ''}` },
        avatar(me ? `${ctx.user.name}` : m.name, { status: ctx.sos.has(m.id) ? 'off' : speaking ? 'speaking' : me || m.online ? 'connected' : 'off', size: 'l', accent: me }),
        h('span', { class: 'main' }, h('span', { class: 'body-l' }, me ? 'You' : m.name), h('span', { class: 'body-m variant' }, sub)),
        loc && !me ? iconButton('my_location', { label: `Show ${m.name} on the map`, onclick: () => push('ridemap', { focus: loc }) }) : null);
    };
    content.replaceChildren(h('div', { class: 'screen-body', style: 'margin:0 -16px;padding:0 16px' },
      h('div', { class: 'row', style: 'justify-content:space-between;padding:4px 0 12px' }, h('span', { class: 'title-s variant' }, 'In this ride'),
        h('button', { type: 'button', class: 'btn tonal', style: 'height:40px', onclick: () => push('ridegroup') }, ic('open_in_full', { size: 18 }), 'Full screen')),
      h('div', { class: 'list' }, riders.map(row)),
      h('div', { class: 'row gap8 body-s variant', style: 'padding:16px 4px' }, ic('two_wheeler', { size: 16 }), `${g.name} · ${riders.length} ${riders.length === 1 ? 'rider' : 'riders'}`),
      h('div', { class: 'list' }, listItem({ icon: 'campaign', title: 'Voice chat', sub: !ctx.voiceOn ? 'Off · you won’t hear your group' : ctx.micMuted ? 'On · you’re muted, you still hear your group' : 'On · just talk, your group hears you', trail: switchEl({ checked: ctx.voiceOn, label: 'Voice chat', onchange: (v) => { engine.setVoiceOn(v); render(); } }) }))));
  };

  // 25u Pillion: who's on the back, break reminders, comfort
  const pillionView = () => {
    const r = ctx.ride;
    const name = store.get('pillionName', '');
    const mins = Math.max(0, Math.round((r.nextBreak - Date.now()) / 60000));
    const ridden = Math.round((Date.now() - r.startedAt) / 60000);
    const nameIn = h('input', { value: name, placeholder: 'Pillion’s name', maxlength: 30, 'aria-label': 'Pillion’s name', class: 'inline-input', onchange: (e) => store.set('pillionName', e.target.value.trim()) });
    content.replaceChildren(h('div', { class: 'screen-body', style: 'margin:0 -16px;padding:0 16px' },
      h('div', { class: 'list' },
        h('div', { class: 'rider-row' }, avatar(ctx.user.name, { status: 'connected', size: 'l', accent: true }), h('span', { class: 'main' }, h('span', { class: 'body-l' }, 'You'), h('span', { class: 'body-m variant' }, 'Riding'))),
        h('div', { class: 'rider-row' }, avatar(name || 'P', { status: 'connected', size: 'l' }), h('span', { class: 'main' }, nameIn, h('span', { class: 'body-m variant' }, 'Pillion · on the back')))),
      h('div', { class: 'break-card mt16' },
        h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' },
          h('div', {}, h('div', { class: 'label-m variant' }, 'Next break'), h('div', { class: 'ride-metric' }, mins ? `in ${mins} min` : 'now')),
          h('div', { style: 'text-align:right' }, h('div', { class: 'label-m variant' }, 'Riding for'), h('div', { class: 'title-l' }, `${ridden} min`))),
        h('div', { class: 'progress-linear', style: 'margin-top:12px' }, h('i', { style: `width:${Math.min(100, 100 - (mins / store.get('breakMins', 45)) * 100)}%` })),
        h('div', { class: 'row gap8 mt16' },
          button('Taking a break', { style: 'tonal', icon: 'free_breakfast', onclick: () => { engine.snoozeBreak(store.get('breakMins', 45)); snackbar('Break logged. Next reminder set.'); render(); } }),
          button('+15 min', { style: 'text', onclick: () => { engine.snoozeBreak(Math.max(15, mins + 15)); render(); } }))),
      h('div', { class: 'list mt16' },
        listItem({ icon: 'headset_mic', title: 'Talk to your pillion', sub: 'Pair both helmet headsets with each other over Bluetooth (rider-to-pillion mode). Rylaide’s voice prompts play in yours.' }),
        listItem({ icon: 'speed', title: 'Smooth riding', sub: 'Brake and accelerate gently, and warn before bumps. Two up, braking takes longer.' }))));
  };

  const render = () => {
    map?.destroy(); map = null; strip = null; gauge = null;
    controls.cleanup?.();
    const fresh = rideControls({ onRiders });
    controls.replaceWith(fresh); controls = fresh;
    renderChips();
    ({ map: mapView, speed: speedView, group: groupView, pillion: pillionView })[view]();
  };
  render();

  const offs = onMany({
    pos: (p) => { map?.setMe(p); if (speedBubble && strip) speedBubble.querySelector('b').textContent = speedKmh(); if (gauge) { gauge.set(speedKmh()); gauge.stats(); } },
    nav: () => { if (view === 'map') updateMapView(); },
    'ride-tick': () => { if (view === 'map') updateMapView(); },
    break: () => { if (view === 'pillion') render(); },
    refill: renderChips,
    track: (pts) => map?.setTrack(pts),
    heading: (hd) => map?.setHeading?.(hd.deg),
    'map-turns': (on) => map?.setHeadingUp?.(on),
    route: (r) => map?.setRoutes([r], 0, { fit: false, labels: false }),
    loc: (l) => { map?.upsertRider(l, { sos: ctx.sos.has(l.userId) }); if (view === 'group') groupView(); },
    'rider-left': (id) => map?.removeRider(id),
    sos: (a) => { map?.setSos(a.userId, true); if (view === 'group') groupView(); },
    'sos-cancel': (id) => { map?.setSos(id, false); if (view === 'group') groupView(); },
    group: () => { renderChips(); if (view === 'group') groupView(); },
    speaking: () => { if (view === 'group') groupView(); },
    talking: () => { if (view === 'group') groupView(); },
    mic: () => { if (view === 'group') groupView(); },
    conn: renderChips, mesh: renderChips, gps: renderChips, weather: () => view === 'map' && updateMapView(),
    ride: (r) => { if (!r && current()?.name === 'ride') tab('home'); },
  });
  const staleT = setInterval(() => map?.markStale(STALE), 15000);
  if (ctx.gps === 'denied') setTimeout(() => import('../state.js').then(({ emit }) => emit('banner', { tone: 'warn', icon: 'location_off', title: 'Location access is off', sub: 'Needed for navigation and ride tracking', sticky: true })), 400);
  return () => { clearInterval(tickT); clearInterval(staleT); offs(); controls.cleanup?.(); cardCompass?.cleanup(); map?.destroy(); };
});

// ---------------------------------------------------------------- full-screen map
register('ridemap', (el, params) => {
  const mapEl = h('div', { class: 'map' });
  const top = h('div', { class: 'fs-top' });
  const bannerHost = h('div', { 'data-banner-host': '', style: 'width:100%' });
  const recenter = iconButton('my_location', { label: 'Centre on me', style: 'surface', onclick: () => { if (ctx.pos) { map.setFollow(true); map.centerOn(ctx.pos.lng, ctx.pos.lat, 16); } } });
  const fit = iconButton('fit_screen', { label: 'Show everyone', style: 'surface', onclick: () => { map.setFollow(false); map.fitAll(); } });
  const closeBtn = iconButton('close_fullscreen', { label: 'Close full screen', style: 'surface', onclick: back });
  const vg = voiceGuideButton({ getMode: engine.voiceGuide, setMode: engine.setVoiceGuide });
  const compass = compassButton(() => map);
  const panel = h('div', { class: 'ride-panel' });
  const fabs = h('div', { class: 'map-fab stack gap12' }, closeBtn, vg, compass, fit, recenter);
  el.append(mapEl, top, fabs, panel);
  const map = new RideMap(mapEl, { zoom: 16, onFollowChange: (f) => recenter.classList.toggle('filled', f) });
  map.init();
  map.setHeadingUp(engine.mapTurns() && !params.focus);
  if (ctx.heading) map.setHeading(ctx.heading.deg);
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
    requestAnimationFrame(() => { fabs.style.bottom = `${panel.offsetHeight + 24}px`; map.setPadBottom(panel.offsetHeight + 8); });
  };
  renderTop(); renderPanel();
  const offs = onMany({
    pos: (p) => { map.setMe(p); const b = panel.querySelector('.speed-bubble b'); if (b) b.textContent = speedKmh(); },
    nav: () => { renderTop(); const ns = engine.navState(); if (ns) { panel.querySelector('.eta .main').firstChild.textContent = fmtEta(ns.secs); } },
    track: (pts) => map.setTrack(pts),
    heading: (hd) => map.setHeading(hd.deg),
    'map-turns': (on) => map.setHeadingUp(on),
    route: (r) => map.setRoutes([r], 0, { fit: false, labels: false }),
    loc: (l) => map.upsertRider(l, { sos: ctx.sos.has(l.userId) }),
    'rider-left': (id) => map.removeRider(id),
    sos: (a) => map.setSos(a.userId, true),
    'sos-cancel': (id) => map.setSos(id, false),
    conn: renderTop, group: renderPanel,
  });
  const staleT = setInterval(() => map.markStale(STALE), 15000);
  return () => { offs(); clearInterval(staleT); controls?.cleanup?.(); compass.cleanup(); map.destroy(); };
});

// ---------------------------------------------------------------- SOS countdown
register('sos', (el, params) => {
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
  if (params.now) setTimeout(send, 0); // from 30a crash detection: the countdown already ran
  return () => clearInterval(t);
});

// ---------------------------------------------------------------- 29 Full-screen speedometer
register('ridegauge', (el) => {
  if (!ctx.ride) { setTimeout(back, 0); return; }
  el.classList.add('fs-gauge');
  const gauge = speedGauge();
  const ns = h('div');
  const controls = rideControls({ onRiders: () => push('ridegroup') });
  el.append(h('div', { class: 'fs-head' }, iconButton('close_fullscreen', { label: 'Close full screen', style: 'tonal', onclick: back }), h('span', { class: 'title-m' }, 'Speed'), h('span', { style: 'width:48px' })),
    ns, h('div', { class: 'fs-gauge-body' }, gauge), gauge.statsEl, h('div', { style: 'padding:0 16px calc(16px + var(--safe-b))' }, controls));
  const tick = () => { gauge.set(speedKmh()); gauge.stats(); ns.replaceChildren(maneuverCard(engine.navState()) || ''); };
  tick();
  const offs = onMany({ pos: tick, nav: tick, 'ride-tick': tick, ride: (r) => { if (!r) back(); } });
  return () => { offs(); controls.cleanup?.(); };
});

// ---------------------------------------------------------------- 28 Full-screen group
register('ridegroup', (el) => {
  const g = ctx.ride?.solo ? null : ctx.group;
  const list = h('div', { class: 'list' });
  const controls = ctx.ride ? rideControls({ onRiders: () => {} }) : null;
  el.append(h('header', { class: 'topbar' }, iconButton('close_fullscreen', { label: 'Close full screen', onclick: back }), h('h1', { class: 'title title-l' }, g ? g.name : 'Riders'),
    iconButton('map', { label: 'Show riders on the map', onclick: () => push('ridemap') })),
  h('div', { class: 'screen-body pad' }, list), controls ? h('div', { style: 'padding:0 16px calc(16px + var(--safe-b))' }, controls) : null);
  const render = () => {
    if (!g) { list.replaceChildren(h('div', { class: 'empty' }, ic('person'), h('p', { class: 'body-m' }, 'Solo ride: your location stays private.'))); return; }
    const rows = [...g.members].sort((a, b) => (a.id === ctx.user.id ? -1 : b.id === ctx.user.id ? 1 : (b.online - a.online)));
    list.replaceChildren(...rows.map((m) => {
      const me = m.id === ctx.user.id, loc = ctx.locs.get(m.id);
      const speaking = engine.isSpeaking(m.id);
      const spd = me ? (ctx.pos?.speed || 0) : (loc?.speed || 0);
      const dist = !me && loc && ctx.pos ? haversine([ctx.pos.lat, ctx.pos.lng], [loc.lat, loc.lng]) : null;
      return h('div', { class: `rider-row big${ctx.sos.has(m.id) ? ' selected' : ''}` },
        avatar(me ? ctx.user.name : m.name, { status: ctx.sos.has(m.id) ? 'off' : speaking ? 'speaking' : me || m.online ? 'connected' : 'off', size: 'l', color: m.color }),
        h('span', { class: 'main' }, h('span', { class: 'title-m' }, me ? 'You' : m.name),
          h('span', { class: 'body-m variant' }, ctx.sos.has(m.id) ? 'SOS · needs help' : [speaking ? 'Speaking' : m.online || me ? 'Connected' : 'Disconnected', dist != null ? `${fmtDist(dist).replace('now', 'with you')}${dist >= 50 ? ' away' : ''}` : null].filter(Boolean).join(' · '))),
        h('span', { class: 'speed-chip' }, h('b', { class: 'tabular' }, String(Math.round(spd * 3.6))), h('span', { class: 'body-s' }, 'km/h')));
    }));
  };
  render();
  const offs = onMany({ loc: render, group: render, speaking: render, talking: render, sos: render, 'sos-cancel': render, pos: render });
  return () => { offs(); controls?.cleanup?.(); };
});

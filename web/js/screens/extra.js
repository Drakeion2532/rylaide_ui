// Copyright (c) 2026 Shubhan Punde · https://github.com/Drakeion2532/rylaide_ui · All rights reserved · sp2532-ce395384fbda
// 30a Possible crash detected · 32 Arrived · 16 Nearby · 22e Drop a pin
import { h, fmtKm, durShort, haversine, vibrate } from '../util.js';
import { api } from '../api.js';
import { ctx, emit } from '../state.js';
import { ic, button, iconButton, ring, snackbar, sheet, field, withLoading, checkbox, avatar } from '../ui.js';
import { register, push, back, tab, current } from '../router.js';
import { RideMap } from '../map.js';
import * as engine from '../engine.js';

// ---------------------------------------------------------------- 30a Possible crash detected
// Figma: red screen, 30 s ring countdown, “I’m OK, cancel”. An alarm sounds so people nearby can find the rider.
register('crash', (el, params) => {
  el.classList.add('sos-screen', 'crash-screen');
  el.dataset.blockBack = '1';
  const SECS = 30;
  let left = SECS, done = false;
  const num = h('span', { class: 'count tabular' }, String(left));
  const r = ring(1, { size: 200, stroke: 14, center: num });
  const title = h('h1', { class: 'headline-s' }, params.test ? 'Crash detection test' : 'Possible crash detected');
  const desc = h('p', { class: 'title-l' }, `Alerting your ${ctx.group ? 'group and ' : ''}emergency contacts in ${left} s`);
  const where = h('span', {}, '');
  const note = params.test ? h('p', { class: 'body-m' }, 'This is a test: nothing will be sent. In a real crash an alarm sounds so people nearby can find you.')
    : h('p', { class: 'body-m' }, `Hard stop${params.before ? ` from ${params.before} km/h` : ''}`, where, '. If you’re OK, tap below. An alarm will sound so people nearby can find you.');
  const cancel = button('I’m OK, cancel', { size: 'large', wide: true, icon: 'check_circle' });
  const sendNow = button('I need help now', { size: 'large', wide: true, style: 'on-error-cont' });
  el.append(h('div', { class: 'screen-body' }, ic('car_crash', { size: 40 }), title, r, desc, note), h('div', { class: 'screen-foot stack gap8' }, cancel, sendNow));
  requestAnimationFrame(() => { r.querySelector('.bar').style.transitionDuration = `${SECS}s`; r.set(0); });
  if (!params.test && ctx.pos) api.get(`/api/reverse?lat=${ctx.pos.lat}&lng=${ctx.pos.lng}`).then((p) => { if (!done) where.textContent = ` near ${engine.short(p.name)}`; }).catch(() => {});
  engine.speak(params.test ? 'Crash detection test.' : 'Possible crash detected. Tap I am OK if you are fine.', 'alert');
  if (!params.test) engine.toWatch('Possible crash detected', 'Tap “I’m OK” on your phone, or SOS goes to your group in 30 s', 'sos');

  // Alarm: rising beeps, louder in the last 10 seconds.
  let audio = null;
  const beep = (loud) => {
    try {
      if (done) return;
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), gn = audio.createGain();
      o.type = 'square'; o.frequency.value = loud ? 1320 : 880;
      gn.gain.value = params.test ? 0.03 : loud ? 0.4 : 0.15;
      o.connect(gn).connect(audio.destination);
      o.start(); o.stop(audio.currentTime + 0.18);
    } catch { /* no audio */ }
  };
  const finish = () => {
    done = true; clearInterval(t);
    const a = audio; audio = null; a?.close().catch(() => {});
    el.dataset.blockBack = '0';
  };
  const t = setInterval(() => {
    left--;
    num.textContent = String(Math.max(0, left));
    desc.textContent = `Alerting your ${ctx.group ? 'group and ' : ''}emergency contacts in ${Math.max(0, left)} s`;
    vibrate(left <= 10 ? 300 : 80);
    beep(left <= 10);
    if (left <= 0) fire();
  }, 1000);
  const fire = () => {
    if (done) return;
    finish();
    if (params.test) {
      title.textContent = 'Test finished';
      desc.textContent = 'In a real crash, SOS would go out now';
      note.textContent = 'Your group would see your location and you’d get call buttons for your emergency contacts and 112.';
      sendNow.remove(); cancel.lastChild.textContent = 'Done';
      cancel.onclick = back;
      return;
    }
    push('sos', { now: true, reason: 'crash' }, { replace: true, anim: 'up' });
  };
  cancel.onclick = () => { finish(); if (!params.test) snackbar('Glad you’re OK. Crash alert cancelled.'); back(); };
  sendNow.onclick = () => { left = 0; fire(); };
  setTimeout(() => { const top = current(); if (top?.name === 'crash') top.onBackBlocked = () => snackbar('Tap “I’m OK, cancel” to leave this screen.'); }, 0);
  return () => finish();
});

// ---------------------------------------------------------------- 32 Arrived
register('arrived', (el, params) => {
  const r = ctx.ride;
  if (!r) { setTimeout(back, 0); return; }
  const secs = (Date.now() - r.startedAt) / 1000;
  const avg = secs > 0 ? (r.dist / secs) * 3.6 : 0;
  const name = engine.short(params.dest?.name || r.dest?.name || 'your destination');
  el.classList.add('arrived-screen');
  el.append(
    h('div', { class: 'summary-hero', style: 'background-image:url(/img/ghat-road.jpg);min-height:46%' },
      h('div', { class: 'top' }, iconButton('close', { label: 'Back to the ride', onclick: back })),
      h('div', { class: 't' }, h('span', { class: 'label-l' }, ic('flag', { size: 18 }), ' You’ve arrived'), h('h1', { class: 'headline-l' }, name),
        r.groupName ? h('span', { class: 'body-l', style: 'color:var(--on-image-variant)' }, `with ${r.groupName}`) : null)),
    h('div', { class: 'summary-sheet' },
      h('div', { class: 'stat-row' },
        h('div', { class: 'stat tile' }, h('div', { class: 'v' }, h('span', { class: 'ride-metric' }, fmtKm(r.dist)), h('span', { class: 'u' }, 'km')), h('span', { class: 'l' }, 'Distance')),
        h('div', { class: 'stat tile' }, h('span', { class: 'ride-metric' }, durShort(secs)), h('span', { class: 'l' }, 'Time')),
        h('div', { class: 'stat tile' }, h('div', { class: 'v' }, h('span', { class: 'ride-metric' }, avg > 0 && avg < 250 ? String(Math.round(avg)) : '–'), h('span', { class: 'u' }, 'km/h')), h('span', { class: 'l' }, 'Average'))),
      h('p', { class: 'body-m variant', style: 'margin:16px 4px' }, ctx.group && !r.solo ? 'Your group sees you’ve arrived. End the ride to save it, or keep riding without directions.' : 'End the ride to save it to History, or keep riding without directions.'),
      h('div', { class: 'stack gap8', style: 'padding-bottom:calc(16px + var(--safe-b))' },
        button('End ride', { size: 'large', wide: true, icon: 'stop_circle', onclick: async () => {
          const s = await engine.endRide();
          if (s?.tooShort) { snackbar('Ride was too short to save.'); tab('home'); return; }
          if (s) { tab('home'); push('summary', { ride: s, justEnded: true }); }
        } }),
        button('Keep riding', { size: 'large', wide: true, style: 'tonal', icon: 'two_wheeler', onclick: () => { engine.keepRiding(); snackbar('Directions off. Your ride is still recording.'); back(); } }))));
  if (r.groupId) { /* the arrival line in chat helps the group */ import('../state.js').then(({ rt }) => rt.send({ t: 'chat', text: `Arrived at ${name}` })); }
});

// ---------------------------------------------------------------- 16 Nearby
register('nearby', (el, params) => {
  const picked = new Set();
  let riders = [], poll = null;
  const list = h('div', { class: 'list' });
  const status = h('p', { class: 'body-m variant', role: 'status', style: 'text-align:center;margin:0' }, 'Looking for riders within 500 m…');
  const go = button('Ride together', { size: 'large', wide: true, disabled: true, icon: 'groups' });
  el.append(
    h('header', { class: 'topbar' }, iconButton('arrow_back', { label: 'Back', onclick: back }), h('h1', { class: 'title title-l' }, 'Riders nearby')),
    h('div', { class: 'screen-body pad' },
      h('div', { class: 'radar', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('span', { class: 'me' }, ic('two_wheeler', { fill: true }))),
      status,
      h('p', { class: 'body-s variant', style: 'text-align:center;margin:4px 0 16px' }, 'Riders see each other only while this screen is open. Ask your friends to open Groups → Riders nearby.'),
      list),
    h('div', { class: 'screen-foot' }, go));
  const render = () => {
    go.disabled = !picked.size;
    go.lastChild.textContent = picked.size ? `Ride together (${picked.size + 1})` : 'Ride together';
    list.replaceChildren(...riders.map((r) => h('label', { class: 'list-item switch-row', style: 'cursor:pointer', 'data-rider': r.id },
      avatar(r.name, { color: r.color, status: 'connected' }),
      h('span', { class: 'main' }, h('span', { class: 'body-l' }, r.name), h('span', { class: 'body-m variant' }, r.distance < 20 ? 'Right here' : `${r.distance} m away`)),
      checkbox({ checked: picked.has(r.id), label: `Ride with ${r.name}`, onchange: (v) => { v ? picked.add(r.id) : picked.delete(r.id); render(); } }))));
  };
  const tick = async () => {
    if (!ctx.pos) { status.textContent = ctx.gps === 'denied' ? 'Turn on location to find riders nearby.' : 'Waiting for your location…'; return; }
    try {
      const d = await api.post('/api/nearby', { lat: ctx.pos.lat, lng: ctx.pos.lng });
      riders = d.riders;
      for (const id of [...picked]) if (!riders.some((r) => r.id === id)) picked.delete(id);
      status.textContent = riders.length ? `${riders.length} ${riders.length === 1 ? 'rider' : 'riders'} near you. Pick who you’re riding with.` : 'Nobody nearby yet. Keep this screen open.';
      render();
    } catch (e) { status.textContent = e.message; }
  };
  go.onclick = () => sheet((close) => {
    const name = field({ label: 'Group name', value: `Ride on ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, attrs: { maxlength: 40 }, onSurface: true });
    const ok = button('Make group', { size: 'large', wide: true, type: 'submit' });
    return h('form', { class: 'stack gap16', onsubmit: async (e) => {
      e.preventDefault();
      await withLoading(ok, async () => {
        try {
          const { group } = await api.post('/api/nearby/group', { riders: [...picked], name: name.input.value });
          if (!ctx.groups.some((g) => g.id === group.id)) ctx.groups.push(group);
          engine.openGroup(group); emit('groups', ctx.groups);
          close(); snackbar(`${group.name} is ready. Everyone’s in.`);
          if (params.fromSetup) back(); else push('group', { id: group.id }, { replace: true });
        } catch (err) { name.setError(err.message); }
      });
    } }, h('h2', { class: 'headline-s' }, 'Ride together'), h('p', { class: 'body-m variant', style: 'margin:0' }, `You and ${picked.size} ${picked.size === 1 ? 'rider' : 'riders'} join a new group. No code needed.`), name, ok);
  });
  tick();
  poll = setInterval(tick, 4000);
  return () => { clearInterval(poll); api.del('/api/nearby').catch(() => {}); };
});

// ---------------------------------------------------------------- 22e Drop a pin
register('pin', (el, params) => {
  const mapEl = h('div', { class: 'map' });
  const label = h('div', { class: 'title-m' }, 'Move the map to the place');
  const sub = h('div', { class: 'body-m variant' }, '');
  let place = null, t = null, seq = 0;
  const use = button('Use this place', { size: 'large', wide: true, icon: 'check', disabled: true, onclick: () => { const p = place; back(); params.onPick?.(p); } });
  el.append(mapEl,
    h('div', { class: 'pin-top' }, iconButton('arrow_back', { label: 'Back', style: 'surface', onclick: back }), h('div', { class: 'place-pill' }, ic('pin_drop', { fill: true }), h('span', {}, params.title || 'Choose on map'))),
    h('div', { class: 'pin-center', 'aria-hidden': 'true' }, ic('location_on', { fill: true, size: 48 })),
    h('div', { class: 'pin-sheet' }, h('div', { class: 'row gap12', style: 'align-items:flex-start' }, ic('location_on', { size: 24 }), h('div', { class: 'main', style: 'flex:1;min-width:0' }, label, sub)), use));
  const start = params.start || (ctx.pos ? { lat: ctx.pos.lat, lng: ctx.pos.lng } : null);
  const map = new RideMap(mapEl, { zoom: 15, center: start ? [start.lng, start.lat] : undefined });
  const lookup = async () => {
    const c = map.map.getCenter();
    const my = ++seq;
    label.textContent = 'Finding the address…'; use.disabled = true;
    try {
      const p = await api.get(`/api/reverse?lat=${c.lat}&lng=${c.lng}`);
      if (my !== seq) return;
      place = { name: p.name, lat: c.lat, lng: c.lng };
      label.textContent = engine.short(p.name);
      sub.textContent = [p.name.split(',').slice(1, 3).join(',').trim(), ctx.pos ? `${fmtKm(haversine([ctx.pos.lat, ctx.pos.lng], [c.lat, c.lng]))} km from you` : null].filter(Boolean).join(' · ');
    } catch {
      if (my !== seq) return;
      place = { name: `Dropped pin, ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`, lat: c.lat, lng: c.lng };
      label.textContent = 'Dropped pin'; sub.textContent = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
    }
    use.disabled = false;
  };
  map.init().then((ok) => {
    if (!ok || !map.map) { label.textContent = 'The map can’t load right now'; return; }
    if (ctx.pos) map.setMe(ctx.pos);
    map.map.on('movestart', () => { el.classList.add('moving'); });
    map.map.on('moveend', () => { el.classList.remove('moving'); clearTimeout(t); t = setTimeout(lookup, 500); });
    lookup();
  });
  return () => { clearTimeout(t); map.destroy(); };
});

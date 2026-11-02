// Ride setup graph (Figma navigation map → "Start a ride · 5 steps"):
//   13 Start ride: which bike + Solo · Group · Quick ride
//   Quick:  13 → 25q hub straight away (no destination; tracks km, time, refills) → 34q summary
//   Group:  13 → 15 My groups or 16 Nearby → 17 Select riders → 18 Ready → then the same 5 steps
//   Steps:  19 Conditions (pillion on/off) → 20 Checklist → 21 Headset → 22 Where to (or 22e drop a pin) → 23 Place → 24 Routes
//           → 25t hub (Map · Speed) · 25u with pillion (Map · Speed · Pillion) · 25r group (Map · Speed · Group)
//   Up:     every step → the previous step; ✕ on 13 closes the whole setup to Home.
import { h, store, localDate, haversine, fmtKm, etaShort, fmtDist, fmtInt } from '../util.js';
import { api } from '../api.js';
import { ctx, emit, onMany } from '../state.js';
import { ic, button, iconButton, listItem, avatar, checkbox, ring, snackbar, withLoading, sheet, segmented, VOICE_MODES, AUDIO_OUT, WATCH_NOTE } from '../ui.js';
import { register, push, back, tab } from '../router.js';
import { RideMap } from '../map.js';
import { MicTest } from '../voice.js';
import { currentLight, sunTimes } from '../theme.js';
import { heroImage, TYPES, vehicleType } from '../vehicles.js';
import * as engine from '../engine.js';
import { joinSheet, newGroupSheet } from './groups.js';

// ---------------------------------------------------------------- 20 checklist model (adapts to bike type, trip, light, weather, pillion)
function checklist({ distance = 0, pillion = false, vehicle = ctx.user?.vehicle } = {}) {
  const night = currentLight() !== 'day';
  const rain = (ctx.weather?.rain || 0) > 0.2;
  const long = distance > 150000, medium = distance > 50000;
  const type = vehicleType(vehicle);
  const cycle = type === 'bicycle' || type === 'e-bike';
  const electric = type === 'ev-scooter' || type === 'e-bike';
  const vehicleItems = cycle
    ? [{ id: 'tyres', t: 'Tyres & pressure', req: true }, { id: 'brakes', t: 'Brakes front & rear', req: true }, { id: 'lights', t: 'Front & rear lights', req: night }, { id: 'chain', t: 'Chain & gears', req: false },
      ...(electric ? [{ id: 'charge', t: 'Battery charged', req: true }] : []), { id: 'lock', t: 'Lock', req: false }]
    : [{ id: 'tyres', t: 'Tyres & pressure', req: true }, { id: 'brakes', t: 'Brakes front & rear', req: true }, { id: 'lights', t: 'Lights & indicators', req: true },
      ...(electric ? [{ id: 'charge', t: 'Battery charge for the trip', req: true }] : [{ id: 'chain', t: 'Chain', req: type !== 'scooter' }, { id: 'fuel', t: 'Fuel for the first leg', req: true }])];
  const S = [
    { id: 'bike', icon: TYPES[type].icon, title: TYPES[type].label, items: vehicleItems },
    { id: 'rider', icon: 'sports_motorsports', title: pillion ? 'Rider & pillion' : 'Rider', items: [
      { id: 'helmet', t: 'Helmet & visor', req: true }, { id: 'gloves', t: cycle ? 'Gloves' : 'Gloves & gear', req: !cycle },
      ...(pillion ? [{ id: 'p-helmet', t: 'Pillion helmet', req: true }, { id: 'p-pegs', t: 'Pillion footpegs down', req: !cycle }] : [])] },
    ...(cycle ? [] : [{ id: 'docs', icon: 'badge', title: 'Documents', items: [{ id: 'licence', t: 'Licence & RC', req: true }, { id: 'insurance', t: 'Insurance & PUC', req: false }] }]),
    { id: 'trip', icon: 'route', title: 'Trip', items: [
      { id: 'battery', t: 'Phone battery', req: true }, { id: 'headset', t: 'Headset paired', req: false },
      { id: 'rain', t: 'Rain gear', req: rain }, ...(medium ? [{ id: 'water', t: 'Water & snacks', req: long }] : []),
      ...(long ? [{ id: 'kit', t: 'Puncture kit & tools', req: true }] : []), ...(night ? [{ id: 'reflective', t: 'Reflective vest', req: false }] : [])] },
  ];
  const tags = [TYPES[type].label, long ? 'Long' : medium ? 'Medium' : 'Short', night ? 'Night' : 'Day', ...(rain ? ['Rain'] : []), ...(pillion ? ['Pillion'] : [])];
  return { sections: S, tags };
}
const tickKey = () => `ck.${localDate()}.${ctx.user?.vehicle?.id || 'v'}`;
export function checklistStatus() {
  const done = new Set(store.get(tickKey(), []));
  const req = checklist().sections.flatMap((s) => s.items.filter((i) => i.req));
  const left = req.filter((i) => !done.has(i.id)).length;
  return { done: left === 0, left };
}

const vName = (v) => v?.nickname || [v?.make, v?.model].filter(Boolean).join(' ') || 'Your bike';
const STEPS = { conditions: 1, check: 2, headset: 3, where: 4, place: 4, route: 5 };
const STEP_NAMES = ['Conditions', 'Checklist', 'Headset', 'Where to', 'Route'];
const PRE = { group: 1, riders: 2, ready: 3 };
const PRE_NAMES = ['Your group', 'Who’s riding', 'Ready'];
const TITLES = { start: 'Start a ride' };

/** Which bike this ride is on (13): shows the active vehicle; changing it makes it the one on Home. */
export function vehiclePicker({ onChange } = {}) {
  const el = h('button', { type: 'button', class: 'veh-pick', 'data-vehicle-pick': '' });
  const draw = () => {
    const v = ctx.user?.vehicle;
    el.replaceChildren(h('span', { class: 'veh-thumb small', style: `background-image:url("${heroImage(v || {})}")` }),
      h('span', { class: 'main' }, h('span', { class: 'label-m variant' }, 'Riding'), h('span', { class: 'title-s' }, v ? vName(v) : 'Add your bike')),
      h('span', { class: 'label-l', style: 'color:var(--primary)' }, (ctx.user?.vehicleCount || 0) > 1 ? 'Change' : v ? 'Edit' : 'Add'));
  };
  el.onclick = () => sheet((close) => {
    const list = h('div', { class: 'list' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    api.get('/api/vehicles').then((g) => list.replaceChildren(...g.vehicles.map((v) => listItem({
      lead: h('span', { class: 'veh-thumb', style: `background-image:url("${heroImage(v)}")` }), title: vName(v),
      sub: [TYPES[vehicleType(v)].label, v.odometer != null ? `${fmtInt(v.odometer)} km` : null, v.reg].filter(Boolean).join(' · '), attrs: { 'data-vehicle': v.id },
      trail: v.id === g.activeId ? ic('radio_button_checked', { fill: true }) : ic('radio_button_unchecked'),
      onclick: async () => {
        try {
          const r = await api.post(`/api/vehicles/${v.id}/active`);
          ctx.user = r.user; store.set('user', r.user); emit('user', r.user);
          close(); draw(); onChange?.(v);
        } catch (e) { snackbar(e.message); }
      },
    })))).catch((e) => list.replaceChildren(h('p', { class: 'body-m' }, e.message)));
    return h('div', { class: 'stack gap12' }, h('h2', { class: 'headline-s' }, 'Which bike are you riding?'), list,
      button('Add a vehicle', { style: 'text', icon: 'add', onclick: () => { close(); import('./vehicles.js').then((m) => m.vehicleSheet(null, { onSaved: () => draw() })); } }));
  });
  draw();
  el.redraw = draw;
  return el;
}

register('setup', (el, params) => {
  const plan = ctx.plan = {
    mode: params.mode || (params.quickDest ? (ctx.group ? 'group' : 'solo') : null),
    pillion: false, dest: params.quickDest || null, route: null, options: null, sel: 0,
    riders: null, // 17: Set of user ids
  };
  const first = params.checkOnly ? 'check' : params.step === 5 && plan.dest ? 'route' : params.step === 3 ? 'check' : params.mode === 'group' ? 'group' : params.mode === 'solo' ? 'conditions' : 'start';
  const trail = []; // pages visited, for Up
  let page = null, cleanup = null;

  const stepsBar = h('div', { class: 'steps-bar', 'aria-hidden': 'true' });
  const head = h('header', { class: 'setup-head' });
  const caption = h('div', { class: 'step-caption label-l variant' });
  const content = h('div', { style: 'flex:1;min-height:0;display:flex;flex-direction:column;position:relative;overflow:hidden' });
  el.append(head, stepsBar, caption, content);

  const PAGES = { start: pStart, group: pGroup, riders: pRiders, ready: pReady, conditions: pConditions, check: pCheck, headset: pHeadset, where: pWhere, place: pPlace, route: pRoute };
  const order = () => (plan.mode === 'group' ? ['start', 'group', 'riders', 'ready'] : ['start']).concat(['conditions', 'check', 'headset', 'where', 'place', 'route']);
  const nextOf = (p) => { const o = order(); return o[o.indexOf(p) + 1]; };

  function go(name, { dir = 'fwd' } = {}) {
    cleanup?.(); cleanup = null;
    if (dir === 'fwd' && page) trail.push(page);
    if (name === 'start') trail.length = 0;
    page = name;
    const full = name === 'route' && plan.dest;
    head.hidden = caption.hidden = stepsBar.hidden = !!full;
    // caption + bar: 5 main steps, or the 3 group pre-steps
    const s = STEPS[name], pre = PRE[name];
    const bars = s ? STEP_NAMES.length : pre ? PRE_NAMES.length : 0;
    stepsBar.replaceChildren(...Array.from({ length: bars }, (_, i) => h('i', { class: i < (s || pre) ? 'on' : '' })));
    stepsBar.hidden = !bars || !!full;
    caption.textContent = params.checkOnly ? 'Pre-ride checklist'
      : s ? `Step ${s} of 5 · ${STEP_NAMES[s - 1]}${name === 'place' ? ' · Place' : ''}`
      : pre ? `Group ride · ${PRE_NAMES[pre - 1]}` : TITLES[name] || '';
    const isFirst = !trail.length || params.checkOnly;
    head.replaceChildren(
      iconButton(isFirst ? 'close' : 'arrow_back', { label: isFirst ? 'Close' : 'Back', onclick: () => (isFirst ? closeAll() : up()) }),
      name === 'check' ? iconButton('info', { label: 'About the checklist', onclick: () => snackbar('Items adapt to your bike, the trip, the time of day, the weather and a pillion.') }) : h('span'));
    const old = content.lastElementChild;
    if (old) { old.style.cssText += ';position:absolute;inset:0;pointer-events:none'; old.className = `step-out-${dir}`; setTimeout(() => old.remove(), 220); }
    const wrap = h('div', { class: `step-in-${dir}`, style: 'flex:1;min-height:0;display:flex;flex-direction:column', 'data-page': name, 'data-step': s || '' });
    content.append(wrap);
    cleanup = PAGES[name](wrap) || null;
    el.dataset.page = name;
  }
  const up = () => { const prev = trail.pop(); if (prev) go(prev, { dir: 'back' }); else closeAll(); };
  const closeAll = () => (params.checkOnly ? back() : tab('home'));
  el.onBackBlocked = null;
  const next = () => go(nextOf(page));

  const startRide = (opts = {}) => {
    engine.startRide({ solo: plan.mode !== 'group', pillion: plan.pillion, riders: plan.riders ? [...plan.riders] : null, ...opts });
    push('ride', {}, { replace: true });
  };

  // ---- 13 Start ride
  function pStart(box) {
    const picker = vehiclePicker({ onChange: () => draw() });
    const list = h('div', { class: 'choice-list' });
    const card = (mode, icon, title, sub, img) => h('button', {
      type: 'button', class: `choice${img ? ' photo' : ''}${plan.mode === mode ? ' on' : ''}`, 'data-mode': mode,
      style: img ? `background-image:url("${img}")` : '',
      onclick: () => {
        if (mode === 'quick') { plan.mode = ctx.group ? 'group' : 'solo'; return startRide({ quick: true }); }
        plan.mode = mode; next();
      },
    }, h('span', { class: 'art' }, ic(icon, { fill: true })), h('span', { class: 'main' }, h('span', { class: 'title-l' }, title), h('span', { class: 'body-m variant' }, sub)), ic('chevron_right'));
    const draw = () => list.replaceChildren(
      card('solo', 'person', 'Solo ride', 'Conditions, checklist, directions. Your location stays private.', heroImage(ctx.user?.vehicle)),
      card('group', 'groups', 'Group ride', ctx.group ? `With ${ctx.group.name} · live map and talk` : 'Ride with friends · live map and talk', '/img/group-ride.jpg'),
      card('quick', 'bolt', 'Quick ride', ctx.group ? `Skip the setup · rides with ${ctx.group.name}` : 'Skip the setup and just go. Km, time and refills are still recorded.'));
    draw();
    box.append(h('div', { class: 'screen-body pad' }, h('h1', { class: 'headline-m', style: 'margin:8px 0 16px' }, 'How are you riding?'), picker, h('div', { style: 'height:16px' }), list));
  }

  // ---- 15 My groups (or 16 Nearby)
  function pGroup(box) {
    const body = h('div', { class: 'screen-body pad' });
    const cont = button('Continue', { size: 'large', wide: true, onclick: next });
    const render = () => {
      cont.disabled = !ctx.group;
      body.replaceChildren(h('h1', { class: 'headline-m', style: 'margin:8px 0 16px' }, 'Who are you riding with?'),
        ctx.groups.length ? h('div', { class: 'list' }, ctx.groups.map((grp) => {
          const sel = ctx.group?.id === grp.id;
          return h('button', { type: 'button', class: `rider-row${sel ? ' selected' : ''}`, style: 'border:0;width:100%;text-align:left;color:inherit', 'aria-pressed': String(sel), onclick: () => engine.openGroup(grp) },
            h('span', { class: 'avatar' }, ic('groups')), h('span', { class: 'main' }, h('span', { class: 'body-l' }, grp.name), h('span', { class: 'body-m variant' }, `${grp.members.length} ${grp.members.length === 1 ? 'rider' : 'riders'}`)),
            ic(sel ? 'radio_button_checked' : 'radio_button_unchecked', { fill: sel }));
        })) : h('div', { class: 'empty', style: 'padding:16px 0' }, ic('groups'), h('p', { class: 'body-m' }, 'Create a group and share the code, or join your friends’ group.')),
        h('div', { class: 'row gap8 mt16' }, button('Join with a code', { style: 'outlined', onclick: () => joinSheet({ stay: true }) }), button('Create group', { style: 'tonal', onclick: () => newGroupSheet({ stay: true }) })),
        h('button', { type: 'button', class: 'shortcut', onclick: () => push('nearby', { fromSetup: true }) }, ic('nearby'), h('span', { class: 'main' }, h('span', { class: 'title-s' }, 'Riders nearby'), h('span', { class: 'body-s variant' }, 'Ride with people right here, no code')), ic('chevron_right')));
    };
    render();
    box.append(body, h('div', { class: 'screen-foot' }, cont));
    return onMany({ group: render, groups: render });
  }

  // ---- 17 Select riders
  function pRiders(box) {
    const g = ctx.group;
    if (!g) { setTimeout(up, 0); return; }
    if (!plan.riders || plan.ridersGroup !== g.id) { plan.riders = new Set(g.members.filter((m) => m.online || m.id === ctx.user.id).map((m) => m.id)); plan.ridersGroup = g.id; }
    const body = h('div', { class: 'screen-body pad' });
    const render = () => body.replaceChildren(h('h1', { class: 'headline-m', style: 'margin:8px 0 4px' }, 'Who’s riding today?'),
      h('p', { class: 'body-m variant', style: 'margin:0 0 16px' }, 'Picked riders get “ride starting” and see you on their map.'),
      h('div', { class: 'list', 'data-select-riders': '' }, g.members.map((m) => {
        const me = m.id === ctx.user.id, picked = me || plan.riders.has(m.id);
        return h('label', { class: `rider-row${picked ? ' picked' : ''}`, style: 'cursor:pointer', 'data-rider': m.id }, avatar(m.name, { status: m.online || me ? 'connected' : 'off', color: m.color }),
          h('span', { class: 'main' }, h('span', { class: 'body-l' }, me ? `${m.name} (you)` : m.name), h('span', { class: 'body-m variant' }, me ? 'Leading' : [m.online ? 'Online' : 'Not in the app yet', m.vehicle?.model].filter(Boolean).join(' · '))),
          me ? h('span', { class: 'status compact ok' }, ic('check_circle'), 'You')
            : checkbox({ checked: picked, label: `${m.name} rides today`, onchange: (v) => { v ? plan.riders.add(m.id) : plan.riders.delete(m.id); render(); } }));
      })));
    render();
    box.append(body, h('div', { class: 'screen-foot' }, button('Continue', { size: 'large', wide: true, onclick: next })));
    return onMany({ group: render });
  }

  // ---- 18 Ready: who's in the app and ready; nudge the others
  function pReady(box) {
    const body = h('div', { class: 'screen-body pad' });
    const cont = button('Continue', { size: 'large', wide: true, onclick: next });
    const render = () => {
      const g = ctx.group;
      if (!g) return;
      const picked = g.members.filter((m) => m.id === ctx.user.id || plan.riders?.has(m.id));
      const ready = picked.filter((m) => m.online || m.id === ctx.user.id);
      cont.lastChild.textContent = ready.length === picked.length ? 'Everyone’s ready' : 'Continue anyway';
      body.replaceChildren(h('h1', { class: 'headline-m', style: 'margin:8px 0 4px' }, ready.length === picked.length ? 'Everyone’s here' : 'Waiting for riders'),
        h('div', { class: 'section-label title-s', style: 'padding-left:4px' }, g.name, h('span', { class: 'count label-m' }, `${ready.length} of ${picked.length} ready`)),
        h('div', { class: 'list' }, picked.map((m) => {
          const me = m.id === ctx.user.id, ok = me || m.online;
          return h('div', { class: 'rider-row' }, avatar(m.name, { status: ok ? 'connected' : 'off', color: m.color }),
            h('span', { class: 'main' }, h('span', { class: 'body-l' }, me ? `${m.name} (you)` : m.name), h('span', { class: 'body-m variant' }, ok ? 'In the app' : 'Not in the app yet')),
            ok ? h('span', { class: 'status compact ok' }, ic('check_circle'), 'Ready') : h('span', { class: 'label-m variant' }, 'Waiting'));
        })),
        ready.length < picked.length ? button('Nudge them in chat', { style: 'tonal', icon: 'campaign', attrs: { style: 'margin-top:16px' }, onclick: async () => {
          const { rt } = await import('../state.js');
          if (rt.send({ t: 'chat', text: `Getting ready to ride. Open Rylaide when you can!` })) snackbar('Sent to the group chat'); else snackbar('You’re offline.');
        } }) : null);
    };
    render();
    box.append(body, h('div', { class: 'screen-foot' }, cont));
    return onMany({ group: render });
  }

  // ---- 19 Conditions: weather, daylight, pillion on/off
  function pConditions(box) {
    const w = ctx.weather;
    const p = ctx.pos;
    const st = p ? sunTimes(new Date(), p.lat, p.lng) : null;
    const now = Date.now();
    const light = currentLight();
    const left = st ? Math.round((st.sunset - now) / 60000) : null;
    const tile = (icon, v, l) => h('div', { class: 'stat tile' }, ic(icon, { size: 20 }), h('span', { class: 'ride-metric', style: 'margin-top:4px' }, v), h('span', { class: 'l' }, l));
    const notes = [];
    if (w?.rain > 0.2) notes.push(['rainy', 'Rain expected', 'Wet roads brake longer. Rain gear is on your checklist.']);
    if (light !== 'day') notes.push(['dark_mode', light === 'night' ? 'Riding at night' : 'Light is fading', 'Lights on, reflective gear, and slower in the ghats.']);
    if (w?.wind > 10) notes.push(['air', 'Strong wind', 'Hold the bars firmly on bridges and open roads.']);
    const pill = h('div', { class: 'choice-list', style: 'margin-top:8px' },
      ...[[false, 'person', 'Just me', 'Riding alone on the bike'], [true, 'group', 'With a pillion', 'Adds pillion items and break reminders']].map(([val, icon, t, d]) =>
        h('button', { type: 'button', class: `choice${plan.pillion === val ? ' on' : ''}`, 'data-pillion': val ? 'yes' : 'no', onclick: () => { plan.pillion = val; next(); } },
          h('span', { class: 'art' }, ic(icon, { fill: true })), h('span', { class: 'main' }, h('span', { class: 'title-l' }, t), h('span', { class: 'body-m variant' }, d)), ic('chevron_right'))));
    box.append(h('div', { class: 'screen-body pad' },
      h('h1', { class: 'headline-m', style: 'margin:8px 0 16px' }, 'Riding conditions'),
      h('div', { class: 'stat-row' },
        tile('thermostat', w?.temp != null ? `${Math.round(w.temp)}°` : '–', 'Now'),
        tile('water_drop', w?.rain != null ? (w.rain > 0.2 ? `${w.rain} mm` : 'Dry') : '–', 'Next hour'),
        tile(left > 0 ? 'wb_twilight' : 'dark_mode', left == null ? '–' : left > 0 ? (left > 90 ? new Date(st.sunset).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : `${left} min`) : 'Dark', left > 0 ? (left > 90 ? 'Sunset' : 'Daylight left') : 'After sunset')),
      notes.length ? h('div', { class: 'stack gap8 mt16' }, notes.map(([icn, t, d]) => h('div', { class: 'banner warn', style: 'margin:0' }, ic(icn), h('span', { class: 'main' }, h('span', { class: 'title-s' }, t), h('span', { class: 'body-m' }, d))))) : h('div', { class: 'banner ok', style: 'margin:16px 0 0' }, ic('check_circle'), h('span', { class: 'main' }, h('span', { class: 'title-s' }, 'Good conditions for riding'))),
      h('h2', { class: 'title-m', style: 'margin:24px 4px 0' }, 'Anyone on the back?'), pill));
  }

  // ---- 20 Checklist
  function pCheck(box) {
    const done = new Set(store.get(tickKey(), []));
    const { sections, tags } = checklist({ pillion: plan.pillion, distance: plan.dest && ctx.pos ? haversine([ctx.pos.lat, ctx.pos.lng], [plan.dest.lat, plan.dest.lng]) * 1.3 : 0 });
    const all = sections.flatMap((s) => s.items);
    const num = h('div', { class: 'headline-l' });
    const r = ring(0, { size: 112, stroke: 10, center: h('div', { class: 'num' }, num, h('div', { class: 'body-s variant' }, `of ${all.length}`)) });
    const left = h('p', { class: 'body-m variant' });
    const ready = button(params.checkOnly ? 'Done' : 'Ready to ride', { size: 'large', wide: true, onclick: () => (params.checkOnly ? back() : next()) });
    const update = () => {
      const n = all.filter((i) => done.has(i.id)).length;
      const reqLeft = all.filter((i) => i.req && !done.has(i.id)).length;
      num.textContent = String(n);
      r.set(n / all.length);
      left.textContent = reqLeft ? `${reqLeft} left to check` : 'All required items done';
      ready.disabled = !params.checkOnly && reqLeft > 0;
      store.set(tickKey(), [...done]);
      box.querySelectorAll('.section-label .count').forEach((c, i) => (c.textContent = `${sections[i].items.filter((x) => done.has(x.id)).length}/${sections[i].items.length}`));
    };
    const item = (it) => {
      const state = h('span', { class: 'label-m' });
      const row = h('div', { class: 'check-item' });
      const sync = () => {
        const on = done.has(it.id);
        row.classList.toggle('req', it.req && !on);
        state.replaceChildren(on ? h('span', { class: 'state-done' }, 'Done') : it.req ? h('span', { class: 'state-req' }, ic('error'), 'Required') : h('span', { class: 'tag outline' }, 'Optional'));
      };
      const cb = checkbox({ checked: done.has(it.id), label: it.t, error: it.req && !done.has(it.id), onchange: (v) => { v ? done.add(it.id) : done.delete(it.id); cb.classList.toggle('error', it.req && !v); sync(); update(); } });
      row.append(cb, h('span', { class: 'main body-l' }, it.t), state);
      sync();
      return row;
    };
    box.append(h('div', { class: 'screen-body' },
      h('div', { class: 'check-hero' }, r, h('div', { class: 'stack gap8' }, h('h1', { class: 'headline-m' }, 'Get ready'), left, h('div', { class: 'row gap8', style: 'flex-wrap:wrap' }, tags.map((t) => h('span', { class: 'tag' }, t))))),
      h('div', { style: 'padding:0 16px 24px' }, sections.map((s) => [
        h('div', { class: 'section-label title-s', style: 'padding-left:4px' }, ic(s.icon), s.title, h('span', { class: 'count label-m' }, '')),
        h('div', { class: 'list' }, s.items.map(item))]))),
    h('div', { class: 'screen-foot stack gap8' }, ready, params.checkOnly ? null : button('Skip for now', { style: 'text', wide: true, onclick: next })));
    update();
  }

  // ---- 21 Headset: hear a direction, check the mic, pick voice guidance
  function pHeadset(box) {
    const meter = h('i', { style: 'width:0;transition:width 80ms linear' });
    const micLabel = h('span', { class: 'body-m variant' }, 'Checking your mic…');
    const test = new MicTest({ onLevel: (l) => { meter.style.width = `${Math.round(l * 100)}%`; if (l > 0.08) micLabel.textContent = 'Mic working'; }, onStatus: () => {} });
    test.start(store.get('micId', '')).catch((e) => (micLabel.textContent = e.message));
    const outNote = h('p', { class: 'body-s variant', style: 'padding:8px 4px 0;margin:0' }, `${AUDIO_OUT.find((o) => o.value === engine.audioOut()).sub}. ${WATCH_NOTE}`);
    box.append(h('div', { class: 'screen-body pad' },
      h('h1', { class: 'headline-m', style: 'margin:8px 0 16px' }, 'Check your headset'),
      h('div', { class: 'list' }, listItem({ icon: 'volume_up', title: 'Play a direction', sub: 'You should hear it in your helmet', trail: ic('play_arrow'), onclick: () => engine.speak('In 300 metres, bear left onto Ring Road.', 'nav', { force: true }) })),
      h('div', { class: 'section-label title-s', style: 'padding-left:4px' }, plan.mode === 'group' ? 'Mic check · your group hears this' : 'Mic check'),
      h('div', { class: 'mini-meter' }, ic('headset_mic'), h('div', { class: 'progress-linear' }, meter), micLabel),
      h('div', { class: 'section-label title-s', style: 'padding-left:4px' }, 'Sound comes from'),
      segmented(AUDIO_OUT.map((o) => ({ value: o.value, label: o.label })), engine.audioOut(), (v) => { engine.setAudioOut(v); outNote.textContent = AUDIO_OUT.find((o) => o.value === v).sub + '.'; }, { label: 'Sound comes from' }),
      outNote,
      h('div', { class: 'section-label title-s', style: 'padding-left:4px' }, 'Voice guidance'),
      segmented(VOICE_MODES.map((m) => ({ value: m.value, label: m.label })), engine.voiceGuide(), (v) => engine.setVoiceGuide(v), { label: 'Voice guidance' }),
      h('p', { class: 'body-s variant', style: 'padding:8px 4px 0' }, 'You can change this on the map any time with the speaker button.')),
    h('div', { class: 'screen-foot' }, button('Sounds good', { size: 'large', wide: true, onclick: next })));
    return () => test.stop();
  }

  // ---- 22 Where to (search) · 22e drop a pin
  function pWhere(box) {
    const input = h('input', { 'aria-label': 'Search a place', placeholder: 'Search a place', enterkeyhint: 'search', autocomplete: 'off' });
    const results = h('div', { class: 'list plain', style: 'margin-top:8px' });
    const recents = store.get('recentPlaces', []);
    const pickPlace = (p) => { plan.dest = p; plan.route = null; plan.options = null; store.set('recentPlaces', [p, ...recents.filter((r) => r.name !== p.name)].slice(0, 5)); go('place'); };
    const placeRow = (p, icon) => listItem({
      icon, title: p.name.split(',')[0], sub: p.name.split(',').slice(1, 3).join(',').trim() || ' ',
      trail: ctx.pos ? fmtDist(haversine([ctx.pos.lat, ctx.pos.lng], [p.lat, p.lng])).replace('now', '0 m') : null,
      onclick: () => pickPlace(p),
    });
    const pinRow = listItem({ icon: 'pin_drop', title: 'Choose on map', sub: 'Drop a pin anywhere', trail: ic('chevron_right'), onclick: () => push('pin', { title: 'Where to?', start: plan.dest, onPick: (p) => setTimeout(() => pickPlace(p), 320) }), attrs: { 'data-pin': '' } });
    const showDefault = () => results.replaceChildren(pinRow,
      plan.dest ? h('div', { class: 'section-label title-s', style: 'padding-left:16px' }, 'Selected') : null,
      plan.dest ? placeRow(plan.dest, 'location_on') : null,
      plan.mode === 'group' && ctx.group?.plan ? h('div', { class: 'section-label title-s', style: 'padding-left:16px' }, 'Group plan') : null,
      plan.mode === 'group' && ctx.group?.plan ? placeRow({ name: ctx.group.plan.destination, lat: ctx.group.plan.lat, lng: ctx.group.plan.lng }, 'bookmark') : null,
      recents.length ? h('div', { class: 'section-label title-s', style: 'padding-left:16px' }, 'Recent') : null,
      ...recents.map((p) => placeRow(p, 'history')));
    let t = null;
    const search = async () => {
      const q = input.value.trim();
      if (q.length < 2) return showDefault();
      results.replaceChildren(h('div', { class: 'empty', style: 'padding:24px' }, h('span', { class: 'spinner' })));
      try {
        const near = ctx.pos ? `&near=${ctx.pos.lng},${ctx.pos.lat}` : '';
        const { results: rs } = await api.get(`/api/search?q=${encodeURIComponent(q)}${near}`);
        if (input.value.trim() !== q) return;
        results.replaceChildren(...(rs.length ? rs.map((p) => placeRow(p, 'location_on')) : [h('div', { class: 'empty' }, ic('search_off'), h('p', { class: 'body-m' }, `Nothing found for “${q}”. Try a town or landmark.`))]));
      } catch (e) { results.replaceChildren(h('div', { class: 'empty' }, ic('cloud_off'), h('p', { class: 'body-m' }, e.message))); }
    };
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 450); }); // Nominatim allows ~1 request a second
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(t); search(); } });
    box.append(h('div', { class: 'screen-body', style: 'padding:16px 16px 0' },
      h('h1', { class: 'headline-m', style: 'margin-bottom:16px' }, 'Where are you riding?'),
      h('form', { class: 'search-bar', onsubmit: (e) => { e.preventDefault(); clearTimeout(t); search(); } }, ic('search'), input, iconButton('arrow_forward', { label: 'Search', attrs: { type: 'submit' } })),
      results),
    h('div', { class: 'screen-foot' }, button('Ride without a destination', { style: 'tonal', size: 'large', wide: true, icon: 'two_wheeler', onclick: () => startRide() })));
    showDefault();
    if (!plan.dest) setTimeout(() => input.focus(), 350);
    return () => clearTimeout(t);
  }

  // ---- 23 Place: what's there, how far, weather on arrival
  function pPlace(box) {
    const d = plan.dest;
    if (!d) { setTimeout(up, 0); return; }
    const mapEl = h('div', { class: 'map' });
    const wx = h('span', { class: 'ride-metric' }, '–');
    const dist = ctx.pos ? haversine([ctx.pos.lat, ctx.pos.lng], [d.lat, d.lng]) : null;
    box.append(h('div', { class: 'screen-body' },
      h('div', { class: 'place-map' }, mapEl),
      h('div', { class: 'pad' },
        h('h1', { class: 'headline-m', style: 'margin:16px 0 2px' }, engine.short(d.name)),
        h('p', { class: 'body-m variant', style: 'margin:0' }, d.name.split(',').slice(1, 4).join(',').trim()),
        h('div', { class: 'stat-row mt16' },
          h('div', { class: 'stat tile' }, h('div', { class: 'v' }, h('span', { class: 'ride-metric' }, dist != null ? fmtKm(dist) : '–'), h('span', { class: 'u' }, 'km')), h('span', { class: 'l' }, 'Straight line')),
          h('div', { class: 'stat tile' }, wx, h('span', { class: 'l' }, 'Weather there'))),
        plan.mode === 'group' && ctx.group ? h('p', { class: 'body-s variant', style: 'margin:16px 4px 0' }, `Starting the ride shares this as ${ctx.group.name}’s ride plan.`) : null)),
    h('div', { class: 'screen-foot stack gap8' }, button('See routes', { size: 'large', wide: true, icon: 'route', onclick: next }), button('Pick another place', { style: 'text', wide: true, onclick: up })));
    const map = new RideMap(mapEl, { zoom: 12, interactive: false, center: [d.lng, d.lat] });
    map.init().then(() => { map.setDestination(d.lng, d.lat); if (ctx.pos) { map.setOrigin(ctx.pos.lng, ctx.pos.lat); map.fitAll?.([[d.lng, d.lat]]); } });
    api.get(`/api/weather?lat=${d.lat}&lng=${d.lng}`).then((w) => (wx.textContent = w.temp != null ? `${Math.round(w.temp)}°${w.rain > 0.2 ? ' · rain' : ''}` : '–')).catch(() => {});
    return () => map.destroy();
  }

  // ---- 24 Routes (full-screen map with Best / Fastest / Scenic)
  function pRoute(box) {
    if (!plan.dest) { setTimeout(() => go('where', { dir: 'back' }), 0); return; }
    const mapEl = h('div', { class: 'map' });
    const pill = h('div', { class: 'place-pill' }, ic('location_on', { fill: true }), h('span', {}, engine.short(plan.dest.name)));
    const top = h('div', { style: 'position:absolute;top:12px;left:12px;right:12px;z-index:4;display:flex;gap:8px;align-items:center' },
      iconButton('arrow_back', { label: 'Back', style: 'surface', onclick: up }), pill);
    const opts = h('div', { class: 'route-options', role: 'radiogroup', 'aria-label': 'Route options' });
    const note = h('div', { class: 'row gap8 body-s variant', style: 'padding:12px 16px 0' });
    const start = button('Start ride', { size: 'large', wide: true, icon: 'play_arrow', disabled: true });
    const kind = plan.mode === 'group' ? 'Group ride' : plan.pillion ? 'With pillion' : 'Solo';
    const sheetEl = h('div', { class: 'route-sheet' }, h('div', { class: 'handle', style: 'width:32px;height:4px;border-radius:2px;background:var(--on-surface-variant);opacity:.4;margin:12px auto 12px' }),
      h('div', { class: 'steps-bar' }, STEP_NAMES.map(() => h('i', { class: 'on' }))),
      h('div', { class: 'label-l variant', style: 'padding:12px 16px 0' }, `Step 5 of 5 · Route · ${kind} · ${vName(ctx.user?.vehicle)}`), opts, note, h('div', { style: 'padding:16px 16px 0' }, start));
    box.append(h('div', { style: 'position:relative;flex:1' }, mapEl, top, sheetEl));
    const map = new RideMap(mapEl, { zoom: 12 });
    map.init();
    if (ctx.pos) map.setOrigin(ctx.pos.lng, ctx.pos.lat);
    map.setDestination(plan.dest.lng, plan.dest.lat);
    const select = (i) => {
      plan.sel = i; plan.route = plan.options[i];
      map.setRoutes(plan.options, i, { padding: { top: 90, bottom: sheetEl.offsetHeight + 24, left: 40, right: 40 } });
      opts.replaceChildren(...plan.options.map((o, k) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(k === i), class: `route-opt${k === i ? ' on' : ''}`, onclick: () => select(k) },
        h('span', { class: 'head label-m' }, o.label || ['Best', 'Fastest', 'Scenic'][k], k === i ? ic('check_circle') : null),
        h('span', { class: 't' }, h('b', {}, etaShort(o.duration).replace(' min', '')), h('span', { class: 'body-m' }, o.duration < 3600 ? 'min' : '')),
        h('span', { class: 'body-s variant' }, `${fmtKm(o.distance)} km`))));
    };
    map.onAltClick = (i) => Number.isInteger(+i) && select(+i);
    (async () => {
      try {
        const res = plan.options ? { options: plan.options } : await engine.fetchRoute(plan.dest);
        plan.options = res.options || [res];
        select(plan.sel < plan.options.length ? plan.sel : 0);
        note.replaceChildren(ic('check_circle', { size: 18 }), 'Route saved on this phone · directions keep working if signal drops');
      } catch (e) {
        opts.replaceChildren(h('div', { class: 'body-m', style: 'grid-column:1/-1;color:var(--error)' }, e.message));
        note.replaceChildren(button('Try again', { style: 'text', onclick: () => go('route', { dir: 'back' }) }));
        start.lastChild.textContent = 'Ride without directions';
      }
      start.disabled = false;
    })();
    start.onclick = () => withLoading(start, async () => {
      if (plan.mode === 'group' && ctx.group && plan.route) api.put(`/api/groups/${ctx.group.id}/plan`, { destination: engine.short(plan.dest.name), lat: plan.dest.lat, lng: plan.dest.lng }).catch(() => {});
      startRide({ dest: plan.route ? plan.dest : null, route: plan.route });
    });
    return () => map.destroy();
  }

  // Entered part-way (a group invite, a shared place): Back still leads to 13 Start ride.
  if (['group', 'conditions'].includes(first)) trail.push('start');
  go(first, { dir: 'fwd' });
  return () => cleanup?.();
});

// 13 Start a ride · 5 steps (Figma: Navigation map → "Start a ride · 5 steps")
//   1 How are you riding?  Solo · Group · Quick ride (Quick goes straight to the hub)
//   2 Solo: pillion?        Group: your group, riders ready, mic check
//   3 Checklist             4 Where to             5 Route → 25 Ride hub
import { h, store, localDate, haversine, fmtKm, etaShort, fmtDist } from '../util.js';
import { api } from '../api.js';
import { ctx, onMany } from '../state.js';
import { ic, button, iconButton, listItem, avatar, checkbox, ring, snackbar, withLoading } from '../ui.js';
import { register, push, back } from '../router.js';
import { RideMap } from '../map.js';
import { MicTest } from '../voice.js';
import { currentLight } from '../theme.js';
import { heroImage } from '../vehicles.js';
import * as engine from '../engine.js';
import { joinSheet, newGroupSheet } from './groups.js';

// ---------------------------------------------------------------- checklist model
function checklist({ distance = 0, pillion = false } = {}) {
  const night = currentLight() !== 'day';
  const rain = (ctx.weather?.rain || 0) > 0.2;
  const long = distance > 150000, medium = distance > 50000;
  const S = [
    { id: 'bike', icon: 'two_wheeler', title: 'Bike', items: [
      { id: 'tyres', t: 'Tyres & pressure', req: true }, { id: 'brakes', t: 'Brakes front & rear', req: true },
      { id: 'lights', t: 'Lights & indicators', req: true }, { id: 'chain', t: 'Chain', req: true }, { id: 'fuel', t: 'Fuel for the first leg', req: true }] },
    { id: 'rider', icon: 'sports_motorsports', title: pillion ? 'Rider & pillion' : 'Rider', items: [
      { id: 'helmet', t: 'Helmet & visor', req: true }, { id: 'gloves', t: 'Gloves & gear', req: true },
      ...(pillion ? [{ id: 'p-helmet', t: 'Pillion helmet', req: true }, { id: 'p-pegs', t: 'Pillion footpegs down', req: true }] : [])] },
    { id: 'docs', icon: 'badge', title: 'Documents', items: [{ id: 'licence', t: 'Licence & RC', req: true }, { id: 'insurance', t: 'Insurance papers', req: false }] },
    { id: 'trip', icon: 'route', title: 'Trip', items: [
      { id: 'battery', t: 'Phone battery', req: true }, { id: 'headset', t: 'Headset paired', req: false },
      { id: 'rain', t: 'Rain gear', req: rain }, ...(medium ? [{ id: 'water', t: 'Water & snacks', req: long }] : []),
      ...(long ? [{ id: 'kit', t: 'Puncture kit & tools', req: true }] : []), ...(night ? [{ id: 'reflective', t: 'Reflective vest', req: false }] : [])] },
  ];
  const tags = [long ? 'Long' : medium ? 'Medium' : 'Short', night ? 'Night' : 'Day', ...(rain ? ['Rain'] : []), ...(pillion ? ['Pillion'] : [])];
  return { sections: S, tags };
}
const tickKey = () => `ck.${localDate()}`;
export function checklistStatus() {
  const done = new Set(store.get(tickKey(), []));
  const req = checklist().sections.flatMap((s) => s.items.filter((i) => i.req));
  const left = req.filter((i) => !done.has(i.id)).length;
  return { done: left === 0, left };
}

const STEP_NAMES = ['How you’re riding', 'Who’s riding', 'Checklist', 'Where to', 'Route'];

// ---------------------------------------------------------------- setup flow
register('setup', (el, params) => {
  const plan = ctx.plan = {
    mode: params.mode || (params.quickDest ? (ctx.group ? 'group' : 'solo') : null),
    pillion: false, dest: params.quickDest || null, route: null, options: null, sel: 0,
  };
  let step = 0;
  let cleanupStep = null;
  const stepsBar = h('div', { class: 'steps-bar', 'aria-hidden': 'true' }, STEP_NAMES.map(() => h('i')));
  const head = h('header', { class: 'setup-head' });
  const caption = h('div', { class: 'step-caption label-l variant' });
  const content = h('div', { style: 'flex:1;min-height:0;display:flex;flex-direction:column;position:relative;overflow:hidden' });
  el.append(head, stepsBar, caption, content);
  const firstStep = params.checkOnly ? 3 : params.step || 1;

  const go = (n) => {
    const dir = n >= step ? 'fwd' : 'back';
    cleanupStep?.(); cleanupStep = null;
    step = n;
    const full = n === 5 && plan.dest;
    head.hidden = caption.hidden = stepsBar.hidden = !!full;
    stepsBar.querySelectorAll('i').forEach((b, i) => b.classList.toggle('on', i < n));
    caption.textContent = params.checkOnly ? 'Pre-ride checklist' : `Step ${n} of 5 · ${STEP_NAMES[n - 1]}`;
    const isFirst = n === firstStep || params.checkOnly;
    head.replaceChildren(
      iconButton(isFirst ? 'close' : 'arrow_back', { label: isFirst ? 'Close' : 'Back', onclick: () => (isFirst ? back() : go(prevStep(n))) }),
      n === 3 ? iconButton('info', { label: 'About the checklist', onclick: () => snackbar('Items adapt to your trip, the time of day, the weather and a pillion.') }) : h('span'));
    // slide the old step out and the new one in (Figma motion: forward 300 ms ease-out)
    const old = content.lastElementChild;
    if (old) {
      old.style.cssText += ';position:absolute;inset:0;pointer-events:none';
      old.className = `step-out-${dir}`;
      setTimeout(() => old.remove(), 220);
    }
    const wrap = h('div', { class: `step-in-${dir}`, style: 'flex:1;min-height:0;display:flex;flex-direction:column', 'data-step': n });
    content.append(wrap);
    cleanupStep = [stepType, stepPeople, stepCheck, stepWhere, stepRoute][n - 1](wrap) || null;
    el.dataset.step = n;
  };
  const prevStep = (n) => (n === 4 && params.checkOnly ? 3 : n - 1);

  const startRide = (opts = {}) => {
    engine.startRide({ solo: plan.mode !== 'group', ...opts });
    push('ride', {}, { replace: true });
  };

  // 1 · How are you riding?
  const stepType = (box) => {
    const card = (mode, icon, title, sub, img) => h('button', {
      type: 'button', class: `choice${img ? ' photo' : ''}${plan.mode === mode ? ' on' : ''}`, 'data-mode': mode,
      style: img ? `background-image:url("${img}")` : '',
      onclick: () => {
        if (mode === 'quick') { plan.mode = ctx.group ? 'group' : 'solo'; return startRide(); }
        plan.mode = mode; go(2);
      },
    }, h('span', { class: 'art' }, ic(icon, { fill: true })), h('span', { class: 'main' }, h('span', { class: 'title-l' }, title), h('span', { class: 'body-m variant' }, sub)), ic('chevron_right'));
    box.append(h('div', { class: 'screen-body pad' },
      h('h1', { class: 'headline-m', style: 'margin:16px 0 20px' }, 'How are you riding?'),
      h('div', { class: 'choice-list' },
        card('solo', 'person', 'Solo ride', 'Directions, checklist and your ride recorded', heroImage(ctx.user?.vehicle)),
        card('group', 'groups', 'Group ride', ctx.group ? `With ${ctx.group.name} · live map and talk` : 'Ride with friends · live map and talk', '/img/group-ride.jpg'),
        card('quick', 'bolt', 'Quick ride', ctx.group ? `Skip the setup · rides with ${ctx.group.name}` : 'Skip the setup and just go. Your ride is still recorded.'))));
  };

  // 2 · Solo: pillion? · Group: your group, who's ready, mic check
  const stepPeople = (box) => {
    if (plan.mode === 'solo') {
      const pick = (pillion) => { plan.pillion = pillion; go(3); };
      box.append(h('div', { class: 'screen-body pad' },
        h('h1', { class: 'headline-m', style: 'margin:16px 0 20px' }, 'Anyone riding with you?'),
        h('div', { class: 'choice-list' },
          h('button', { type: 'button', class: 'choice', 'data-pillion': 'no', onclick: () => pick(false) }, h('span', { class: 'art' }, ic('person', { fill: true })), h('span', { class: 'main' }, h('span', { class: 'title-l' }, 'Just me'), h('span', { class: 'body-m variant' }, 'Riding alone')), ic('chevron_right')),
          h('button', { type: 'button', class: 'choice', 'data-pillion': 'yes', onclick: () => pick(true) }, h('span', { class: 'art' }, ic('group', { fill: true })), h('span', { class: 'main' }, h('span', { class: 'title-l' }, 'With a pillion'), h('span', { class: 'body-m variant' }, 'Adds pillion items to your checklist')), ic('chevron_right')))));
      return;
    }
    const body = h('div', { class: 'screen-body pad' });
    const meter = h('i', { style: 'width:0;transition:width 80ms linear' });
    const micLabel = h('span', { class: 'body-m variant' }, 'Checking your mic…');
    const test = new MicTest({ onLevel: (l) => { meter.style.width = `${Math.round(l * 100)}%`; if (l > 0.08) micLabel.textContent = 'Mic working'; }, onStatus: () => {} });
    test.start(store.get('micId', '')).catch((e) => (micLabel.textContent = e.message));
    const cont = button('Continue', { size: 'large', wide: true, onclick: () => go(3) });
    const render = () => {
      const g = ctx.group;
      cont.disabled = !g;
      if (!ctx.groups.length) {
        body.replaceChildren(h('h1', { class: 'headline-m', style: 'margin:16px 0 8px' }, 'Your group'),
          h('div', { class: 'empty', style: 'padding:24px 0' }, ic('groups'), h('p', { class: 'body-m' }, 'Create a group and share the code, or join your friends’ group.'),
            h('div', { class: 'row gap8' }, button('Join with a code', { style: 'outlined', onclick: () => joinSheet({ stay: true }) }), button('Create group', { onclick: () => newGroupSheet({ stay: true }) }))));
        return;
      }
      const on = g ? g.members.filter((m) => m.online || m.id === ctx.user.id) : [];
      body.replaceChildren(
        h('h1', { class: 'headline-m', style: 'margin:16px 0 16px' }, 'Your group'),
        h('div', { class: 'list' }, ctx.groups.map((grp) => {
          const sel = g?.id === grp.id;
          return h('button', { type: 'button', class: `rider-row${sel ? ' selected' : ''}`, style: 'border:0;width:100%;text-align:left;color:inherit', 'aria-pressed': String(sel), onclick: () => { engine.openGroup(grp); } },
            h('span', { class: 'avatar' }, ic('groups')), h('span', { class: 'main' }, h('span', { class: 'body-l' }, grp.name), h('span', { class: 'body-m variant' }, `${grp.members.length} ${grp.members.length === 1 ? 'rider' : 'riders'}`)),
            ic(sel ? 'radio_button_checked' : 'radio_button_unchecked', { fill: sel }));
        })),
        g ? h('div', { class: 'section-label title-s', style: 'padding-left:4px' }, 'Riders', h('span', { class: 'count label-m' }, `${on.length} of ${g.members.length} ready`)) : null,
        g ? h('div', { class: 'list' }, g.members.map((m) => {
          const me = m.id === ctx.user.id, ready = m.online || me;
          return h('div', { class: 'rider-row' }, avatar(m.name, { status: ready ? 'connected' : 'off' }),
            h('span', { class: 'main' }, h('span', { class: 'body-l' }, me ? `${m.name} (you)` : m.name), h('span', { class: 'body-m variant' }, me ? 'Ready' : m.online ? 'Online' : 'Not in the app yet')),
            ready ? h('span', { class: 'status compact ok' }, ic('check_circle'), 'Ready') : h('span', { class: 'label-m variant' }, 'Will join'));
        })) : null,
        h('div', { class: 'section-label title-s', style: 'padding-left:4px' }, 'Mic check'),
        h('div', { class: 'mini-meter' }, ic('headset_mic'), h('div', { class: 'progress-linear' }, meter), micLabel),
        h('p', { class: 'body-s variant', style: 'padding:8px 4px 0' }, 'During the ride, hold the mic button to talk. Your group hears you in their headsets.'));
    };
    render();
    box.append(body, h('div', { class: 'screen-foot' }, cont));
    const off = onMany({ group: render, groups: render });
    return () => { off(); test.stop(); };
  };

  // 3 · Checklist
  const stepCheck = (box) => {
    const done = new Set(store.get(tickKey(), []));
    const { sections, tags } = checklist({ pillion: plan.pillion, distance: plan.dest && ctx.pos ? haversine([ctx.pos.lat, ctx.pos.lng], [plan.dest.lat, plan.dest.lng]) * 1.3 : 0 });
    const all = sections.flatMap((s) => s.items);
    const num = h('div', { class: 'headline-l' });
    const r = ring(0, { size: 112, stroke: 10, center: h('div', { class: 'num' }, num, h('div', { class: 'body-s variant' }, `of ${all.length}`)) });
    const left = h('p', { class: 'body-m variant' });
    const ready = button(params.checkOnly ? 'Done' : 'Ready to ride', { size: 'large', wide: true, onclick: () => (params.checkOnly ? back() : go(4)) });
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
    h('div', { class: 'screen-foot stack gap8' }, ready, params.checkOnly ? null : button('Skip for now', { style: 'text', wide: true, onclick: () => go(4) })));
    update();
  };

  // 4 · Where to
  const stepWhere = (box) => {
    const input = h('input', { 'aria-label': 'Search a place', placeholder: 'Search a place', enterkeyhint: 'search', autocomplete: 'off' });
    const results = h('div', { class: 'list plain', style: 'margin-top:8px' });
    const recents = store.get('recentPlaces', []);
    const pickPlace = (p) => { plan.dest = p; store.set('recentPlaces', [p, ...recents.filter((r) => r.name !== p.name)].slice(0, 5)); go(5); };
    const placeRow = (p, icon) => listItem({
      icon, title: p.name.split(',')[0], sub: p.name.split(',').slice(1, 3).join(',').trim() || ' ',
      trail: ctx.pos ? fmtDist(haversine([ctx.pos.lat, ctx.pos.lng], [p.lat, p.lng])).replace('now', '0 m') : null,
      onclick: () => pickPlace(p),
    });
    const showDefault = () => results.replaceChildren(
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
  };

  // 5 · Route (full-screen map with Best / Fastest / Scenic)
  const stepRoute = (box) => {
    if (!plan.dest) { go(4); return; }
    const mapEl = h('div', { class: 'map' });
    const pill = h('div', { class: 'place-pill' }, ic('location_on', { fill: true }), h('span', {}, engine.short(plan.dest.name)));
    const top = h('div', { style: 'position:absolute;top:12px;left:12px;right:12px;z-index:4;display:flex;gap:8px;align-items:center' },
      iconButton('arrow_back', { label: 'Back', style: 'surface', onclick: () => (firstStep === 5 ? back() : go(4)) }), pill);
    const opts = h('div', { class: 'route-options', role: 'radiogroup', 'aria-label': 'Route options' });
    const note = h('div', { class: 'row gap8 body-s variant', style: 'padding:12px 16px 0' });
    const start = button('Start ride', { size: 'large', wide: true, icon: 'play_arrow', disabled: true });
    const sheetEl = h('div', { class: 'route-sheet' }, h('div', { class: 'handle', style: 'width:32px;height:4px;border-radius:2px;background:var(--on-surface-variant);opacity:.4;margin:12px auto 12px' }),
      h('div', { class: 'steps-bar' }, STEP_NAMES.map(() => h('i', { class: 'on' }))),
      h('div', { class: 'label-l variant', style: 'padding:12px 16px 0' }, `Step 5 of 5 · Route · ${plan.mode === 'group' ? 'Group ride' : plan.pillion ? 'With pillion' : 'Solo'}`), opts, note, h('div', { style: 'padding:16px 16px 0' }, start));
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
        const res = await engine.fetchRoute(plan.dest);
        plan.options = res.options || [res];
        select(0);
        note.replaceChildren(ic('check_circle', { size: 18 }), 'Route saved on this phone · directions keep working if signal drops');
      } catch (e) {
        opts.replaceChildren(h('div', { class: 'body-m', style: 'grid-column:1/-1;color:var(--error)' }, e.message));
        note.replaceChildren(button('Try again', { style: 'text', onclick: () => go(5) }));
        start.lastChild.textContent = 'Ride without directions';
      }
      start.disabled = false;
    })();
    start.onclick = () => withLoading(start, async () => {
      if (plan.mode === 'group' && ctx.group && plan.route) api.put(`/api/groups/${ctx.group.id}/plan`, { destination: engine.short(plan.dest.name), lat: plan.dest.lat, lng: plan.dest.lng }).catch(() => {});
      startRide({ dest: plan.route ? plan.dest : null, route: plan.route });
    });
    return () => map.destroy();
  };

  go(firstStep);
  return () => cleanupStep?.();
});

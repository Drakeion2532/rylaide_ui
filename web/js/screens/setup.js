// 13 Start a ride · 5 steps: Where to → Who's riding → Checklist → Mic check → Route → 25 Ride hub
import { h, store, localDate, haversine, fmtKm, etaShort, fmtDist } from '../util.js';
import { api } from '../api.js';
import { ctx, onMany } from '../state.js';
import { ic, button, iconButton, listItem, avatar, checkbox, ring, snackbar, segmented, withLoading } from '../ui.js';
import { register, push, back, tab } from '../router.js';
import { RideMap } from '../map.js';
import { MicTest } from '../voice.js';
import { currentLight } from '../theme.js';
import * as engine from '../engine.js';

// ---------------------------------------------------------------- checklist model
function checklist({ distance = 0 } = {}) {
  const night = currentLight() !== 'day';
  const rain = (ctx.weather?.rain || 0) > 0.2;
  const long = distance > 150000, medium = distance > 50000;
  const S = [
    { id: 'bike', icon: 'two_wheeler', title: 'Bike', items: [
      { id: 'tyres', t: 'Tyres & pressure', req: true }, { id: 'brakes', t: 'Brakes front & rear', req: true },
      { id: 'lights', t: 'Lights & indicators', req: true }, { id: 'chain', t: 'Chain', req: true }, { id: 'fuel', t: 'Fuel for the first leg', req: true }] },
    { id: 'rider', icon: 'sports_motorsports', title: 'Rider', items: [{ id: 'helmet', t: 'Helmet & visor', req: true }, { id: 'gloves', t: 'Gloves & gear', req: true }] },
    { id: 'docs', icon: 'badge', title: 'Documents', items: [{ id: 'licence', t: 'Licence & RC', req: true }, { id: 'insurance', t: 'Insurance papers', req: false }] },
    { id: 'trip', icon: 'route', title: 'Trip', items: [
      { id: 'battery', t: 'Phone battery', req: true }, { id: 'headset', t: 'Headset paired', req: false },
      { id: 'rain', t: 'Rain gear', req: rain }, ...(medium ? [{ id: 'water', t: 'Water & snacks', req: long }] : []),
      ...(long ? [{ id: 'kit', t: 'Puncture kit & tools', req: true }] : []), ...(night ? [{ id: 'reflective', t: 'Reflective vest', req: false }] : [])] },
  ];
  const tags = [long ? 'Long' : medium ? 'Medium' : 'Short', night ? 'Night' : 'Day', ...(rain ? ['Rain'] : [])];
  return { sections: S, tags };
}
const tickKey = () => `ck.${localDate()}`;
export function checklistStatus() {
  const done = new Set(store.get(tickKey(), []));
  const req = checklist().sections.flatMap((s) => s.items.filter((i) => i.req));
  const left = req.filter((i) => !done.has(i.id)).length;
  return { done: left === 0, left };
}

// ---------------------------------------------------------------- setup flow
register('setup', (el, params) => {
  const plan = ctx.plan = { dest: params.quickDest || null, solo: !ctx.group, route: null, options: null, sel: 0 };
  let step = params.quickDest ? (params.step || 2) : (params.step || 1);
  let cleanupStep = null;
  const stepsBar = h('div', { class: 'steps-bar', 'aria-hidden': 'true' }, [1, 2, 3, 4, 5].map(() => h('i')));
  const head = h('header', { class: 'setup-head' });
  const caption = h('div', { class: 'step-caption label-l variant' });
  const content = h('div', { style: 'flex:1;min-height:0;display:flex;flex-direction:column;position:relative' });
  el.append(head, stepsBar, caption, content);

  const close = () => back();
  const go = (n) => {
    cleanupStep?.(); cleanupStep = null;
    step = n;
    stepsBar.querySelectorAll('i').forEach((b, i) => b.classList.toggle('on', i < n));
    const names = ['Where to', 'Who’s riding', 'Checklist', 'Mic check', 'Route'];
    caption.textContent = params.checkOnly ? 'Pre-ride checklist' : `Step ${n} of 5 · ${names[n - 1]}`;
    head.replaceChildren(
      iconButton(n === 1 || params.checkOnly || (params.quickDest && n === (params.step || 2)) ? 'close' : 'arrow_back', { label: n === 1 ? 'Close' : 'Back', onclick: () => (n === 1 || params.checkOnly || (params.quickDest && n === (params.step || 2)) ? close() : go(n - 1)) }),
      n === 3 ? iconButton('tune', { label: 'Checklist options', onclick: () => snackbar('Items adapt to your trip length, the time and the weather.') }) : h('span'));
    const wrap = h('div', { class: 'enter-fade', style: 'flex:1;min-height:0;display:flex;flex-direction:column' });
    content.replaceChildren(wrap);
    cleanupStep = [stepWhere, stepWho, stepCheck, stepMic, stepRoute][n - 1](wrap) || null;
    el.dataset.step = n;
  };
  el.dataset.blockBack = '0';

  // 1 · Where to
  const stepWhere = (box) => {
    const input = h('input', { 'aria-label': 'Search a place', placeholder: 'Search a place', enterkeyhint: 'search', autocomplete: 'off' });
    const results = h('div', { class: 'list plain', style: 'margin-top:8px' });
    const recents = store.get('recentPlaces', []);
    const placeRow = (p, icon) => listItem({
      icon, title: p.name.split(',')[0], sub: p.name.split(',').slice(1, 3).join(',').trim() || ' ',
      trail: ctx.pos ? fmtDist(haversine([ctx.pos.lat, ctx.pos.lng], [p.lat, p.lng])).replace('now', '0 m') : null,
      onclick: () => { plan.dest = p; store.set('recentPlaces', [p, ...recents.filter((r) => r.name !== p.name)].slice(0, 5)); go(2); },
    });
    const showDefault = () => results.replaceChildren(
      ctx.group?.plan ? h('div', { class: 'section-label title-s', style: 'padding-left:16px' }, 'Group plan') : null,
      ctx.group?.plan ? placeRow({ name: ctx.group.plan.destination, lat: ctx.group.plan.lat, lng: ctx.group.plan.lng }, 'bookmark') : null,
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
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 450); }); // Nominatim allows ~1 req/s
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(t); search(); } });
    box.append(h('div', { class: 'screen-body', style: 'padding:16px 16px 0' },
      h('h1', { class: 'headline-m', style: 'margin-bottom:16px' }, 'Where are you riding?'),
      h('form', { class: 'search-bar', onsubmit: (e) => { e.preventDefault(); clearTimeout(t); search(); } }, ic('search'), input, iconButton('arrow_forward', { label: 'Search', attrs: { type: 'submit' } })),
      results),
    h('div', { class: 'screen-foot' }, button('Just ride · no destination', { style: 'tonal', size: 'large', wide: true, icon: 'two_wheeler', onclick: () => { engine.startRide({ solo: !ctx.group }); push('ride', {}, { replace: true }); } })));
    showDefault();
    setTimeout(() => input.focus(), 350);
  };

  // 2 · Who's riding
  const stepWho = (box) => {
    const body = h('div', { class: 'screen-body pad' });
    const render = () => {
      const g = ctx.group;
      const rows = [h('button', { type: 'button', class: `rider-row${plan.solo ? ' selected' : ''}`, style: 'border:0;width:100%;text-align:left;color:inherit;border-radius:16px 16px 4px 4px', onclick: () => { plan.solo = true; render(); } },
        h('span', { class: 'avatar accent' }, ic('person')), h('span', { class: 'main' }, h('span', { class: 'body-l' }, 'Ride solo'), h('span', { class: 'body-m variant' }, 'Rides are still recorded')), ic(plan.solo ? 'radio_button_checked' : 'radio_button_unchecked', { fill: plan.solo }))];
      for (const grp of ctx.groups) {
        const sel = !plan.solo && g?.id === grp.id;
        const on = grp.members.filter((m) => m.online || m.id === ctx.user.id).length;
        rows.push(h('button', { type: 'button', class: `rider-row${sel ? ' selected' : ''}`, style: 'border:0;width:100%;text-align:left;color:inherit;margin-top:2px', onclick: () => { plan.solo = false; engine.openGroup(grp); render(); } },
          h('span', { class: 'avatar' }, ic('groups')), h('span', { class: 'main' }, h('span', { class: 'body-l' }, grp.name), h('span', { class: 'body-m variant' }, `${grp.members.length} riders · ${on} online`)), ic(sel ? 'radio_button_checked' : 'radio_button_unchecked', { fill: sel })));
      }
      body.replaceChildren(h('h1', { class: 'headline-m', style: 'margin:16px 0' }, 'Who’s riding?'), h('div', { class: 'list' }, rows),
        !plan.solo && g ? h('div', { class: 'section-label title-s', style: 'padding-left:4px' }, `In ${g.name}`, h('span', { class: 'count label-m' }, `${g.members.length}`)) : null,
        !plan.solo && g ? h('div', { class: 'list' }, g.members.map((m) => {
          const me = m.id === ctx.user.id;
          return h('div', { class: 'rider-row' }, avatar(m.name, { status: m.online || me ? 'connected' : 'off' }),
            h('span', { class: 'main' }, h('span', { class: 'body-l' }, me ? `${m.name} (you)` : m.name), h('span', { class: 'body-m variant' }, me ? 'Ready' : m.online ? 'Online' : 'Offline')),
            m.online || me ? h('span', { class: 'status compact ok' }, ic('check_circle'), 'Ready') : h('span', { class: 'label-m variant' }, 'Will join'));
        })) : null,
        !ctx.groups.length ? h('p', { class: 'body-m variant mt16' }, 'To ride with friends, create or join a group in the Groups tab first.') : null);
    };
    render();
    box.append(body, h('div', { class: 'screen-foot' }, button('Continue', { size: 'large', wide: true, onclick: () => go(3) })));
    return onMany({ group: render, groups: render });
  };

  // 3 · Checklist
  const stepCheck = (box) => {
    const done = new Set(store.get(tickKey(), []));
    const { sections, tags } = checklist({ distance: plan.route?.distance || (plan.dest && ctx.pos ? haversine([ctx.pos.lat, ctx.pos.lng], [plan.dest.lat, plan.dest.lng]) * 1.3 : 0) });
    const all = sections.flatMap((s) => s.items);
    const num = h('div', { class: 'headline-l' });
    const r = ring(0, { size: 112, stroke: 10, center: h('div', { class: 'num' }, num, h('div', { class: 'body-s variant' }, `of ${all.length}`)) });
    const left = h('p', { class: 'body-m variant' });
    const ready = button(params.checkOnly ? 'Done' : 'Ready to ride', { size: 'large', wide: true, onclick: () => (params.checkOnly ? close() : go(4)) });
    const update = () => {
      const n = all.filter((i) => done.has(i.id)).length;
      const reqLeft = all.filter((i) => i.req && !done.has(i.id)).length;
      num.textContent = String(n);
      r.set(n / all.length);
      left.textContent = reqLeft ? `${reqLeft} left to check` : 'All required items done';
      ready.disabled = !params.checkOnly && reqLeft > 0;
      store.set(tickKey(), [...done]);
    };
    const item = (it) => {
      const state = h('span', { class: 'label-m' });
      const row = h('div', { class: 'check-item' });
      const sync = () => {
        const on = done.has(it.id);
        row.classList.toggle('req', it.req && !on);
        state.className = 'label-m';
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
        h('div', { class: 'section-label title-s', style: 'padding-left:4px' }, ic(s.icon), s.title, h('span', { class: 'count label-m' }, `${s.items.filter((i) => done.has(i.id)).length}/${s.items.length}`)),
        h('div', { class: 'list' }, s.items.map(item))]))),
    h('div', { class: 'screen-foot stack gap8' }, ready, params.checkOnly ? null : button('Skip for now', { style: 'text', wide: true, onclick: () => go(4) })));
    // keep section counts in sync
    box.addEventListener('change', () => box.querySelectorAll('.section-label .count').forEach((c, i) => (c.textContent = `${sections[i].items.filter((x) => done.has(x.id)).length}/${sections[i].items.length}`)));
    update();
  };

  // 4 · Mic check
  const stepMic = (box) => {
    const meter = h('i', { style: 'width:0;transition:width 80ms linear' });
    const status = h('p', { class: 'body-m variant', role: 'status' }, 'Say something into your headset.');
    const test = new MicTest({ onLevel: (l) => (meter.style.width = `${Math.round(l * 100)}%`), onStatus: () => {} });
    let heard = false;
    const ok = button('Sounds good', { size: 'large', wide: true, onclick: () => go(5) });
    const levelWatch = setInterval(() => { if (parseFloat(meter.style.width) > 8 && !heard) { heard = true; status.textContent = 'We can hear you. You’re set.'; } }, 200);
    test.start(store.get('micId', '')).then((label) => { status.textContent = `Listening on “${label}”. Say something.`; }).catch((e) => { status.textContent = e.message; });
    const nc = h('button', { type: 'button', class: `chip${ctx.noiseCancel ? ' selected' : ''}`, onclick: () => { ctx.noiseCancel = !ctx.noiseCancel; store.set('noiseCancel', ctx.noiseCancel); nc.className = `chip${ctx.noiseCancel ? ' selected' : ''}`; nc.replaceChildren(ic(ctx.noiseCancel ? 'check' : 'noise_control_off'), `Noise cancel ${ctx.noiseCancel ? 'on' : 'off'}`); } }, ic(ctx.noiseCancel ? 'check' : 'noise_control_off'), `Noise cancel ${ctx.noiseCancel ? 'on' : 'off'}`);
    box.append(h('div', { class: 'screen-body pad stack gap16' },
      h('h1', { class: 'headline-m', style: 'margin-top:16px' }, 'Check your mic'),
      h('div', { class: 'card pad stack gap16', style: 'align-items:center;text-align:center;padding:32px 16px' },
        h('span', { class: 'avatar l accent', style: 'width:80px;height:80px' }, ic('headset_mic', { size: 36 })),
        h('div', { class: 'progress-linear', style: 'height:12px;border-radius:6px;width:100%' }, meter), status),
      h('div', {}, nc), h('p', { class: 'body-s variant' }, 'Hold the mic button during the ride to talk. Your group hears you through their headsets.')),
    h('div', { class: 'screen-foot stack gap8' }, ok, button('Skip', { style: 'text', wide: true, onclick: () => go(5) })));
    return () => { clearInterval(levelWatch); test.stop(); };
  };

  // 5 · Route
  const stepRoute = (box) => {
    if (!plan.dest) {
      box.append(h('div', { class: 'screen-body pad' }, h('div', { class: 'empty' }, ic('two_wheeler'), h('p', { class: 'title-m', style: 'color:var(--on-surface)' }, 'No destination'), h('p', { class: 'body-m' }, 'Ride freely. Your route is recorded as you go.'))),
        h('div', { class: 'screen-foot' }, button('Start ride', { size: 'large', wide: true, icon: 'play_arrow', onclick: () => { engine.startRide({ solo: plan.solo }); push('ride', {}, { replace: true }); } })));
      return;
    }
    caption.hidden = true; stepsBar.hidden = true; head.hidden = true;
    const mapEl = h('div', { class: 'map' });
    const pill = h('div', { class: 'place-pill' }, ic('location_on', { fill: true }), h('span', {}, engine.short(plan.dest.name)));
    const top = h('div', { style: 'position:absolute;top:12px;left:12px;right:12px;z-index:4;display:flex;gap:8px;align-items:center' },
      iconButton('arrow_back', { label: 'Back', style: 'surface', onclick: () => (params.quickDest && (params.step || 2) === 5 ? close() : go(4)) }), pill);
    const opts = h('div', { class: 'route-options', role: 'radiogroup', 'aria-label': 'Route options' });
    const note = h('div', { class: 'row gap8 body-s variant', style: 'padding:12px 16px 0' });
    const start = button('Start ride', { size: 'large', wide: true, icon: 'play_arrow', disabled: true });
    const sheetEl = h('div', { class: 'route-sheet' }, h('div', { class: 'handle', style: 'width:32px;height:4px;border-radius:2px;background:var(--on-surface-variant);opacity:.4;margin:12px auto 12px' }),
      h('div', { class: 'steps-bar' }, [1, 2, 3, 4, 5].map(() => h('i', { class: 'on' }))),
      h('div', { class: 'label-l variant', style: 'padding:12px 16px 0' }, 'Step 5 of 5 · Route'), opts, note, h('div', { style: 'padding:16px 16px 0' }, start));
    box.append(h('div', { style: 'position:relative;flex:1' }, mapEl, top, sheetEl));
    const map = new RideMap(mapEl, { zoom: 12 });
    map.init();
    if (ctx.pos) { map.setOrigin(ctx.pos.lng, ctx.pos.lat); }
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
        start.disabled = false;
      } catch (e) {
        opts.replaceChildren(h('div', { class: 'body-m', style: 'grid-column:1/-1;color:var(--error)' }, e.message));
        note.replaceChildren(button('Try again', { style: 'text', onclick: () => go(5) }));
        start.disabled = false;
        start.lastChild.textContent = 'Ride without directions';
      }
    })();
    start.onclick = () => withLoading(start, async () => {
      if (!plan.solo && ctx.group && plan.route) { api.put(`/api/groups/${ctx.group.id}/plan`, { destination: engine.short(plan.dest.name), lat: plan.dest.lat, lng: plan.dest.lng }).catch(() => {}); }
      engine.startRide({ dest: plan.route ? plan.dest : null, route: plan.route, solo: plan.solo });
      push('ride', {}, { replace: true });
    });
    return () => { map.destroy(); caption.hidden = false; stepsBar.hidden = false; head.hidden = false; };
  };

  go(step);
  return () => cleanupStep?.();
});

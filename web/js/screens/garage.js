// 12 Garage → 11d Fuel log · 43 Settings → Appearance, Riding, Emergency contacts, Mic test
import { h, fmtInt, store, localDate, native } from '../util.js';
import { api } from '../api.js';
import { ctx, rt, emit, setting, setSetting, onMany } from '../state.js';
import { ACCENTS, applyTheme, currentLight } from '../theme.js';
import { ic, button, iconButton, listItem, switchEl, field, sheet, dialog, snackbar, segmented, withLoading, liftOnScroll } from '../ui.js';
import { register, push, back } from '../router.js';
import { MicTest, listMics } from '../voice.js';
import { bikeForm, saveBike } from '../bikeform.js';
import { heroImage, TYPES, vehicleType } from '../vehicles.js';

export function editBikeSheet() {
  sheet((close) => {
    const form = bikeForm({ vehicle: ctx.user.vehicle || {}, onSurface: true });
    const go = button('Save bike', { size: 'large', wide: true, type: 'submit' });
    return h('form', { class: 'stack gap16', onsubmit: async (e) => {
      e.preventDefault();
      await withLoading(go, async () => {
        try {
          ctx.user = await saveBike(api, form);
          store.set('user', ctx.user); emit('user', ctx.user); close(); snackbar('Bike saved');
        } catch (err) { form.setError(err.message); }
      });
    } }, h('h2', { class: 'headline-s' }, 'Your bike'), form.el, go);
  });
}

register('garage', (el) => {
  const bar = h('header', { class: 'topbar' }, h('h1', { class: 'title title-l', style: 'padding-left:12px' }, 'Garage'), iconButton('settings', { label: 'Settings', onclick: () => push('settings') }));
  const body = h('div', { class: 'screen-body pad' });
  el.append(bar, body);
  liftOnScroll(bar, body);
  const render = (fuel) => {
    const v = ctx.user?.vehicle || {};
    const parked = store.get('parking', null);
    body.replaceChildren(
      h('section', { class: 'hero', style: `min-height:260px;max-height:300px;background-image:url("${heroImage(v)}")` },
        h('span', { class: 'tag-glass label-m' }, ic('two_wheeler'), 'My ride'),
        iconButton('edit', { label: 'Edit bike', style: 'glass', small: true, onclick: editBikeSheet, attrs: { class: 'icon-btn glass small swap' } }),
        h('div', { class: 'info' }, h('div', {}, h('div', { class: 'title-s make' }, [v.make, TYPES[vehicleType(v)].label].filter(Boolean).join(' · ') || 'Add your bike'), h('div', { class: 'headline-l' }, v.model || 'Tap edit to add it')),
          h('div', { class: 'stats' }, h('div', {}, h('div', { class: 'v' }, h('span', { class: 'title-l' }, v.odometer ? fmtInt(v.odometer) : '–'), h('span', { class: 'title-s l' }, 'km')), h('div', { class: 'label-m l' }, 'Odometer'))))),
      h('div', { class: 'section-label title-s', style: 'padding-left:4px' }, 'Your bike'),
      h('div', { class: 'list' },
        listItem({ icon: 'local_gas_station', title: 'Fuel log', sub: fuel?.stats.avgKmpl ? `${fuel.stats.avgKmpl} km/l average · ₹${fmtInt(fuel.stats.totalSpent)} spent` : 'Log fill-ups to track mileage', trail: ic('chevron_right'), onclick: () => push('fuel') }),
        listItem({ icon: 'checklist', title: 'Pre-ride checklist', sub: 'Lights, chain, tyres, documents', trail: ic('chevron_right'), onclick: () => push('setup', { step: 3, checkOnly: true }) }),
        parked ? listItem({ icon: 'local_parking', title: 'Where you parked', sub: `Saved ${new Date(parked.at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`, trail: ic('open_in_new'), onclick: () => window.open(`https://www.openstreetmap.org/?mlat=${parked.lat}&mlon=${parked.lng}#map=18/${parked.lat}/${parked.lng}`, '_blank', 'noopener') }) : null),
      h('div', { class: 'section-label title-s', style: 'padding-left:4px' }, 'Ride ready'),
      h('div', { class: 'list' },
        listItem({ icon: 'mic', title: 'Mic test', sub: 'Check your helmet headset', trail: ic('chevron_right'), onclick: () => push('mictest') }),
        listItem({ icon: 'emergency', title: 'Emergency contacts', sub: ctx.contacts.length ? ctx.contacts.map((c) => c.name).join(', ') : 'Who SOS should call', trail: ic('chevron_right'), onclick: () => push('contacts') }),
        listItem({ icon: 'settings', title: 'Settings', sub: 'Appearance, Glove Mode, directions', trail: ic('chevron_right'), onclick: () => push('settings') })),
      h('div', { style: 'height:24px' }));
  };
  render();
  api.get('/api/fuel').then(render).catch(() => {});
  return onMany({ user: () => render(), settings: () => render() });
});

// ---------------------------------------------------------------- fuel log
register('fuel', (el) => {
  const bar = h('header', { class: 'topbar' }, iconButton('arrow_back', { label: 'Back', onclick: back }), h('h1', { class: 'title title-l' }, 'Fuel log'));
  const body = h('div', { class: 'screen-body pad' });
  const fab = h('button', { type: 'button', class: 'fab', style: 'position:absolute;right:16px;bottom:calc(16px + var(--safe-b));z-index:5', onclick: () => addSheet() }, ic('add'), 'Add fill-up');
  el.append(bar, body, fab);
  liftOnScroll(bar, body);
  const draw = ({ entries, stats }) => {
    const NS = 'http://www.w3.org/2000/svg';
    const pts = entries.filter((e) => e.kmpl).reverse();
    let chart = null;
    if (pts.length >= 2) {
      const W = 300, H = 72, lo = Math.min(...pts.map((p) => p.kmpl)) * 0.92, hi = Math.max(...pts.map((p) => p.kmpl)) * 1.04;
      const X = (i) => (i * W) / (pts.length - 1), Y = (v) => H - ((v - lo) / (hi - lo || 1)) * H;
      const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Mileage per full tank, latest ${pts[pts.length - 1].kmpl} km/l`);
      const pl = document.createElementNS(NS, 'polyline');
      Object.entries({ points: pts.map((p, i) => `${X(i)},${Y(p.kmpl)}`).join(' '), fill: 'none', stroke: 'var(--primary)', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }).forEach(([k, v]) => pl.setAttribute(k, v));
      svg.append(pl);
      chart = h('div', { class: 'speed-chart' }, h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:12px' }, h('span', { class: 'title-s' }, 'Mileage'), h('span', { class: 'body-s variant' }, `latest ${pts[pts.length - 1].kmpl} km/l`)),
        h('div', { style: 'position:relative' }, svg, ...pts.map((p, i) => h('span', { title: `${p.date}: ${p.kmpl} km/l`, style: `position:absolute;left:${(X(i) / W) * 100}%;top:${(Y(p.kmpl) / H) * 72}px;width:8px;height:8px;margin:-4px;border-radius:50%;background:var(--primary)` }))));
    }
    body.replaceChildren(
      h('div', { class: 'stat-row', style: 'margin-top:8px' },
        h('div', { class: 'stat tile' }, h('div', { class: 'v' }, h('span', { class: 'ride-metric' }, stats.avgKmpl ?? '–'), h('span', { class: 'u' }, 'km/l')), h('span', { class: 'l' }, 'Average')),
        h('div', { class: 'stat tile' }, h('span', { class: 'ride-metric' }, stats.totalSpent ? `₹${fmtInt(stats.totalSpent)}` : '–'), h('span', { class: 'l' }, 'Spent')),
        h('div', { class: 'stat tile' }, h('div', { class: 'v' }, h('span', { class: 'ride-metric' }, stats.totalLitres || '–'), h('span', { class: 'u' }, 'L')), h('span', { class: 'l' }, 'Fuel'))),
      chart ? h('div', { class: 'mt16' }, chart) : null,
      entries.length
        ? h('div', { class: 'list mt16' }, entries.map((e) => listItem({
          icon: e.full ? 'local_gas_station' : 'water_drop', title: `${fmtInt(e.odometer)} km`, sub: `${e.date} · ${e.litres} L · ₹${e.pricePerLitre}/L${e.full ? '' : ' · partial'}`,
          trail: h('span', { class: 'row gap8' }, e.kmpl ? h('span', { class: 'title-s', style: 'color:var(--on-surface)' }, `${e.kmpl} km/l`) : null,
            iconButton('delete', { label: `Delete fill-up at ${e.odometer} km`, small: true, onclick: async () => {
              try { const d = await api.del(`/api/fuel/${e.id}`); draw(d); snackbar('Fill-up deleted', { action: { label: 'Undo', run: async () => { try { draw(await api.post('/api/fuel', e)); } catch (err) { snackbar(err.message); } } } }); } catch (err) { snackbar(err.message); }
            } })),
        })))
        : h('div', { class: 'empty' }, ic('local_gas_station'), h('p', { class: 'body-m' }, 'Log each fill-up. Mileage appears from your second full tank.')),
      h('div', { style: 'height:96px' }));
  };
  const addSheet = () => sheet((close) => {
    const odo = field({ label: 'Odometer (km)', type: 'number', attrs: { inputmode: 'decimal', min: 0, step: '0.1', name: 'odometer' }, onSurface: true });
    const litres = field({ label: 'Litres', type: 'number', attrs: { inputmode: 'decimal', min: 0.1, step: '0.01', name: 'litres' }, onSurface: true });
    const price = field({ label: 'Price per litre (₹)', type: 'number', value: store.get('lastPrice', ''), attrs: { inputmode: 'decimal', min: 0, step: '0.01', name: 'price' }, onSurface: true });
    const date = field({ label: 'Date', type: 'date', value: localDate(), onSurface: true });
    let full = true;
    const go = button('Add fill-up', { size: 'large', wide: true, type: 'submit' });
    setTimeout(() => odo.input.focus(), 320);
    return h('form', { class: 'stack gap16', onsubmit: async (e) => {
      e.preventDefault();
      await withLoading(go, async () => {
        try {
          const d = await api.post('/api/fuel', { odometer: odo.input.value, litres: litres.input.value, pricePerLitre: price.input.value, date: date.input.value, full });
          store.set('lastPrice', price.input.value);
          if (ctx.user?.vehicle && Number(odo.input.value) > (ctx.user.vehicle.odometer || 0)) {
            api.patch('/api/me', { vehicle: { ...ctx.user.vehicle, odometer: odo.input.value } }).then((r) => { ctx.user = r.user; store.set('user', r.user); emit('user', r.user); }).catch(() => {});
          }
          close(); draw(d);
          snackbar(d.entries[0]?.kmpl ? `Added: ${d.entries[0].kmpl} km/l since your last full tank` : 'Fill-up added');
        } catch (err) { odo.setError(err.message); }
      });
    } }, h('h2', { class: 'headline-s' }, 'Add fill-up'), odo, h('div', { class: 'row gap12' }, h('div', { class: 'grow' }, litres), h('div', { class: 'grow' }, price)), date,
      listItem({ title: 'Filled to full tank', sub: 'Needed to work out mileage', trail: switchEl({ checked: true, label: 'Filled to full tank', onchange: (v) => (full = v) }), cls: 'switch-row' }), go);
  });
  api.get('/api/fuel').then(draw).catch((e) => body.replaceChildren(h('div', { class: 'empty' }, ic('cloud_off'), h('p', {}, e.message))));
});

// ---------------------------------------------------------------- settings
register('settings', (el) => {
  const bar = h('header', { class: 'topbar' }, iconButton('arrow_back', { label: 'Back', onclick: back }), h('h1', { class: 'title title-l' }, 'Settings'));
  const body = h('div', { class: 'screen-body pad' });
  el.append(bar, body);
  liftOnScroll(bar, body);
  const render = () => {
    const u = ctx.user;
    const name = field({ label: 'Your name', value: u.name, attrs: { maxlength: 40 } });
    const themeSeg = segmented([{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], setting('theme', 'auto'), (v) => { setSetting('theme', v); applyTheme(); render(); }, { label: 'Theme' });
    const light = currentLight();
    body.replaceChildren(
      h('div', { class: 'section-title title-s' }, 'Profile'),
      h('form', { class: 'row gap8', onsubmit: async (e) => {
        e.preventDefault();
        try { ctx.user = (await api.patch('/api/me', { name: name.input.value })).user; store.set('user', ctx.user); emit('user', ctx.user); snackbar('Name saved'); } catch (err) { name.setError(err.message); }
      } }, h('div', { class: 'grow' }, name), button('Save', { style: 'tonal', type: 'submit' })),
      h('div', { class: 'list mt8' }, listItem({ icon: TYPES[vehicleType(u.vehicle)].icon, title: 'Your bike', sub: [u.vehicle?.make, u.vehicle?.model].filter(Boolean).join(' ') || 'Not added', trail: ic('chevron_right'), onclick: editBikeSheet })),

      h('div', { class: 'section-title title-s' }, 'Appearance'),
      themeSeg,
      h('p', { class: 'body-s variant', style: 'padding:8px 4px 0' }, setting('theme', 'auto') === 'auto' ? `Auto follows sunrise and sunset where you are. Right now: ${light === 'day' ? 'Day' : light === 'evening' ? 'Evening' : 'Night'}.` : 'Fixed until you switch back to Auto.'),
      h('div', { class: 'title-s', style: 'padding:20px 4px 12px' }, 'Accent colour'),
      h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Accent colour' }, Object.entries(ACCENTS).map(([k, a]) => h('button', {
        type: 'button', class: 'swatch', role: 'radio', 'aria-checked': String(setting('accent', 'blue') === k), 'aria-label': a.name, style: `background:${light === 'day' ? a.l[0] : a.d[0]};color:${light === 'day' ? a.l[1] : a.d[1]}`,
        onclick: () => { setSetting('accent', k); applyTheme(); render(); },
      }, ic('check')))),
      h('div', { class: 'list mt16' },
        listItem({ icon: 'back_hand', title: 'Glove Mode', sub: 'Bigger buttons and ride controls', trail: switchEl({ checked: setting('glove', false), label: 'Glove Mode', onchange: (v) => { setSetting('glove', v); applyTheme(); } }) })),

      h('div', { class: 'section-title title-s' }, 'Riding'),
      h('div', { class: 'list' },
        listItem({ icon: 'record_voice_over', title: 'Spoken directions', sub: 'Turn-by-turn in your headset', trail: switchEl({ checked: setting('speak', true), label: 'Spoken directions', onchange: (v) => setSetting('speak', v) }) }),
        listItem({ icon: 'share_location', title: 'Share my location', sub: 'Only with the group you ride with', trail: switchEl({ checked: setting('share', true), label: 'Share my location', onchange: (v) => setSetting('share', v) }) }),
        listItem({ icon: 'noise_control_off', title: 'Noise cancel', sub: 'Reduce wind noise when you talk', trail: switchEl({ checked: ctx.noiseCancel, label: 'Noise cancel', onchange: (v) => { ctx.noiseCancel = v; store.set('noiseCancel', v); } }) })),

      h('div', { class: 'section-title title-s' }, 'Safety and audio'),
      h('div', { class: 'list' },
        listItem({ icon: 'emergency', title: 'Emergency contacts', sub: ctx.contacts.length ? `${ctx.contacts.length} saved` : 'None yet', trail: ic('chevron_right'), onclick: () => push('contacts') }),
        listItem({ icon: 'mic', title: 'Mic test', sub: 'Check your headset', trail: ic('chevron_right'), onclick: () => push('mictest') })),

      h('div', { class: 'section-title title-s' }, 'About'),
      native() ? h('div', { class: 'list', style: 'margin-bottom:12px' }, listItem({ icon: 'dns', title: 'App server', sub: (() => { try { return native().serverUrl(); } catch { return location.origin; } })(), trail: ic('chevron_right'), onclick: () => native().openServerSettings() })) : null,
      h('p', { class: 'body-s variant', style: 'padding:0 4px' }, 'Rylaide prototype. Map data © OpenStreetMap contributors, tiles by OpenFreeMap, weather by MET Norway.'),
      h('div', { class: 'mt16', style: 'padding-bottom:32px' }, button('Sign out of this phone', { style: 'danger-outlined', wide: true, icon: 'logout', onclick: async () => {
        if (!(await dialog({ title: 'Sign out?', body: 'This prototype has no passwords, so you can’t sign back in to this account. You’ll start fresh.', confirm: 'Sign out', danger: true }))) return;
        rt.close(); api.setToken(null); ['user', 'groupId'].forEach(store.del); location.reload();
      } })));
  };
  render();
});

// ---------------------------------------------------------------- emergency contacts (51)
register('contacts', (el) => {
  const bar = h('header', { class: 'topbar' }, iconButton('arrow_back', { label: 'Back', onclick: back }), h('h1', { class: 'title title-l' }, 'Emergency contacts'));
  const rows = h('div', { class: 'stack gap12' });
  const row = (c = { name: '', phone: '' }) => {
    const n = field({ label: 'Name', value: c.name, attrs: { maxlength: 40, class: 'c-name' } });
    const p = field({ label: 'Phone', value: c.phone, type: 'tel', attrs: { maxlength: 20, inputmode: 'tel', class: 'c-phone' } });
    const r = h('div', { class: 'card pad stack gap12 contact-row' }, n, h('div', { class: 'row gap8' }, h('div', { class: 'grow' }, p), iconButton('delete', { label: 'Remove contact', onclick: () => r.remove() })));
    return r;
  };
  const list = ctx.contacts.length ? ctx.contacts : [{ name: '', phone: '' }];
  rows.append(...list.map(row));
  const save = button('Save contacts', { size: 'large', wide: true });
  save.onclick = () => withLoading(save, async () => {
    const contacts = [...rows.querySelectorAll('.contact-row')].map((r) => ({ name: r.querySelector('.c-name').value, phone: r.querySelector('.c-phone').value })).filter((c) => c.name || c.phone);
    try {
      const r = await api.put('/api/contacts', { contacts });
      const dropped = contacts.length - r.contacts.length;
      ctx.contacts = r.contacts;
      snackbar(dropped ? `Saved ${r.contacts.length}. ${dropped} skipped: each needs a name and a full phone number.` : 'Emergency contacts saved');
      if (!dropped) back();
    } catch (e) { snackbar(e.message); }
  });
  el.append(bar, h('div', { class: 'screen-body pad' },
    h('p', { class: 'body-m variant', style: 'margin:0 0 16px' }, 'SOS shows call and text buttons for these people, in this order. Up to 5.'),
    rows, h('div', { class: 'mt16' }, button('Add contact', { style: 'outlined', icon: 'add', onclick: () => { if (rows.children.length >= 5) return snackbar('You can add up to 5 contacts.'); rows.append(row()); } }))),
  h('div', { class: 'screen-foot' }, save));
});

// ---------------------------------------------------------------- mic test
register('mictest', (el) => {
  const bar = h('header', { class: 'topbar' }, iconButton('arrow_back', { label: 'Back', onclick: back }), h('h1', { class: 'title title-l' }, 'Mic test'));
  const meter = h('i', { style: 'width:0' });
  const status = h('p', { class: 'body-m variant', role: 'status' }, 'Start the test and say something.');
  const level = h('div', { class: 'progress-linear', style: 'height:12px;border-radius:6px', 'aria-label': 'Microphone level' }, meter);
  meter.style.transition = 'width 80ms linear';
  const test = new MicTest({ onLevel: (l) => (meter.style.width = `${Math.round(l * 100)}%`), onStatus: (s) => (status.textContent = s) });
  const select = h('select', { 'aria-label': 'Microphone' }, h('option', { value: '' }, 'Default microphone'));
  const selField = h('label', { class: 'field' }, select, h('label', {}, 'Microphone'));
  const refresh = async () => {
    const mics = await listMics();
    const cur = store.get('micId', '');
    select.replaceChildren(h('option', { value: '' }, 'Default microphone'), ...mics.filter((m) => m.deviceId && m.deviceId !== 'default').map((m, i) => h('option', { value: m.deviceId, selected: m.deviceId === cur }, m.label || `Microphone ${i + 1}`)));
  };
  const rec = button('Record 3 seconds', { style: 'tonal', icon: 'fiber_manual_record', disabled: true });
  const play = button('Play it back', { style: 'outlined', icon: 'play_arrow', disabled: true });
  const start = button('Start test', { icon: 'mic' });
  start.onclick = async () => { try { await test.start(select.value); rec.disabled = false; start.lastChild.textContent = 'Restart test'; refresh(); } catch (e) { status.textContent = e.message; } };
  rec.onclick = async () => { rec.disabled = true; try { if (await test.record(3000)) play.disabled = false; } catch (e) { status.textContent = e.message; } rec.disabled = false; };
  play.onclick = () => test.play().catch(() => (status.textContent = 'Couldn’t play the recording.'));
  select.onchange = () => { store.set('micId', select.value); if (test.stream) start.click(); };
  el.append(bar, h('div', { class: 'screen-body pad stack gap16' },
    h('p', { class: 'body-m variant' }, 'Connect your helmet headset or earphones, then check that the bar moves when you speak.'),
    selField, level, status, h('div', { class: 'row gap8', style: 'flex-wrap:wrap' }, start, rec, play)));
  return () => test.stop();
});

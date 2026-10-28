// 11d Fuel log · 51 Emergency contacts · Mic test · Home's quick bike editor (Garage tab and vehicles: vehicles.js; Settings: settings.js)
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

// ---------------------------------------------------------------- fuel log
register('fuel', (el, params) => {
  const vid = params.vehicleId || ctx.user?.vehicle?.id || '';
  const bar = h('header', { class: 'topbar' }, iconButton('arrow_back', { label: 'Back', onclick: back }), h('h1', { class: 'title title-l' }, params.title ? `Fuel · ${params.title}` : 'Fuel log'));
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
              try { const d = await api.del(`/api/fuel/${e.id}`); draw(d); snackbar('Fill-up deleted', { action: { label: 'Undo', run: async () => { try { draw(await api.post('/api/fuel', { ...e, vehicleId: vid })); } catch (err) { snackbar(err.message); } } } }); } catch (err) { snackbar(err.message); }
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
          const d = await api.post('/api/fuel', { vehicleId: vid, odometer: odo.input.value, litres: litres.input.value, pricePerLitre: price.input.value, date: date.input.value, full });
          store.set('lastPrice', price.input.value);
          if (d.user) { ctx.user = d.user; store.set('user', d.user); emit('user', d.user); } // odometer follows the fuel log
          close(); draw(d);
          snackbar(d.entries[0]?.kmpl ? `Added: ${d.entries[0].kmpl} km/l since your last full tank` : 'Fill-up added');
        } catch (err) { odo.setError(err.message); }
      });
    } }, h('h2', { class: 'headline-s' }, 'Add fill-up'), odo, h('div', { class: 'row gap12' }, h('div', { class: 'grow' }, litres), h('div', { class: 'grow' }, price)), date,
      listItem({ title: 'Filled to full tank', sub: 'Needed to work out mileage', trail: switchEl({ checked: true, label: 'Filled to full tank', onchange: (v) => (full = v) }), cls: 'switch-row' }), go);
  });
  // Bike switcher: each vehicle keeps its own fuel log (Figma: multi-vehicle)
  const switcher = h('div', { class: 'row gap8 bike-filter', style: 'flex-wrap:wrap;padding:0 16px 8px' });
  el.insertBefore(switcher, body);
  api.get('/api/vehicles').then(({ vehicles }) => {
    if (vehicles.length < 2) return;
    switcher.replaceChildren(...vehicles.map((v) => h('button', { type: 'button', class: `chip${v.id === vid ? ' on' : ''}`, 'data-bike': v.id, 'aria-pressed': String(v.id === vid),
      onclick: () => v.id !== vid && push('fuel', { vehicleId: v.id, title: v.nickname || v.model }, { replace: true }) }, v.id === vid ? ic('check', { size: 18 }) : null, v.nickname || v.model || v.make)));
  }).catch(() => {});
  api.get(`/api/fuel?vehicle=${vid}`).then(draw).catch((e) => body.replaceChildren(h('div', { class: 'empty' }, ic('cloud_off'), h('p', {}, e.message))));
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

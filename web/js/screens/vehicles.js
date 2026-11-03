// Copyright (c) 2026 Shubhan Punde · https://github.com/Drakeion2532/rylaide_ui · All rights reserved · sp2532-ce395384fbda
// Garage graph (Figma navigation map): 12 My vehicles → 11 Vehicle → 11d Fuel log → 11e Add / 11f Edit · 11j Service
import { h, fmtInt, store, localDate } from '../util.js';
import { api } from '../api.js';
import { ctx, emit, onMany } from '../state.js';
import { ic, button, iconButton, listItem, field, sheet, dialog, snackbar, withLoading, liftOnScroll, page, sectionTitle, rupees } from '../ui.js';
import { register, push, back } from '../router.js';
import { bikeForm, saveVehicle } from '../bikeform.js';
import { heroImage, TYPES, vehicleType } from '../vehicles.js';

const vName = (v) => v.nickname || [v.make, v.model].filter(Boolean).join(' ') || TYPES[vehicleType(v)].label;
const vSub = (v) => [v.nickname ? [v.make, v.model].filter(Boolean).join(' ') : TYPES[vehicleType(v)].label, v.odometer != null ? `${fmtInt(v.odometer)} km` : null, v.reg].filter(Boolean).join(' · ');
const thumb = (v) => h('span', { class: 'veh-thumb', style: `background-image:url("${heroImage(v)}")`, 'aria-hidden': 'true' });

/** Keep ctx.user (Home picture) in sync after any garage change. */
function applyGarage(g) {
  if (g?.user) { ctx.user = g.user; store.set('user', g.user); emit('user', g.user); }
  emit('garage', g);
  return g;
}

/** 11e Add vehicle / 11f Edit vehicle (sheet). */
export function vehicleSheet(v = null, { onSaved } = {}) {
  sheet((close) => {
    const form = bikeForm({ vehicle: v || {}, onSurface: true, extra: true });
    const go = button(v ? 'Save changes' : 'Add vehicle', { size: 'large', wide: true, type: 'submit' });
    return h('form', { class: 'stack gap16', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const val = form.value();
      if (!val.make.trim() && !val.model.trim() && !val.type) return form.setError('Add at least the make or the model.');
      await withLoading(go, async () => {
        try {
          const g = applyGarage(await saveVehicle(api, form, v?.id || null));
          close();
          snackbar(v ? 'Vehicle saved' : `${vName(g.vehicle)} added to your garage`);
          onSaved?.(g);
        } catch (err) { form.setError(err.message); }
      });
    } }, h('h2', { class: 'headline-s' }, v ? 'Edit vehicle' : 'Add a vehicle'), form.el, go);
  });
}

/** Home → switch which vehicle you're riding (shown on Home, rides and fuel logged to it). */
export function switchVehicleSheet() {
  sheet((close) => {
    const list = h('div', { class: 'list' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    api.get('/api/vehicles').then((g) => list.replaceChildren(...g.vehicles.map((v) => listItem({
      lead: thumb(v), title: vName(v), sub: vSub(v), attrs: { 'data-vehicle': v.id },
      trail: v.id === g.activeId ? ic('radio_button_checked', { fill: true }) : ic('radio_button_unchecked'),
      onclick: async () => { try { applyGarage(await api.post(`/api/vehicles/${v.id}/active`)); close(); snackbar(`Riding ${vName(v)}`); } catch (e) { snackbar(e.message); } },
    })))).catch((e) => list.replaceChildren(h('p', { class: 'body-m' }, e.message)));
    return h('div', { class: 'stack gap12' }, h('h2', { class: 'headline-s' }, 'Which one are you riding?'), list,
      button('Manage vehicles', { style: 'text', icon: 'garage', onclick: () => { close(); import('../router.js').then((r) => r.tab('garage')); } }));
  });
}

// ---------------------------------------------------------------- 12 My vehicles (Garage tab)
register('garage', (el) => {
  const bar = h('header', { class: 'topbar' }, h('h1', { class: 'title title-l', style: 'padding-left:12px' }, 'Garage'),
    iconButton('add', { label: 'Add a vehicle', onclick: () => vehicleSheet() }), iconButton('settings', { label: 'Settings', onclick: () => push('settings') }));
  const body = h('div', { class: 'screen-body pad' });
  el.append(bar, body);
  liftOnScroll(bar, body);
  let garage = null;
  const render = () => {
    const vs = garage?.vehicles || (ctx.user?.vehicle ? [ctx.user.vehicle] : []);
    const activeId = garage?.activeId || ctx.user?.vehicle?.id;
    const active = vs.find((v) => v.id === activeId) || vs[0];
    const parked = store.get('parking', null);
    body.replaceChildren(
      active
        ? h('button', { type: 'button', class: 'hero', style: `min-height:240px;max-height:280px;width:100%;border:0;text-align:left;background-image:url("${heroImage(active)}")`, 'aria-label': `Open ${vName(active)}`, onclick: () => push('vehicle', { id: active.id }) },
          h('span', { class: 'tag-glass label-m' }, ic('home', { size: 16 }), 'On Home'),
          h('div', { class: 'info' }, h('div', {}, h('div', { class: 'title-s make' }, [active.make, TYPES[vehicleType(active)].label].filter(Boolean).join(' · ')), h('div', { class: 'headline-l' }, active.nickname || active.model || 'Your bike')),
            h('div', { class: 'stats' }, h('div', {}, h('div', { class: 'v' }, h('span', { class: 'title-l' }, active.odometer != null ? fmtInt(active.odometer) : '–'), h('span', { class: 'title-s l' }, 'km')), h('div', { class: 'label-m l' }, 'Odometer')),
              active.reg ? h('div', {}, h('div', { class: 'v' }, h('span', { class: 'title-l' }, active.reg)), h('div', { class: 'label-m l' }, 'Registration')) : null)))
        : h('div', { class: 'empty' }, ic('two_wheeler'), h('p', { class: 'title-m', style: 'color:var(--on-surface)' }, 'No vehicles yet'), h('p', { class: 'body-m' }, 'Add your bike, scooter or bicycle. The one you pick shows on Home.'), button('Add a vehicle', { icon: 'add', onclick: () => vehicleSheet() })),
      vs.length ? sectionTitle('My vehicles', `${vs.length}`) : null,
      vs.length ? h('div', { class: 'list' }, vs.map((v) => listItem({
        lead: thumb(v), title: vName(v), sub: vSub(v), cls: 'veh-row',
        trail: h('span', { class: 'row gap8' }, v.id === active?.id ? h('span', { class: 'tag' }, 'On Home') : null, ic('chevron_right')),
        onclick: () => push('vehicle', { id: v.id }), attrs: { 'data-vehicle': v.id },
      })), h('button', { type: 'button', class: 'shortcut', style: 'margin:0', onclick: () => vehicleSheet() }, ic('add_circle'), h('span', { class: 'main' }, h('span', { class: 'title-s' }, 'Add a vehicle'), h('span', { class: 'body-s variant' }, 'Bikes, scooters, EVs and bicycles')), ic('chevron_right'))) : null,
      sectionTitle('Ride ready'),
      h('div', { class: 'list' },
        listItem({ icon: 'checklist', title: 'Pre-ride checklist', sub: 'Lights, chain, tyres, documents', trail: ic('chevron_right'), onclick: () => push('setup', { step: 3, checkOnly: true }) }),
        parked ? listItem({ icon: 'local_parking', title: 'Where you parked', sub: `Saved ${new Date(parked.at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`, trail: ic('open_in_new'), onclick: () => window.open(`https://www.openstreetmap.org/?mlat=${parked.lat}&mlon=${parked.lng}#map=18/${parked.lat}/${parked.lng}`, '_blank', 'noopener') }) : null,
        listItem({ icon: 'emergency', title: 'Emergency contacts', sub: ctx.contacts.length ? ctx.contacts.map((c) => c.name).join(', ') : 'Who SOS should call', trail: ic('chevron_right'), onclick: () => push('contacts') }),
        listItem({ icon: 'mic', title: 'Mic test', sub: 'Check your helmet headset', trail: ic('chevron_right'), onclick: () => push('mictest') })),
      h('div', { style: 'height:24px' }));
  };
  const load = () => api.get('/api/vehicles').then((g) => { garage = g; render(); }).catch(() => {});
  render(); load();
  el.onResume = load;
  return onMany({ user: () => { render(); load(); }, garage: (g) => { if (g?.vehicles) garage = g; render(); } });
});

// ---------------------------------------------------------------- 11 Vehicle
register('vehicle', (el, params) => {
  const { body, setTitle } = page(el, '', { back, bodyCls: '' });
  let v = null, activeId = null, fuel = null, service = null;
  const render = () => {
    if (!v) return;
    setTitle(vName(v));
    const onHome = v.id === activeId;
    const due = service?.reminders.filter((r) => r.state !== 'ok') || [];
    body.replaceChildren(
      h('div', { class: 'veh-hero', style: `background-image:url("${heroImage(v)}")` },
        h('span', { class: 'tag-glass label-m' }, ic(TYPES[vehicleType(v)].icon, { size: 16 }), TYPES[vehicleType(v)].label)),
      h('div', { style: 'padding:0 16px' },
        h('div', { class: 'row', style: 'justify-content:space-between;align-items:flex-start;gap:12px;margin-top:16px' },
          h('div', {}, h('div', { class: 'title-s variant' }, [v.make, v.year].filter(Boolean).join(' · ') || 'Vehicle'), h('h2', { class: 'headline-m', style: 'margin:2px 0 0' }, v.model || vName(v)),
            v.reg ? h('span', { class: 'tag', style: 'margin-top:8px;display:inline-flex' }, v.reg) : null),
          iconButton('edit', { label: 'Edit vehicle', style: 'tonal', onclick: () => vehicleSheet(v, { onSaved: (g) => { v = g.vehicle; activeId = g.activeId; render(); } }) })),
        onHome
          ? h('div', { class: 'banner ok', style: 'margin:16px 0 0' }, ic('home'), h('span', { class: 'main' }, h('span', { class: 'title-s' }, 'This is your ride on Home'), h('span', { class: 'body-m' }, 'Rides and fuel are logged to it')))
          : h('div', { style: 'margin-top:16px' }, button('Ride this one (show on Home)', { style: 'tonal', icon: 'home', wide: true, onclick: async () => {
            try { const g = applyGarage(await api.post(`/api/vehicles/${v.id}/active`)); activeId = g.activeId; render(); snackbar(`${vName(v)} is now on Home`); } catch (e) { snackbar(e.message); }
          } })),
        h('div', { class: 'stat-row mt16' },
          h('div', { class: 'stat tile' }, h('div', { class: 'v' }, h('span', { class: 'ride-metric' }, v.odometer != null ? fmtInt(v.odometer) : '–'), h('span', { class: 'u' }, 'km')), h('span', { class: 'l' }, 'Odometer')),
          h('div', { class: 'stat tile' }, h('div', { class: 'v' }, h('span', { class: 'ride-metric' }, fuel?.stats.avgKmpl ?? '–'), h('span', { class: 'u' }, 'km/l')), h('span', { class: 'l' }, 'Mileage')),
          h('div', { class: 'stat tile' }, h('span', { class: 'ride-metric' }, service ? (due.length ? String(due.length) : '0') : '–'), h('span', { class: 'l' }, 'Due soon'))),
        due.length ? h('div', { class: 'stack gap8 mt16' }, due.map((r) => h('div', { class: `banner ${r.state === 'overdue' ? 'bad' : 'warn'}`, style: 'margin:0' }, ic(r.state === 'overdue' ? 'error' : 'schedule'),
          h('span', { class: 'main' }, h('span', { class: 'title-s' }, `${r.label} ${r.state === 'overdue' ? 'overdue' : 'due soon'}`), h('span', { class: 'body-m' }, r.due))))) : null,
        sectionTitle('Logs'),
        h('div', { class: 'list' },
          listItem({ icon: 'local_gas_station', title: 'Fuel log', sub: fuel?.entries.length ? `${fuel.entries.length} fill-ups${fuel.stats.avgKmpl ? ` · ${fuel.stats.avgKmpl} km/l` : ''} · ${rupees(fuel.stats.totalSpent)}` : 'Log fill-ups to track mileage', trail: ic('chevron_right'), onclick: () => push('fuel', { vehicleId: v.id, title: vName(v) }) }),
          listItem({ icon: 'build', title: 'Service & documents', sub: service?.entries.length ? `${service.entries.length} entries · ${rupees(service.stats.spent)}` : 'Oil, chain, tyres, insurance, PUC', trail: ic('chevron_right'), onclick: () => push('service', { id: v.id }) })),
        h('div', { class: 'mt24', style: 'padding-bottom:32px' }, button('Remove from garage', { style: 'danger-outlined', icon: 'delete', wide: true, onclick: async () => {
          if (!(await dialog({ title: `Remove ${vName(v)}?`, body: 'Its fuel log and service history are deleted too. Rides you recorded stay in History.', confirm: 'Remove', danger: true }))) return;
          try { applyGarage(await api.del(`/api/vehicles/${v.id}`)); snackbar('Vehicle removed'); back(); } catch (e) { snackbar(e.message); }
        } }))));
  };
  body.append(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
  const load = async () => {
    try {
      const g = await api.get('/api/vehicles');
      v = g.vehicles.find((x) => x.id === params.id); activeId = g.activeId;
      if (!v) { snackbar('That vehicle was removed.'); back(); return; }
      render();
      [fuel, service] = await Promise.all([api.get(`/api/fuel?vehicle=${v.id}`).catch(() => null), api.get(`/api/vehicles/${v.id}/service`).catch(() => null)]);
      render();
    } catch (e) { body.replaceChildren(h('div', { class: 'empty' }, ic('cloud_off'), h('p', { class: 'body-m' }, e.message), button('Try again', { style: 'outlined', onclick: load }))); }
  };
  load();
  el.onResume = load;
});

// ---------------------------------------------------------------- 11j Service & documents
const SERVICE_ICONS = { service: 'build', oil: 'oil_barrel', chain: 'link', tyres: 'tire_repair', brakes: 'do_not_step', battery: 'battery_charging_full', insurance: 'shield', puc: 'eco', other: 'more_horiz' };
// Typical intervals for Indian bikes; used to pre-fill "next due".
const DEFAULT_NEXT = { service: { km: 3000, months: 4 }, oil: { km: 3000 }, chain: { km: 500 }, tyres: { km: 25000 }, brakes: { km: 10000 }, battery: { months: 30 }, insurance: { months: 12 }, puc: { months: 6 } };

register('service', (el, params) => {
  const fab = h('button', { type: 'button', class: 'fab', style: 'position:absolute;right:16px;bottom:calc(16px + var(--safe-b));z-index:5', onclick: () => addSheet() }, ic('add'), 'Add entry');
  const { body, setTitle } = page(el, 'Service & documents', { back, foot: fab });
  let data = null;
  const draw = (d) => {
    data = d;
    setTitle(`Service · ${vName(d.vehicle)}`);
    body.replaceChildren(
      h('div', { class: 'stat-row', style: 'margin-top:8px' },
        h('div', { class: 'stat tile' }, h('span', { class: 'ride-metric' }, String(d.stats.count)), h('span', { class: 'l' }, 'Entries')),
        h('div', { class: 'stat tile' }, h('span', { class: 'ride-metric' }, d.stats.spent ? rupees(d.stats.spent) : '–'), h('span', { class: 'l' }, 'Spent')),
        h('div', { class: 'stat tile' }, h('div', { class: 'v' }, h('span', { class: 'ride-metric' }, d.vehicle.odometer != null ? fmtInt(d.vehicle.odometer) : '–'), h('span', { class: 'u' }, 'km')), h('span', { class: 'l' }, 'Odometer'))),
      d.reminders.length ? [sectionTitle('Coming up'), h('div', { class: 'list' }, d.reminders.map((r) => listItem({
        icon: SERVICE_ICONS[r.type], title: r.label, sub: r.due, cls: r.state === 'overdue' ? 'alert' : '',
        trail: h('span', { class: `status compact ${r.state === 'overdue' ? 'bad' : r.state === 'soon' ? 'warn' : 'ok'}` }, ic(r.state === 'ok' ? 'check_circle' : 'schedule'), r.state === 'overdue' ? 'Overdue' : r.state === 'soon' ? 'Soon' : 'OK'),
      })))] : null,
      sectionTitle('History'),
      d.entries.length ? h('div', { class: 'list' }, d.entries.map((s) => listItem({
        icon: SERVICE_ICONS[s.type], title: d.types[s.type], sub: [s.date, s.odometer != null ? `${fmtInt(s.odometer)} km` : null, s.note].filter(Boolean).join(' · '),
        trail: h('span', { class: 'row gap8' }, s.cost ? h('span', { class: 'title-s', style: 'color:var(--on-surface)' }, rupees(s.cost)) : null,
          iconButton('delete', { label: `Delete ${d.types[s.type]} on ${s.date}`, small: true, onclick: async () => {
            try { draw(await api.del(`/api/vehicles/${params.id}/service/${s.id}`)); snackbar('Entry deleted'); } catch (e) { snackbar(e.message); }
          } })),
      }))) : h('div', { class: 'empty' }, ic('build'), h('p', { class: 'body-m' }, 'Log services, oil changes, tyres, insurance and PUC. Rylaide reminds you before the next one is due.')),
      h('div', { style: 'height:96px' }));
  };
  const addSheet = () => sheet((close) => {
    let type = 'service';
    const types = data?.types || { service: 'General service' };
    const sel = h('select', { 'aria-label': 'What was done', name: 'type' }, Object.entries(types).map(([k, t]) => h('option', { value: k }, t)));
    const selF = h('label', { class: 'field on-surface' }, sel, h('label', {}, 'What was done'));
    const date = field({ label: 'Date', type: 'date', value: localDate(), onSurface: true });
    const odo = field({ label: 'Odometer (km)', type: 'number', value: data?.vehicle.odometer ?? '', attrs: { inputmode: 'numeric', min: 0, name: 'odometer' }, onSurface: true });
    const cost = field({ label: 'Cost (₹)', type: 'number', attrs: { inputmode: 'decimal', min: 0, name: 'cost' }, onSurface: true });
    const nextKm = field({ label: 'Next due at (km)', type: 'number', attrs: { inputmode: 'numeric', min: 0, name: 'nextKm' }, onSurface: true });
    const nextDate = field({ label: 'Next due / expires on', type: 'date', onSurface: true });
    const note = field({ label: 'Note', attrs: { maxlength: 200, name: 'note' }, onSurface: true, support: 'Optional: garage, parts, policy number' });
    // Suggest the next due point from typical intervals, until the rider types their own.
    let kmTouched = false, dateTouched = false;
    nextKm.input.addEventListener('input', () => (kmTouched = true));
    nextDate.input.addEventListener('input', () => (dateTouched = true));
    const prefill = () => {
      const d = DEFAULT_NEXT[type] || {};
      const o = Number(odo.input.value);
      if (!kmTouched) nextKm.input.value = d.km && o ? Math.round(o + d.km) : '';
      if (!dateTouched) { if (d.months) { const t = new Date(date.input.value || Date.now()); t.setMonth(t.getMonth() + d.months); nextDate.input.value = t.toISOString().slice(0, 10); } else nextDate.input.value = ''; }
      const doc = type === 'insurance' || type === 'puc';
      nextKm.hidden = doc; odo.hidden = doc;
      nextDate.querySelector('label').textContent = doc ? 'Expires on' : 'Next due on (optional)';
    };
    sel.onchange = () => { type = sel.value; kmTouched = dateTouched = false; prefill(); };
    odo.input.addEventListener('input', prefill);
    date.input.addEventListener('change', prefill);
    prefill();
    const go = button('Add entry', { size: 'large', wide: true, type: 'submit' });
    return h('form', { class: 'stack gap16', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      await withLoading(go, async () => {
        try {
          const d = await api.post(`/api/vehicles/${params.id}/service`, { type, date: date.input.value, odometer: odo.hidden ? '' : odo.input.value, cost: cost.input.value, nextKm: nextKm.hidden ? '' : nextKm.input.value, nextDate: nextDate.input.value, note: note.input.value });
          if (d.user) applyGarage({ user: d.user });
          close(); draw(d); snackbar('Saved. We’ll remind you before it’s due.');
        } catch (err) { note.setError(err.message); }
      });
    } }, h('h2', { class: 'headline-s' }, 'Add service or document'), selF, h('div', { class: 'row gap12' }, h('div', { class: 'grow' }, date), h('div', { class: 'grow' }, cost)), odo, nextKm, nextDate, note, go);
  });
  body.append(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
  api.get(`/api/vehicles/${params.id}/service`).then(draw).catch((e) => body.replaceChildren(h('div', { class: 'empty' }, ic('cloud_off'), h('p', { class: 'body-m' }, e.message))));
});

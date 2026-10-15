import { $, $$, h, toast, store, fmtKm, fmtDur, fmtEta, localDate } from './util.js';
import { api } from './api.js';

let ctx, deps;

export function initTools(c, d) {
  ctx = c; deps = d;
  $$('#tools-tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tool)));
  wireRoute();
  wireChecklist();
  wireFuel();
}
function show(name) {
  $$('#tools-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tool === name)));
  $$('#sheet-tools .tool').forEach((t) => (t.hidden = t.dataset.tool !== name));
  store.set('tool', name);
  if (name === 'check') renderChecklist();
  if (name === 'fuel') renderFuel();
  if (name === 'rides') renderRides();
}
initTools.show = show;
initTools.onOpen = () => show(store.get('tool', 'route'));

// ---------------------------------------------------------------- route planning
function wireRoute() {
  $('#route-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#route-q').value.trim();
    const list = $('#route-results');
    $('#route-preview').replaceChildren();
    if (q.length < 2) { list.replaceChildren(h('li', { class: 'empty' }, 'Type at least two letters of a place.')); return; }
    list.replaceChildren(h('li', { class: 'empty' }, 'Searching…'));
    try {
      const near = ctx.pos ? `&near=${ctx.pos.lng},${ctx.pos.lat}` : '';
      const { results } = await api.get(`/api/search?q=${encodeURIComponent(q)}${near}`);
      if (!results.length) { list.replaceChildren(h('li', { class: 'empty' }, `No places found for “${q}”. Try a town or landmark name.`)); return; }
      list.replaceChildren(...results.map((p) => h('li', {}, h('button', { type: 'button', onclick: () => preview(p) }, p.name))));
    } catch (err) {
      list.replaceChildren(h('li', { class: 'empty danger' }, err.message));
    }
  });
}

async function preview(place) {
  $('#route-results').replaceChildren();
  const box = $('#route-preview');
  box.replaceChildren(h('p', { class: 'muted' }, 'Finding the best road route…'));
  let route;
  try {
    route = await deps.fetchRoute(place);
  } catch (err) {
    box.replaceChildren(h('p', { class: 'danger' }, err.message), h('button', { class: 'btn', type: 'button', onclick: () => preview(place) }, 'Try again'));
    return;
  }
  deps.map.setRoute(route.geometry);
  deps.map.setDestination(place.lng, place.lat);
  const short = place.name.split(',').slice(0, 2).join(',');
  const meet = h('input', { type: 'time', 'aria-label': 'Meet time' });
  const note = h('input', { maxlength: 280, placeholder: 'Note for the group (optional)', 'aria-label': 'Note' });
  box.replaceChildren(h('div', { class: 'stack' },
    h('h2', {}, short),
    h('div', { class: 'route-sum' }, h('span', {}, h('b', {}, fmtKm(route.distance)), ' km'), h('span', {}, h('b', {}, fmtEta(route.duration)))),
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => deps.startNavigation(place, route) }, 'Start navigation'),
      h('button', { class: 'btn', type: 'button', onclick: () => { deps.map.setRoute(null); if (!ctx.group?.plan) deps.map.setDestination(null); box.replaceChildren(); } }, 'Clear')),
    h('details', {}, h('summary', { class: 'link' }, 'Set as group plan'),
      h('div', { class: 'stack', style: 'margin-top:10px' },
        h('label', { class: 'field' }, h('span', {}, 'Meet at'), meet), note,
        h('button', { class: 'btn', type: 'button', onclick: async () => { if (await deps.setPlanFromPlace(place, { meetAt: meet.value, note: note.value })) note.value = ''; } }, 'Share plan with group'))),
    h('details', {}, h('summary', { class: 'link' }, `Directions (${route.steps.length} steps)`),
      h('ol', { class: 'steps' }, route.steps.map((s) => h('li', {}, `${s.instruction}${s.distance ? ` · ${fmtKm(s.distance)} km` : ''}`))))));
}

// ---------------------------------------------------------------- pre-ride checklist
const BASE = ['Tyre pressure checked', 'Brakes feel firm, front and rear', 'Chain tension and lube', 'Fuel enough for the first leg', 'Helmet strap fastened', 'Phone charged and mounted', 'Headset paired and mic tested', 'Licence, RC and insurance papers'];
const BY_BIKE = {
  scooter: ['CVT / belt noise check', 'Under-seat storage locked'],
  sport: ['Riding jacket with armour', 'Check coolant level'],
  cruiser: ['Saddlebags secured', 'Check engine oil level'],
  adventure: ['Luggage straps tight', 'Tool kit and puncture kit', 'Check spoke and rim condition'],
  motorcycle: ['Check engine oil level'],
};
const BY_TRIP = {
  short: [],
  day: ['Water and snacks', 'Power bank and cable', 'First-aid kit', 'Share the ride plan with someone at home'],
  multi: ['Water and snacks', 'Power bank and cable', 'First-aid kit', 'Puncture kit and pump', 'Spare clutch and brake levers', 'Rain gear packed', 'Offline map area downloaded', 'Share the ride plan with someone at home'],
};

function buildChecklist() {
  const trip = $('#ck-trip').value;
  const bike = ctx.user?.bike || 'motorcycle';
  const hr = new Date().getHours();
  const night = hr < 6 || hr >= 18;
  const items = [...BASE, ...(BY_BIKE[bike] || BY_BIKE.motorcycle), ...BY_TRIP[trip]];
  if (night) items.push('Headlight, tail light and indicators working', 'Reflective vest or strips', 'Clear visor (not tinted)');
  if (ctx.weather?.rain > 0.2) items.push('Rain gear on or packed');
  if (ctx.weather?.temp >= 33) items.push('Extra water: it’s hot out');
  const why = [`${bike[0].toUpperCase()}${bike.slice(1)}`, trip === 'short' ? 'short ride' : trip === 'day' ? 'day ride' : 'multi-day tour', night ? 'riding after dark' : 'daytime'];
  if (ctx.weather?.rain > 0.2) why.push('rain expected');
  return { items: [...new Set(items)], why, key: `ck.${localDate()}.${trip}` };
}

export function renderChecklist() {
  const { items, why, key } = buildChecklist();
  const ticked = new Set(store.get(key, []));
  $('#ck-context').textContent = `Built for: ${why.join(', ')}.`;
  const update = () => {
    const done = items.filter((i) => ticked.has(i)).length;
    $('#ck-progress').textContent = done === items.length ? 'All set. Ride safe!' : `${done} of ${items.length} done`;
  };
  $('#ck-list').replaceChildren(...items.map((it) => h('li', {}, h('label', {},
    h('input', { type: 'checkbox', checked: ticked.has(it), onchange: (e) => { e.target.checked ? ticked.add(it) : ticked.delete(it); store.set(key, [...ticked]); update(); } }),
    h('span', {}, it)))));
  update();
  $('#ck-reset').onclick = () => { store.del(key); renderChecklist(); };
}
function wireChecklist() {
  $('#ck-trip').value = store.get('ckTrip', 'short');
  $('#ck-trip').addEventListener('change', (e) => { store.set('ckTrip', e.target.value); renderChecklist(); });
}

// ---------------------------------------------------------------- fuel log
function wireFuel() {
  const form = $('#fuel-form');
  form.date.value = localDate();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#fuel-error').textContent = '';
    const f = new FormData(form);
    try {
      const data = await api.post('/api/fuel', {
        odometer: f.get('odometer'), litres: f.get('litres'), pricePerLitre: f.get('pricePerLitre'), date: f.get('date'), full: form.full.checked,
      });
      drawFuel(data);
      form.odometer.value = ''; form.litres.value = '';
      toast(data.entries[0]?.kmpl ? `Fill-up added: ${data.entries[0].kmpl} km/l since the last full tank` : 'Fill-up added');
    } catch (err) { $('#fuel-error').textContent = err.message; }
  });
}
export async function renderFuel() {
  try { drawFuel(await api.get('/api/fuel')); } catch (e) { $('#fuel-list').replaceChildren(h('li', { class: 'empty danger' }, e.message)); }
}
function drawFuel({ entries, stats }) {
  const stat = (v, label) => h('div', { class: 'stat' }, h('b', {}, v ?? '–'), h('span', {}, label));
  $('#fuel-stats').replaceChildren(
    stat(stats.avgKmpl, 'avg km/l'),
    stat(stats.totalSpent ? `₹${Math.round(stats.totalSpent).toLocaleString('en-IN')}` : '–', 'spent'),
    stat(stats.totalLitres || '–', 'litres'));
  const last = entries.find((e) => e.pricePerLitre);
  if (last) $('#fuel-form').pricePerLitre.placeholder = String(last.pricePerLitre);
  if (!entries.length) {
    $('#fuel-list').replaceChildren(h('li', { class: 'empty' }, 'Log each fill-up. Mileage appears from your second full tank.'));
    $('#fuel-chart').replaceChildren();
    return;
  }
  $('#fuel-list').replaceChildren(...entries.map((e) => h('li', {},
    h('div', { class: 'grow' }, h('b', {}, `${e.odometer.toLocaleString('en-IN')} km`), h('div', { class: 'small muted' }, `${e.date} · ${e.litres} L at ₹${e.pricePerLitre} · ₹${e.cost.toLocaleString('en-IN')}${e.full ? '' : ' · partial'}`)),
    e.kmpl ? h('span', { class: 'num' }, `${e.kmpl}`, h('small', { class: 'muted' }, ' km/l')) : null,
    h('button', { class: 'link danger', type: 'button', 'aria-label': `Delete fill-up at ${e.odometer} km`, onclick: async () => { try { drawFuel(await api.del(`/api/fuel/${e.id}`)); } catch (err) { toast(err.message, { error: true }); } } }, 'Delete'))));
  drawChart(entries.filter((e) => e.kmpl).reverse());
}

/** Single-series trend: km/l per full tank. 2px line, 8px markers with hover values, faint baseline. */
function drawChart(pts) {
  const host = $('#fuel-chart');
  if (pts.length < 2) { host.replaceChildren(pts.length ? h('p', { class: 'small muted' }, 'The mileage trend appears after two more full tanks.') : ''); return; }
  const W = 320, H = 120, P = { l: 30, r: 10, t: 14, b: 20 };
  const ys = pts.map((p) => p.kmpl);
  const lo = Math.floor(Math.min(...ys) * 0.9), hi = Math.ceil(Math.max(...ys) * 1.05);
  const x = (i) => P.l + (i * (W - P.l - P.r)) / (pts.length - 1);
  const y = (v) => P.t + (1 - (v - lo) / (hi - lo || 1)) * (H - P.t - P.b);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); kids.forEach((k) => n.append(k)); return n; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Mileage trend, ${ys[0]} to ${ys[ys.length - 1]} km/l` });
  for (const v of [lo, hi]) {
    svg.append(el('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), stroke: 'currentColor', 'stroke-opacity': .12 }));
    svg.append(el('text', { x: P.l - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 10, fill: 'currentColor', 'fill-opacity': .6 }, String(v)));
  }
  svg.append(el('text', { x: P.l, y: H - 4, 'font-size': 10, fill: 'currentColor', 'fill-opacity': .6 }, 'km/l per full tank'));
  svg.append(el('polyline', { points: pts.map((p, i) => `${x(i)},${y(p.kmpl)}`).join(' '), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  pts.forEach((p, i) => {
    const g = el('g', { tabindex: 0 });
    g.append(el('circle', { cx: x(i), cy: y(p.kmpl), r: 14, fill: 'transparent' }));
    g.append(el('circle', { cx: x(i), cy: y(p.kmpl), r: 4, fill: 'var(--accent)', stroke: 'var(--surface)', 'stroke-width': 2 }));
    g.append(el('title', {}, `${p.date}: ${p.kmpl} km/l at ${p.odometer} km`));
    svg.append(g);
  });
  const last = pts[pts.length - 1];
  svg.append(el('text', { x: x(pts.length - 1), y: y(last.kmpl) - 9, 'text-anchor': 'end', 'font-size': 11, 'font-weight': 700, fill: 'currentColor' }, `${last.kmpl}`));
  host.replaceChildren(svg);
}

// ---------------------------------------------------------------- ride history
export async function renderRides() {
  const list = $('#rides-list');
  if (!list) return;
  try {
    const { rides } = await api.get('/api/rides');
    if (!rides.length) { list.replaceChildren(h('li', { class: 'empty' }, 'No rides yet. Tap “Start ride” on the map to record one.')); return; }
    list.replaceChildren(...rides.map((r) => h('li', {},
      h('div', { class: 'grow' }, h('b', {}, r.name), h('div', { class: 'small muted' },
        `${fmtKm(r.distance)} km · ${fmtDur(r.duration)}${r.maxSpeed ? ` · top ${Math.round(r.maxSpeed * 3.6)} km/h` : ''}`)),
      h('button', { class: 'link', type: 'button', onclick: async () => {
        try { const { ride } = await api.get(`/api/rides/${r.id}`); deps.map.setFollow(false); deps.map.showTrack(ride.points); document.querySelector('.tab[data-sheet=""]').click(); } catch (e) { toast(e.message, { error: true }); }
      } }, 'View'),
      h('button', { class: 'link danger', type: 'button', onclick: async () => {
        if (!confirm(`Delete “${r.name}”?`)) return;
        try { await api.del(`/api/rides/${r.id}`); renderRides(); deps.map.setTrack(null); } catch (e) { toast(e.message, { error: true }); }
      } }, 'Delete'))));
  } catch (e) { list.replaceChildren(h('li', { class: 'empty danger' }, e.message)); }
}

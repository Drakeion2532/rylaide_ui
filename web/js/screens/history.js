// 36 History → 34 Ride summary
import { h, fmtKm, durShort, fmtDay, haversine, store } from '../util.js';
import { api } from '../api.js';
import { ctx } from '../state.js';
import { ic, button, iconButton, listItem, dialog, snackbar, liftOnScroll } from '../ui.js';
import { register, push, back, tab } from '../router.js';
import { routeThumb } from '../map.js';

const dayShort = (ts) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

register('history', (el) => {
  const bar = h('header', { class: 'topbar' }, h('h1', { class: 'title title-l', style: 'padding-left:12px' }, 'History'));
  const body = h('div', { class: 'screen-body pad' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
  el.append(bar, body);
  liftOnScroll(bar, body);
  api.get('/api/rides').then(({ rides }) => {
    if (!rides.length) {
      body.replaceChildren(h('div', { class: 'empty' }, ic('route'), h('p', { class: 'title-m', style: 'color:var(--on-surface)' }, 'No rides yet'),
        h('p', { class: 'body-m' }, 'Every ride you record shows here with its route, speed and time.'), button('Start a ride', { icon: 'play_arrow', onclick: () => push('setup') })));
      return;
    }
    const month = new Date().getMonth();
    const thisMonth = rides.filter((r) => new Date(r.startedAt).getMonth() === month);
    const km = thisMonth.reduce((s, r) => s + r.distance, 0);
    const time = thisMonth.reduce((s, r) => s + r.duration, 0);
    body.replaceChildren(
      h('div', { style: 'padding:8px 0 20px' },
        h('div', { class: 'stat' }, h('div', { class: 'v' }, h('span', { class: 'ride-hero' }, fmtKm(km)), h('span', { class: 'title-l variant' }, 'km')), h('span', { class: 'label-m variant' }, 'This month')),
        h('div', { class: 'stat-row mt16' },
          h('div', { class: 'stat tile' }, h('span', { class: 'ride-metric' }, String(thisMonth.length)), h('span', { class: 'l' }, thisMonth.length === 1 ? 'Ride' : 'Rides')),
          h('div', { class: 'stat tile' }, h('span', { class: 'ride-metric' }, durShort(time)), h('span', { class: 'l' }, 'Riding time')),
          h('div', { class: 'stat tile' }, h('span', { class: 'ride-metric' }, String(rides.filter((r) => r.groupName).length)), h('span', { class: 'l' }, 'Group rides')))),
      h('div', { class: 'list' }, rides.map((r) => listItem({
        icon: r.groupName ? 'groups' : 'person', title: r.destination || r.name, sub: `${fmtKm(r.distance)} km · ${durShort(r.duration)}`,
        trail: h('span', { class: 'row gap8' }, dayShort(r.startedAt), ic('chevron_right')), onclick: () => push('summary', { id: r.id }),
      }))), h('div', { style: 'height:24px' }));
  }).catch((e) => body.replaceChildren(h('div', { class: 'empty' }, ic('cloud_off'), h('p', { class: 'body-m' }, e.message), button('Try again', { style: 'outlined', onclick: () => tab('history', { force: true }) }))));
});

/** Speed over the ride (km/h), smoothed, from GPS points [lat,lng,ts]. */
function speedSeries(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const dt = (points[i][2] - points[i - 1][2]) / 1000;
    if (dt <= 0) continue;
    const v = (haversine(points[i - 1], points[i]) / dt) * 3.6;
    if (v <= 250) out.push({ t: points[i][2], v }); // drop GPS jumps no motorcycle can make
  }
  return out.map((p, i) => ({ t: p.t, v: out.slice(Math.max(0, i - 2), i + 3).reduce((s, x) => s + x.v, 0) / out.slice(Math.max(0, i - 2), i + 3).length }));
}

function speedChart(points, ride) {
  const series = speedSeries(points || []);
  if (series.length < 3) return null;
  const W = 300, H = 64, max = Math.max(...series.map((s) => s.v), 1);
  const t0 = series[0].t, t1 = series[series.length - 1].t;
  const X = (t) => ((t - t0) / (t1 - t0 || 1)) * W, Y = (v) => H - (v / max) * (H - 8);
  const line = series.map((s) => `${X(s.t).toFixed(1)},${Y(s.v).toFixed(1)}`).join(' ');
  const top = series.reduce((a, b) => (b.v > a.v ? b : a));
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Speed over the ride, top ${Math.round(top.v)} km/h`);
  const add = (tag, a) => { const e = document.createElementNS(NS, tag); Object.entries(a).forEach(([k, v]) => e.setAttribute(k, v)); svg.append(e); return e; };
  add('line', { x1: 0, x2: W, y1: H / 2, y2: H / 2, stroke: 'var(--outline-variant)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' });
  add('polygon', { points: `0,${H} ${line} ${W},${H}`, fill: 'var(--primary)', 'fill-opacity': .14 });
  add('polyline', { points: line, fill: 'none', stroke: 'var(--primary)', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' });
  const mx = X(top.t), my = Y(top.v);
  const tm = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return h('div', { class: 'speed-chart' },
    h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:12px' }, h('span', { class: 'title-s' }, 'Speed'), h('span', { class: 'body-s variant' }, `top ${Math.round(ride.maxSpeed ? ride.maxSpeed * 3.6 : top.v)} km/h`)),
    h('div', { style: 'position:relative' }, svg,
      h('span', { style: `position:absolute;left:${(mx / W) * 100}%;top:${(my / H) * 72}px;width:9px;height:9px;margin:-4.5px;border-radius:50%;background:var(--primary);border:2px solid var(--surface-container)` }),
      h('span', { class: 'label-m', style: `position:absolute;left:${(mx / W) * 100}%;top:${(my / H) * 72 - 22}px;transform:translateX(-50%)` }, String(Math.round(top.v)))),
    h('div', { class: 'row body-s variant', style: 'justify-content:space-between;margin-top:8px' }, h('span', {}, `${ride.origin || 'Start'} ${tm(t0)}`), h('span', {}, `${tm(t1)} ${ride.destination || 'Finish'}`)));
}

register('summary', (el, params) => {
  el.style.background = 'var(--background)';
  const body = h('div', { class: 'screen-body' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
  el.append(body);
  const close = () => (params.justEnded ? tab('home') : back());
  if (params.justEnded) el.dataset.blockBack = '0';

  const render = (r) => {
    const rawAvg = r.avgSpeed ? r.avgSpeed * 3.6 : r.duration ? (r.distance / r.duration) * 3.6 : 0;
    const avg = rawAvg > 250 ? 0 : rawAvg;
    const meta = [fmtDay(new Date(r.startedAt || Date.now())), r.vehicle || ctx.user?.vehicle?.model, r.groupName ? 'Group ride' : 'Solo ride'].filter(Boolean).join(' · ');
    const parked = store.get('parking', null);
    const parkingCard = h('button', { type: 'button', class: 'shortcut', style: 'margin:0', onclick: () => {
      if (!ctx.pos) return snackbar('Waiting for GPS to save your parking spot.');
      store.set('parking', { lat: ctx.pos.lat, lng: ctx.pos.lng, at: Date.now() });
      parkingCard.replaceChildren(ic('check_circle', { fill: true }), h('span', { class: 'main' }, h('span', { class: 'title-s' }, 'Parking spot saved'), h('span', { class: 'body-s variant' }, 'Find it later from Garage')), ic('chevron_right'));
      snackbar('Parking spot saved');
    } }, h('span', { class: 'title-l', style: 'color:var(--primary);font-weight:700;width:24px;text-align:center' }, 'P'),
      h('span', { class: 'main' }, h('span', { class: 'title-s' }, parked && Date.now() - parked.at < 6 * 3600e3 ? 'Update where you parked' : 'Save where you parked'), h('span', { class: 'body-s variant' }, 'Find your bike later')), ic('chevron_right'));

    body.replaceChildren(
      h('div', { class: 'summary-hero', style: 'background-image:url(/img/ghat-road.jpg)' },
        h('div', { class: 'top' }, iconButton('close', { label: 'Close', onclick: close }), iconButton('share', { label: 'Share ride', onclick: async () => {
          const text = `${r.destination || r.name}: ${fmtKm(r.distance)} km in ${durShort(r.duration)} on Rylaide`;
          if (navigator.share) { try { await navigator.share({ title: 'My ride', text }); } catch { /* cancelled */ } } else { try { await navigator.clipboard.writeText(text); snackbar('Ride copied'); } catch { /* ignore */ } }
        } })),
        h('div', { class: 't' }, h('span', { class: 'label-l' }, meta), h('h1', { class: 'headline-l' }, r.destination || r.name), r.origin ? h('span', { class: 'body-l', style: 'color:var(--on-image-variant)' }, `from ${r.origin}`) : null)),
      h('div', { class: 'summary-sheet' },
        r.offline ? h('div', { class: 'banner dark' }, ic('cloud_upload'), h('span', { class: 'main' }, h('span', { class: 'title-s' }, 'Saved on this phone'), h('span', { class: 'body-m' }, 'Syncs when you’re online'))) : null,
        h('div', { class: 'summary-top' },
          h('div', { class: 'stat' }, h('div', { class: 'v' }, h('span', { class: 'ride-hero tabular' }, fmtKm(r.distance)), h('span', { class: 'title-l variant' }, 'km')), h('span', { class: 'label-m variant' }, 'Distance')),
          h('div', { class: 'route-thumb' }, routeThumb(r.points, { w: 100, hgt: 80 }))),
        parkingCard,
        h('div', { class: 'stat-row' },
          h('div', { class: 'stat tile' }, h('span', { class: 'ride-metric' }, durShort(r.duration).replace(/^(\d+h \d+)m$/, '$1')), h('span', { class: 'l' }, 'Duration')),
          h('div', { class: 'stat tile' }, h('div', { class: 'v' }, h('span', { class: 'ride-metric' }, String(Math.round(avg))), h('span', { class: 'u' }, 'km/h')), h('span', { class: 'l' }, 'Average')),
          h('div', { class: 'stat tile' }, h('div', { class: 'v' }, h('span', { class: 'ride-metric' }, String(Math.round((r.maxSpeed || 0) * 3.6))), h('span', { class: 'u' }, 'km/h')), h('span', { class: 'l' }, 'Top'))),
        speedChart(r.points, r),
        h('div', { class: 'stack gap8', style: 'padding:8px 0 calc(24px + var(--safe-b))' },
          button('Done', { size: 'large', wide: true, onclick: close }),
          r.id ? button(params.justEnded ? 'View in history' : 'Delete ride', {
            style: params.justEnded ? 'text' : 'danger-outlined', wide: true, size: 'large',
            onclick: async () => {
              if (params.justEnded) { tab('history'); return; }
              if (!(await dialog({ title: 'Delete this ride?', body: 'Its route and stats will be removed. This can’t be undone.', confirm: 'Delete', danger: true }))) return;
              try { await api.del(`/api/rides/${r.id}`); snackbar('Ride deleted'); back(); } catch (e) { snackbar(e.message); }
            },
          }) : null)));
  };
  if (params.ride) render(params.ride);
  else api.get(`/api/rides/${params.id}`).then(({ ride }) => render(ride)).catch((e) => body.replaceChildren(h('div', { class: 'empty' }, ic('error'), h('p', {}, e.message), button('Back', { style: 'outlined', onclick: back }))));
});

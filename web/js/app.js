import { h, store, fmtDur, fmtDist, haversine } from './util.js';
import { api } from './api.js';
import { ctx, rt, on, emit } from './state.js';
import { applyTheme } from './theme.js';
import { ic, snackbar, banner } from './ui.js';
import * as router from './router.js';
import * as engine from './engine.js';
import './screens/onboarding.js';
import './screens/home.js';
import './screens/groups.js';
import './screens/history.js';
import './screens/garage.js';
import './screens/setup.js';
import './screens/ride.js';

const NAV = [
  { tab: 'home', label: 'Home', icon: 'home' },
  { tab: 'groups', label: 'Groups', icon: 'groups' },
  { tab: 'history', label: 'History', icon: 'history' },
  { tab: 'garage', label: 'Garage', icon: 'two_wheeler' },
];

// ---------------------------------------------------------------- bottom navigation + ride-in-progress bar
function renderNav(active, visible) {
  const nav = document.getElementById('navbar');
  nav.hidden = !visible;
  if (!nav.childElementCount) {
    nav.append(...NAV.map((n) => h('button', { type: 'button', class: 'nav-item', 'data-tab': n.tab, onclick: () => router.tab(n.tab) },
      h('span', { class: 'pill' }, ic(n.icon)), h('span', {}, n.label))));
  }
  nav.querySelectorAll('.nav-item').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === active ? 'page' : 'false'));
  renderRideBar(visible);
}
router.onTabsChanged(renderNav);

function renderRideBar(navVisible = !document.getElementById('navbar').hidden) {
  const slot = document.getElementById('ridebar-slot');
  if (!ctx.ride || !navVisible) { slot.replaceChildren(); return; }
  const r = ctx.ride;
  slot.replaceChildren(h('div', { class: 'ride-bar', role: 'status' },
    ic('two_wheeler'),
    h('span', { class: 'main' }, h('span', { class: 'title-s' }, 'Ride in progress'),
      h('span', { class: 'body-s', 'data-ridebar': '' }, `${fmtDur((Date.now() - r.startedAt) / 1000)} · ${(r.dist / 1000).toFixed(1)} km · recording`)),
    h('button', { type: 'button', class: 'btn filled', onclick: () => router.push('ride') }, 'Resume')));
}
setInterval(() => { const el = document.querySelector('[data-ridebar]'); if (el && ctx.ride) el.textContent = `${fmtDur((Date.now() - ctx.ride.startedAt) / 1000)} · ${(ctx.ride.dist / 1000).toFixed(1)} km · recording`; }, 1000);
on('ride', () => renderRideBar());

// ---------------------------------------------------------------- app-wide feedback
on('snack', (s) => (typeof s === 'string' ? snackbar(s) : snackbar(s.text, s)));

let bannerEl = null, bannerT = null;
/** Ride status banners show on top of ride screens (Figma: Ride status banner). */
on('banner', (b) => {
  const top = router.current()?.el;
  const host = top?.querySelector('[data-banner-host]');
  if (!host) { if (!b.sticky) return; snackbar(b.title); return; }
  bannerEl?.remove();
  clearTimeout(bannerT);
  bannerEl = banner(b);
  host.replaceChildren(bannerEl);
  if (!b.sticky) bannerT = setTimeout(() => { bannerEl?.remove(); bannerEl = null; }, b.ms || 4000);
});
on('conn', (c) => { if (c === 'internet' && bannerEl?.textContent.includes('Connection lost')) { bannerEl.remove(); bannerEl = null; } });

// Incoming SOS from another rider: full-width red alert with actions; never auto-dismissed.
on('sos', (a) => {
  if (a.userId === ctx.user?.id) return;
  document.querySelector(`.sos-alert[data-user="${a.userId}"]`)?.remove();
  const dist = ctx.pos && Number.isFinite(a.lat) ? ` · ${fmtDist(haversine([ctx.pos.lat, ctx.pos.lng], [a.lat, a.lng]))} from you` : '';
  const el = h('div', { class: 'sos-alert', role: 'alert', 'data-user': a.userId },
    h('div', { class: 'row', style: 'align-items:center;gap:12px' }, ic('sos', { size: 28 }), h('span', { class: 'title-l', style: 'flex:1' }, `SOS from ${a.name}`)),
    h('span', { class: 'body-m' }, `Sent ${new Date(a.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${dist}. They may need help.`),
    h('div', { class: 'row' },
      Number.isFinite(a.lat) ? h('button', { type: 'button', class: 'btn', onclick: () => { el.remove(); router.push('ridemap', { focus: a }); } }, ic('location_on', { size: 18 }), 'Show on map') : null,
      Number.isFinite(a.lat) ? h('button', { type: 'button', class: 'btn', onclick: () => { el.remove(); router.push('setup', { quickDest: { name: `${a.name} (SOS)`, lat: a.lat, lng: a.lng }, step: 5 }); } }, ic('navigation', { size: 18 }), 'Navigate') : null,
      h('button', { type: 'button', class: 'btn ghost', onclick: () => el.remove() }, 'Dismiss')));
  document.getElementById('app').append(el);
});
on('sos-cancel', (uid) => {
  const el = document.querySelector(`.sos-alert[data-user="${uid}"]`);
  if (el) { el.remove(); const m = ctx.group?.members.find((x) => x.id === uid); snackbar(`${m?.name || 'Your rider'} is safe. SOS cancelled.`); }
});

window.addEventListener('rylaide:signedout', () => {
  if (!api.token) return;
  api.setToken(null);
  store.del('user');
  snackbar('Your session ended. Set up Rylaide again to keep riding.');
  setTimeout(() => location.reload(), 1500);
});

// ---------------------------------------------------------------- boot
async function boot() {
  applyTheme();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const splashMin = new Promise((r) => setTimeout(r, reduce ? 0 : 1300));
  const join = new URLSearchParams(location.search).get('join');
  if (join) store.set('pendingJoin', join.toUpperCase());
  if (join || location.search) history.replaceState(null, '', '/');

  let signedIn = false;
  if (api.token) {
    try { ctx.user = (await api.get('/api/me')).user; store.set('user', ctx.user); signedIn = true; } catch (e) { if (e.status === 0 && ctx.user) signedIn = true; }
  }
  await splashMin;
  document.getElementById('splash').classList.add('done');
  setTimeout(() => document.getElementById('splash').remove(), 400);
  if (signedIn) startApp(); else router.tab('welcome', { force: true });
  if ('serviceWorker' in navigator && location.hostname !== '127.0.0.1') navigator.serviceWorker.register('/sw.js').catch(() => {});
}

let started = false;
export async function startApp({ fresh } = {}) {
  if (!started) {
    started = true;
    engine.wireRealtime();
    rt.connect();
    engine.startLocation();
    api.get('/api/contacts').then((r) => (ctx.contacts = r.contacts)).catch(() => {});
    engine.flushUnsentRides();
  }
  router.tab('home', { force: true });
  try { await engine.loadGroups(); } catch (e) { snackbar(e.message); }
  const pending = store.get('pendingJoin');
  if (pending) {
    store.del('pendingJoin');
    try { const g = await engine.joinGroup(pending); snackbar(`You joined ${g.name}`); } catch (e) { snackbar(e.message); }
  }
  if (fresh) emit('snack', 'You’re all set. Tap Start ride when you’re ready.');
  if (store.get('activeRide')) { store.del('activeRide'); snackbar('Your last ride was interrupted and wasn’t saved.'); }
}
window.addEventListener('rylaide:start', (e) => startApp(e.detail || {}));

// Exposed for automated tests and debugging.
window.__rylaide = { ctx, rt, engine, router };

boot();

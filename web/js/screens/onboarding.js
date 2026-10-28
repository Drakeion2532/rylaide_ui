// Auth graph (Figma navigation map → "Account · first run"):
//   01 Splash → 02–04 Onboarding → 04b Before you start → 05 Sign in or 06 Create account → 07 Setup → 07a Bikes · 07b Permissions → 08 Home
//   Up: 05d → 05 · 05e → 05d · 06 → 05 · 07a → 07. After sign-in the auth graph is popped: Back never returns to sign-in.
import { h, store } from '../util.js';
import { api } from '../api.js';
import { ctx } from '../state.js';
import { ic, button, field, withLoading, iconButton, snackbar, sheet, checkbox, page, ring, dialog, listItem } from '../ui.js';
import { heroImage, TYPES, vehicleType } from '../vehicles.js';
import { TERMS_SUMMARY, TERMS, PRIVACY, supportEmail } from '../legal.js';
import { bikeForm } from '../bikeform.js';
import { register, push, back, tab } from '../router.js';
import { getMic } from '../voice.js';

const PAGES = [
  { img: '/img/group-ride.jpg', title: 'Ride together', body: 'See everyone in your group on one map, live, with how far behind they are.' },
  { img: '/img/bike-classic.jpg', title: 'Talk without signal', body: 'Hold one big button to talk to your group through your helmet headset.' },
  { img: '/img/ghat-road.jpg', title: 'Get home safe', body: 'Turn-by-turn that speaks to you, a pre-ride check, and SOS that reaches your group fast.' },
];

register('welcome', (el) => {
  let i = 0;
  const art = h('div', { class: 'onb-art' });
  const text = h('div', { class: 'onb-text' });
  const dots = h('div', { class: 'page-dots', 'aria-hidden': 'true' }, PAGES.map(() => h('i')));
  const next = button('Next', { size: 'large', wide: true, onclick: () => (i < PAGES.length - 1 ? show(i + 1) : push('terms')) });
  const skip = button('Skip', { style: 'text', onclick: () => push('terms') });
  const show = (n) => {
    i = n;
    art.style.backgroundImage = `url(${PAGES[n].img})`;
    text.replaceChildren(h('h1', { class: 'headline-l' }, PAGES[n].title), h('p', { class: 'body-l variant' }, PAGES[n].body));
    text.style.animation = 'none'; void text.offsetWidth; text.style.animation = '';
    dots.querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === n));
    next.lastChild.textContent = n === PAGES.length - 1 ? 'Get started' : 'Next';
    skip.hidden = n === PAGES.length - 1;
  };
  // swipe between pages
  let x0 = null;
  el.addEventListener('pointerdown', (e) => (x0 = e.clientX));
  el.addEventListener('pointerup', (e) => { if (x0 === null) return; const dx = e.clientX - x0; if (dx < -50 && i < PAGES.length - 1) show(i + 1); if (dx > 50 && i > 0) show(i - 1); x0 = null; });
  el.append(h('div', { class: 'screen-body' }, art, text, dots), h('div', { class: 'screen-foot stack gap8' }, next, skip));
  show(0);
});

// ---------------------------------------------------------------- 06 Create account
const COLORS = ['#F98924', '#2FC9C3', '#E5484D', '#8B7CF6', '#F5C542', '#4CC38A', '#EC6AA8', '#5AA9FF'];
register('profile', (el) => {
  const name = field({ label: 'Your name', attrs: { maxlength: 40, autocomplete: 'given-name', enterkeyhint: 'done', name: 'name' }, support: 'What your group calls you' });
  let color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const sw = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Your colour on the map' });
  const drawSw = () => sw.replaceChildren(...COLORS.map((c) => h('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-checked': String(c === color), 'aria-label': `Colour ${c}`, style: `background:${c};color:#1a1c1e`, onclick: () => { color = c; drawSw(); } }, ic('check'))));
  drawSw();
  const go = button('Create account', { size: 'large', wide: true, type: 'submit' });
  const form = h('form', { class: 'stack gap16', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    name.setError('');
    if (!name.input.value.trim()) { name.setError('Enter your name so your group knows who you are.'); name.input.focus(); return; }
    await withLoading(go, async () => {
      try {
        const r = await api.post('/api/users', { name: name.input.value, agreed: !!store.get('termsAt') });
        api.setToken(r.token);
        ctx.user = r.user;
        try { ctx.user = (await api.patch('/api/me', { color })).user; } catch { /* keep the default colour */ }
        store.set('user', ctx.user);
        tab('acctsetup', { force: true }); // auth graph popped: Back can't return to sign-up
      } catch (err) { name.setError(err.message); }
    });
  } }, name, h('div', { class: 'title-s', style: 'padding:4px 4px 0' }, 'Your colour on the map'), sw, h('div', { class: 'mt8' }, go));
  el.append(
    h('header', { class: 'topbar' }, iconButton('arrow_back', { label: 'Back', onclick: back })),
    h('div', { class: 'screen-body pad' }, h('h1', { class: 'headline-m', style: 'margin:8px 0 4px' }, 'Create your account'),
      h('p', { class: 'body-m variant', style: 'margin-bottom:24px' }, 'No password needed. You’ll get an account code to sign in on other phones.'), form));
  setTimeout(() => name.input.focus(), 350);
});

// ---------------------------------------------------------------- 07 Setup (hub for 07a Bikes and 07b Permissions)
register('acctsetup', (el) => {
  const body = h('div', { class: 'screen-body pad' });
  const startBtn = button('Start riding', { size: 'large', wide: true, icon: 'two_wheeler' });
  el.append(body, h('div', { class: 'screen-foot' }, startBtn));
  let vehicles = [];
  const perms = () => store.get('permsAsked', false);
  const render = () => {
    const done = [vehicles.length > 0, perms(), ctx.contacts?.length > 0];
    const n = done.filter(Boolean).length;
    const r = ring(n / 3, { size: 72, stroke: 8, center: h('span', { class: 'title-m' }, `${n}/3`) });
    const item = (ok, icon, title, sub, name, optional) => h('button', { type: 'button', class: `setup-item${ok ? ' done' : ''}`, 'data-setup': name, onclick: () => push(name) },
      h('span', { class: 'si-icon' }, ic(ok ? 'check' : icon)), h('span', { class: 'main' }, h('span', { class: 'title-m' }, title), h('span', { class: 'body-m variant' }, sub)),
      optional && !ok ? h('span', { class: 'tag outline' }, 'Optional') : ic('chevron_right'));
    body.replaceChildren(
      h('div', { class: 'row gap16', style: 'align-items:center;margin:24px 0 8px' }, r, h('div', {}, h('h1', { class: 'headline-m', style: 'margin:0' }, `Set up Rylaide, ${ctx.user.name.split(' ')[0]}`), h('p', { class: 'body-m variant', style: 'margin:4px 0 0' }, 'A minute now saves fumbling on the road.'))),
      h('div', { class: 'stack gap12 mt16' },
        item(done[0], 'two_wheeler', 'Your bikes', vehicles.length ? vehicles.map((v) => v.nickname || v.model || v.make).join(', ') : 'Add every bike, scooter or bicycle you ride', 'setupbikes'),
        item(done[1], 'my_location', 'Location & microphone', done[1] ? 'Asked' : 'For the map, directions and talking to your group', 'permissions'),
        item(done[2], 'emergency', 'Emergency contacts', done[2] ? ctx.contacts.map((c) => c.name).join(', ') : 'Who SOS should call', 'contacts', true)));
  };
  const load = () => api.get('/api/vehicles').then((g) => { vehicles = g.vehicles; render(); }).catch(() => render());
  startBtn.onclick = async () => {
    if (!vehicles.length && !(await dialog({ title: 'Ride without a bike?', body: 'Home shows your bike and rides are logged to it. You can add it later in Garage.', confirm: 'Start anyway', cancel: 'Add a bike' }))) return push('setupbikes');
    window.dispatchEvent(new CustomEvent('rylaide:start', { detail: { fresh: true } }));
  };
  render(); load();
  el.onResume = load;
});

// ---------------------------------------------------------------- 07a Your bikes (more than one)
register('setupbikes', (el) => {
  const { body } = page(el, 'Your bikes', { back });
  const add = button('Add a bike', { style: 'tonal', icon: 'add', wide: true, onclick: () => import('./vehicles.js').then((m) => m.vehicleSheet(null, { onSaved: load })) });
  el.append(h('div', { class: 'screen-foot' }, button('Done', { size: 'large', wide: true, onclick: back })));
  const load = () => api.get('/api/vehicles').then(({ vehicles, activeId }) => {
    body.replaceChildren(
      h('p', { class: 'body-m variant', style: 'margin:8px 4px 16px' }, 'Add each bike, scooter, EV or bicycle you ride. Pick which one when you start a ride; the one marked Home shows on your Home screen.'),
      vehicles.length ? h('div', { class: 'list' }, vehicles.map((v) => listItem({
        lead: h('span', { class: 'veh-thumb', style: `background-image:url("${heroImage(v)}")` }), title: v.nickname || [v.make, v.model].filter(Boolean).join(' '), cls: 'veh-row',
        sub: [TYPES[vehicleType(v)].label, v.reg].filter(Boolean).join(' · '), attrs: { 'data-vehicle': v.id },
        trail: v.id === activeId ? h('span', { class: 'tag' }, 'Home') : null,
      }))) : null,
      h('div', { class: 'mt16' }, add));
    if (!vehicles.length && !el.dataset.opened) { el.dataset.opened = '1'; setTimeout(() => add.click(), 380); }
  }).catch((e) => body.replaceChildren(h('p', { class: 'body-m' }, e.message)));
  load();
});

register('permissions', (el) => {
  const state = { loc: false, mic: false };
  const card = (icon, title, body, key, ask) => {
    const b = button('Allow', { style: 'tonal' });
    b.onclick = async () => {
      try { await ask(); state[key] = true; b.replaceChildren(ic('check', { size: 18 }), 'Allowed'); b.disabled = true; } catch (e) { b.lastChild.textContent = 'Try again'; card.err.textContent = e.message; }
    };
    return h('div', { class: 'perm-card' }, ic(icon), h('div', { class: 'main' }, h('span', { class: 'title-m' }, title), h('span', { class: 'body-m variant' }, body), h('div', {}, b)));
  };
  card.err = h('p', { class: 'body-s', style: 'color:var(--error)', role: 'alert' });
  const askLoc = () => new Promise((res, rej) => navigator.geolocation
    ? navigator.geolocation.getCurrentPosition(res, (e) => rej(new Error(e.code === 1 ? 'Location is blocked. Turn it on in your browser’s site settings.' : 'Couldn’t get your location yet. You can continue.')), { timeout: 15000 })
    : rej(new Error('This device can’t share location.')));
  const askMic = async () => { const s = await getMic(); s.getTracks().forEach((t) => t.stop()); };
  el.append(
    h('div', { class: 'screen-body pad' },
      h('h1', { class: 'headline-m', style: 'margin:32px 0 8px' }, 'Two permissions'),
      h('p', { class: 'body-m variant', style: 'margin-bottom:24px' }, 'Rylaide only uses these while you ride, and only shares your location with the group you’re riding with.'),
      h('div', { class: 'stack gap12' },
        card('location_on', 'Location', 'For the map, directions and showing your group where you are.', 'loc', askLoc),
        card('mic', 'Microphone', 'For talking to your group through your headset.', 'mic', askMic),
        card.err)),
    h('div', { class: 'screen-foot' }, button('Continue', { size: 'large', wide: true, onclick: () => { store.set('permsAsked', true); back(); } })));
});

// ---------------------------------------------------------------- 04b Before you start
register('terms', (el) => {
  const { body } = page(el, '', { back });
  let ok = false;
  const go = button('Agree and continue', { size: 'large', wide: true, disabled: true, onclick: () => { store.set('termsAt', Date.now()); push('signin'); } });
  const box = checkbox({ label: 'I agree to the Terms of use and Privacy notice', onchange: (v) => { ok = v; go.disabled = !ok; } });
  body.append(
    h('h1', { class: 'headline-m', style: 'margin:0 0 4px' }, 'Before you start'),
    h('p', { class: 'body-m variant', style: 'margin-bottom:16px' }, 'Four things every Rylaide rider should know.'),
    h('div', { class: 'stack gap12' }, TERMS_SUMMARY.map(([icon, t, d]) => h('div', { class: 'perm-card' }, ic(icon), h('div', { class: 'main' }, h('span', { class: 'title-m' }, t), h('span', { class: 'body-m variant' }, d))))),
    h('div', { class: 'row gap8', style: 'margin:16px 0 8px;flex-wrap:wrap' },
      button('Terms of use', { style: 'text', icon: 'description', onclick: () => push('legal', { doc: 'terms' }) }),
      button('Privacy notice', { style: 'text', icon: 'policy', onclick: () => push('legal', { doc: 'privacy' }) })),
    h('label', { class: 'list-item switch-row', style: 'border-radius:16px;background:var(--surface-container);cursor:pointer' }, box, h('span', { class: 'main' }, h('span', { class: 'body-l wrap' }, 'I agree to the Terms of use and Privacy notice'))));
  el.append(h('div', { class: 'screen-foot' }, go));
});

// ---------------------------------------------------------------- 56 Terms of use · 57 Privacy (also from Settings → About)
register('legal', (el, params) => {
  const doc = params.doc === 'privacy' ? PRIVACY : TERMS;
  const { body } = page(el, params.doc === 'privacy' ? 'Privacy notice' : 'Terms of use', { back });
  body.append(h('p', { class: 'body-s variant', style: 'margin:0 0 16px' }, 'Prototype text in plain language. Last updated October 2026.'),
    doc.map(([t, d]) => h('section', { style: 'margin-bottom:20px' }, h('h2', { class: 'title-m', style: 'margin:0 0 6px' }, t), h('p', { class: 'body-m variant', style: 'margin:0' }, d))),
    h('p', { class: 'body-m', style: 'margin:8px 0 32px' }, 'Questions? Ask us from Settings → Customer care', supportEmail() ? [' or ', h('a', { href: `mailto:${supportEmail()}` }, supportEmail())] : null, '.'));
});

// ---------------------------------------------------------------- 05 Sign in (account code from your other phone)
register('signin', (el) => {
  const { body } = page(el, '', { back });
  const codeF = field({ label: 'Account code', attrs: { maxlength: 9, autocapitalize: 'characters', autocomplete: 'one-time-code', spellcheck: 'false', style: 'text-transform:uppercase;letter-spacing:3px;font-size:22px' }, support: '8 letters and numbers, like K7QM-4XPA' });
  codeF.input.addEventListener('input', () => {
    const raw = codeF.input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    codeF.input.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
    codeF.setError('');
  });
  const go = button('Sign in', { size: 'large', wide: true, type: 'submit' });
  const help = () => sheet((close) => h('div', { class: 'stack gap12' },
    h('h2', { class: 'headline-s' }, 'Find your account code'),
    h('ol', { class: 'body-m', style: 'margin:0;padding-left:20px;line-height:1.7' },
      h('li', {}, 'Open Rylaide on your old phone.'), h('li', {}, 'Go to Settings → Account.'), h('li', {}, 'Your code is under “Sign in on another phone”.')),
    h('p', { class: 'body-m variant' }, 'Lost the old phone? Ask Rylaide support with your name, group and a way to reach you. We’ll help you get back in.'),
    button('Ask Rylaide support', { style: 'tonal', icon: 'support_agent', onclick: () => { close(); push('careemail', { topic: 'account', signedOut: true }); } })));
  body.append(
    h('h1', { class: 'headline-m', style: 'margin:8px 0 16px' }, 'Welcome to Rylaide'),
    h('button', { type: 'button', class: 'setup-item primary', 'data-create': '', onclick: () => push('profile') }, h('span', { class: 'si-icon' }, ic('person_add')),
      h('span', { class: 'main' }, h('span', { class: 'title-m' }, 'Create an account'), h('span', { class: 'body-m' }, 'New to Rylaide. Takes a minute, no password.')), ic('chevron_right')),
    h('div', { class: 'divider', style: 'margin:24px 0' }),
    h('h2', { class: 'title-l', style: 'margin:0 0 4px' }, 'Already riding with Rylaide?'),
    h('p', { class: 'body-m variant', style: 'margin-bottom:20px' }, 'Enter the account code from Settings → Account on your other phone. Your rides, bikes and groups come with you.'),
    h('form', { class: 'stack gap16', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (codeF.input.value.replace('-', '').length < 8) return codeF.setError('Enter all 8 characters.');
      await withLoading(go, async () => {
        try {
          const r = await api.post('/api/signin', { code: codeF.input.value });
          api.setToken(r.token); ctx.user = r.user; store.set('user', r.user); store.set('termsAt', Date.now());
          window.dispatchEvent(new CustomEvent('rylaide:start', { detail: { welcomeBack: true } }));
        } catch (err) { codeF.setError(err.message); }
      });
    } }, codeF, go, button('Can’t find your code?', { style: 'text', onclick: help })), h('div', { style: 'height:24px' }));
});

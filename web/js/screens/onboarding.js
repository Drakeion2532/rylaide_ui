// 01 Splash → 02–04 Onboarding → 06 Create account → 07a Bike → 07b Permissions → 08 Home
import { h } from '../util.js';
import { api } from '../api.js';
import { ctx } from '../state.js';
import { ic, button, field, withLoading, iconButton } from '../ui.js';
import { register, push, back } from '../router.js';
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
  const next = button('Next', { size: 'large', wide: true, onclick: () => (i < PAGES.length - 1 ? show(i + 1) : push('profile')) });
  const skip = button('Skip', { style: 'text', onclick: () => push('profile') });
  const show = (n) => {
    i = n;
    art.style.backgroundImage = `url(${PAGES[n].img})`;
    text.replaceChildren(h('h1', { class: 'headline-l' }, PAGES[n].title), h('p', { class: 'body-l variant' }, PAGES[n].body));
    text.style.animation = 'none'; void text.offsetWidth; text.style.animation = '';
    dots.querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === n));
    next.lastChild.textContent = n === PAGES.length - 1 ? 'Get started' : 'Next';
  };
  // swipe between pages
  let x0 = null;
  el.addEventListener('pointerdown', (e) => (x0 = e.clientX));
  el.addEventListener('pointerup', (e) => { if (x0 === null) return; const dx = e.clientX - x0; if (dx < -50 && i < PAGES.length - 1) show(i + 1); if (dx > 50 && i > 0) show(i - 1); x0 = null; });
  el.append(h('div', { class: 'screen-body' }, art, text, dots), h('div', { class: 'screen-foot stack gap8' }, next, skip));
  show(0);
});

register('profile', (el) => {
  const name = field({ label: 'Your name', attrs: { maxlength: 40, autocomplete: 'given-name', enterkeyhint: 'next' }, support: 'What your group calls you' });
  const make = field({ label: 'Bike make', attrs: { maxlength: 30, placeholder: ' ' }, support: 'For example Royal Enfield' });
  const model = field({ label: 'Model', attrs: { maxlength: 40 }, support: 'For example Classic 350' });
  const odo = field({ label: 'Odometer (km)', type: 'number', attrs: { inputmode: 'numeric', min: 0 }, support: 'Optional. Used for your fuel log.' });
  const go = button('Continue', { size: 'large', wide: true, type: 'submit' });
  const form = h('form', { class: 'stack gap16', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    name.setError('');
    if (!name.input.value.trim()) { name.setError('Enter your name so your group knows who you are.'); name.input.focus(); return; }
    await withLoading(go, async () => {
      try {
        const vehicle = (make.input.value || model.input.value) ? { make: make.input.value, model: model.input.value, odometer: odo.input.value } : null;
        const r = await api.post('/api/users', { name: name.input.value, bike: 'motorcycle', vehicle });
        api.setToken(r.token);
        ctx.user = r.user;
        push('permissions', {}, { replace: true });
      } catch (err) { name.setError(err.message); }
    });
  } }, name, h('h2', { class: 'title-m mt8' }, 'Your bike'), make, model, odo, h('div', { class: 'mt8' }, go));
  el.append(
    h('header', { class: 'topbar' }, iconButton('arrow_back', { label: 'Back', onclick: back })),
    h('div', { class: 'screen-body pad' }, h('h1', { class: 'headline-m', style: 'margin:8px 0 4px' }, 'Set up Rylaide'),
      h('p', { class: 'body-m variant', style: 'margin-bottom:24px' }, 'No password needed. Your riding data stays on your account.'), form));
  setTimeout(() => name.input.focus(), 350);
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
    h('div', { class: 'screen-foot' }, button('Continue', { size: 'large', wide: true, onclick: () => window.dispatchEvent(new CustomEvent('rylaide:start', { detail: { fresh: true } })) })));
});

// Components from Figma "02 — Components", as small DOM builders.
import { h, initials, vibrate } from './util.js';
import { ICONS } from './icons.js';

/** Material Symbols Rounded glyph. Uses the subset font's codepoints so the font stays tiny. */
export function ic(name, { fill = false, size, cls = '' } = {}) {
  const cp = ICONS[name];
  const el = h('span', { class: `ms${fill ? ' fill' : ''}${cls ? ` ${cls}` : ''}`, 'aria-hidden': 'true', 'data-icon': name }, cp ? String.fromCodePoint(cp) : name);
  if (size) el.style.setProperty('--size', `${size}px`);
  return el;
}

export function button(label, { style = 'filled', size, icon, onclick, wide, type = 'button', disabled, attrs = {} } = {}) {
  return h('button', { type, class: `btn ${style}${size === 'large' ? ' large' : ''}${wide ? ' wide' : ''}`, onclick, disabled, ...attrs },
    icon ? ic(icon, { size: size === 'large' ? 24 : 18 }) : null, label);
}

/** Show a spinner inside a button while an async action runs (Figma Button / Loading state). */
export async function withLoading(btn, fn) {
  const kids = [...btn.childNodes];
  btn.classList.add('loading');
  btn.replaceChildren(h('span', { class: 'spinner' }), kids.filter((k) => k.nodeType === 3 || !k.classList?.contains('ms')).map((k) => k.cloneNode(true)));
  try { return await fn(); } finally { btn.classList.remove('loading'); btn.replaceChildren(...kids); }
}

export function iconButton(icon, { label, style = 'standard', onclick, fill, small, attrs = {} } = {}) {
  return h('button', { type: 'button', class: `icon-btn ${style}${small ? ' small' : ''}`, 'aria-label': label, title: label, onclick, ...attrs }, ic(icon, { fill }));
}

export function topBar({ title, back, actions = [], cls = '' } = {}) {
  return h('header', { class: `topbar ${cls}` },
    back ? iconButton('arrow_back', { label: 'Back', onclick: back }) : h('span', { style: 'width:12px' }),
    title ? h('h1', { class: 'title title-l' }, title) : h('span', { class: 'grow' }),
    ...actions);
}

/** Lifts the top bar (surface-container) when its scroll container is scrolled — Figma: "Top bar lifts on scroll". */
export function liftOnScroll(bar, scroller) {
  scroller.addEventListener('scroll', () => bar.classList.toggle('lifted', scroller.scrollTop > 4), { passive: true });
}

export function listItem({ icon, lead, title, sub, trail, onclick, cls = '', tag = 'div', attrs = {} }) {
  const el = h(onclick ? 'button' : tag, { type: onclick ? 'button' : undefined, class: `list-item${onclick ? ' tappable' : ''} ${cls}`, onclick, ...attrs },
    lead || (icon ? h('span', { class: 'lead' }, ic(icon)) : null),
    h('span', { class: 'main' }, h('span', { class: 'body-l' }, title), sub ? h('span', { class: 'body-m variant' }, sub) : null),
    trail !== undefined && trail !== null ? h('span', { class: 'trail label-m' }, trail) : null);
  return el;
}

export function switchEl({ checked, onchange, label }) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked: !!checked, 'aria-label': label, onchange: (e) => onchange?.(e.target.checked, e) });
  return h('span', { class: 'switch' }, input, h('span', { class: 'track' }), h('span', { class: 'thumb' }, ic('check')));
}

export function checkbox({ checked, onchange, label, error }) {
  const input = h('input', { type: 'checkbox', checked: !!checked, 'aria-label': label, onchange: (e) => onchange?.(e.target.checked, e) });
  return h('span', { class: `cbox${error ? ' error' : ''}` }, input, h('span', { class: 'box' }, ic('check')));
}

export function field({ label, value = '', type = 'text', name, attrs = {}, support, onSurface }) {
  const input = h('input', { type, name, value, placeholder: ' ', ...attrs });
  const sup = h('span', { class: 'support' }, support || '');
  const el = h('label', { class: `field${onSurface ? ' on-surface' : ''}` }, input, h('label', {}, label), support !== undefined ? sup : null);
  el.input = input;
  el.setError = (msg) => { el.classList.toggle('error', !!msg); sup.textContent = msg || support || ''; if (support === undefined && msg && !sup.isConnected) el.append(sup); };
  return el;
}

export function segmented(options, value, onchange, { label } = {}) {
  const el = h('div', { class: 'segmented', role: 'tablist', 'aria-label': label });
  const render = (v) => el.replaceChildren(...options.map((o) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(o.value === v), 'data-value': o.value,
    onclick: () => { render(o.value); onchange(o.value); },
  }, ic('check'), o.label)));
  render(value);
  el.set = render;
  return el;
}

/** Connection status pill (Figma: Connection status). */
export function connectionStatus(state, compact = false) {
  const map = {
    connecting: ['neutral', 'sync', 'Connecting…', true],
    connected: ['ok', 'check_circle', 'Connected'],
    nearby: ['ok', 'nearby', compact ? 'Nearby' : 'Connected nearby'],
    internet: ['neutral', 'public', compact ? 'Internet' : 'Connected'],
    reconnecting: ['warn', 'autorenew', 'Reconnecting…', true],
    disconnected: ['bad', 'link_off', 'Not connected'],
  };
  const [tone, icon, text, spin] = map[state] || map.connecting;
  return h('span', { class: `status ${tone}${compact ? ' compact' : ''}`, role: 'status', 'data-state': state }, ic(icon, { cls: spin ? 'spin' : '' }), text);
}

/** Rider avatar with status badge (Figma: Rider avatar). */
export function avatar(name, { status, size = '', accent, color } = {}) {
  const badgeIcon = { connected: 'check', speaking: 'graphic_eq', reconnecting: 'autorenew', off: 'link_off', muted: 'mic_off' }[status];
  const el = h('span', { class: `avatar ${size}${accent ? ' accent' : ''}${status === 'speaking' ? ' speaking' : ''}${status === 'off' ? ' away' : ''}` }, initials(name),
    badgeIcon ? h('span', { class: `badge ${status === 'muted' ? 'off' : status}` }, ic(badgeIcon, { fill: true })) : null);
  if (color) el.style.background = color;
  return el;
}

export function avatarStack(names, max = 3) {
  const shown = names.slice(0, max);
  return h('span', { class: 'avatar-stack' }, shown.map((n, i) => h('span', { class: `avatar${i % 2 === 0 ? ' accent' : ''}` }, initials(n))),
    names.length > max ? h('span', { class: 'avatar more' }, `+${names.length - max}`) : null);
}

/** Circular progress ring (Figma: Progress ring). value 0..1 */
export function ring(value, { size = 112, stroke = 10, center } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  const mk = (cls, extra = {}) => { const e = document.createElementNS(NS, 'circle'); Object.entries({ cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke, class: cls, ...extra }).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
  const bar = mk('bar', { 'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - value) });
  svg.append(mk('track'), bar);
  const el = h('div', { class: 'ring', style: `width:${size}px;height:${size}px` }, svg, center || null);
  el.set = (v) => bar.setAttribute('stroke-dashoffset', c * (1 - Math.max(0, Math.min(1, v))));
  return el;
}

/** In-ride control (Figma: Ride control). Long-press variants draw a hold ring. */
export function rideControl({ type, label, icon, onclick, hold, onHold, cls = '' }) {
  const NS = 'http://www.w3.org/2000/svg';
  const holdSvg = document.createElementNS(NS, 'svg');
  holdSvg.setAttribute('viewBox', '0 0 36 36');
  holdSvg.setAttribute('class', 'hold-ring');
  const c = document.createElementNS(NS, 'circle');
  Object.entries({ cx: 18, cy: 18, r: 16, pathLength: 100 }).forEach(([k, v]) => c.setAttribute(k, v));
  holdSvg.append(c);
  const inner = h('span', { class: `ctl ${type}` }, holdSvg, icon === 'SOS' ? h('span', { class: 'ms' }, 'SOS') : ic(icon));
  const lbl = h('span', { class: 'lbl' }, label);
  const el = h('button', { type: 'button', class: `ride-control ${cls}`, 'aria-label': label, onclick: hold ? undefined : onclick }, inner, lbl);
  el.setState = ({ type: t, label: l, icon: i }) => {
    if (t) inner.className = `ctl ${t}`;
    if (l) { lbl.textContent = l; el.setAttribute('aria-label', l); }
    if (i) inner.replaceChild(i === 'SOS' ? h('span', { class: 'ms' }, 'SOS') : ic(i), inner.lastChild);
  };
  if (hold) {
    // Long-press with a progress ring; a bump can't trigger it (Figma: Interaction patterns → Long press).
    let t = null;
    el.style.setProperty('--hold', `${hold}ms`);
    const start = (e) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('holding');
      vibrate(20);
      t = setTimeout(() => { t = null; el.classList.remove('holding'); vibrate([60, 40, 60]); onHold?.(); }, hold);
    };
    const cancel = () => { if (t) { clearTimeout(t); t = null; el.classList.remove('holding'); onclick?.(); } };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start(e); });
    el.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') cancel(); });
  }
  return el;
}

// ---------------------------------------------------------------- snackbar / banner / dialog / sheet
export function snackbar(text, { action, ms = 4000 } = {}) {
  const host = document.getElementById('snackbars');
  const el = h('div', { class: 'snackbar', role: 'status' }, h('span', { class: 'msg' }, text));
  const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), 160); };
  if (action) el.append(h('button', { type: 'button', class: 'btn text', onclick: () => { dismiss(); action.run(); } }, action.label));
  host.append(el);
  while (host.children.length > 2) host.firstElementChild.remove();
  setTimeout(dismiss, ms);
  return dismiss;
}

/** Ride status banner (Figma: Ride status banner). */
export function banner({ tone = 'dark', icon, title, sub, action }) {
  return h('div', { class: `banner ${tone}`, role: 'status' }, icon ? ic(icon) : null,
    h('span', { class: 'main' }, h('span', { class: 'title-s' }, title), sub ? h('span', { class: 'body-m' }, sub) : null),
    action ? h('button', { type: 'button', class: 'btn text', onclick: action.run }, action.label) : null);
}

function overlay(kind, build) {
  const host = document.getElementById('overlays');
  const scrim = h('div', { class: 'scrim' });
  const ov = h('div', { class: `overlay ${kind === 'dialog' ? 'center' : ''}` }, scrim);
  let closed = false;
  const close = (v) => new Promise((res) => {
    if (closed) return res();
    closed = true;
    ov.classList.add('closing');
    setTimeout(() => { ov.remove(); res(); ov.resolve?.(v); }, 240);
    document.removeEventListener('keydown', esc);
  });
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  scrim.addEventListener('click', () => close());
  ov.append(build(close));
  host.append(ov);
  return { close, done: new Promise((r) => (ov.resolve = r)) };
}

export function dialog({ title, body, confirm = 'OK', cancel = 'Cancel', danger }) {
  const { done } = overlay('dialog', (close) => h('div', { class: 'dialog', role: 'alertdialog', 'aria-label': title },
    h('h2', { class: 'headline-s' }, title),
    body ? h('p', { class: 'body-m variant' }, body) : null,
    h('div', { class: 'actions' },
      cancel ? button(cancel, { style: 'text', onclick: () => close(false) }) : null,
      button(confirm, { style: danger ? 'text danger-text' : 'text', onclick: () => close(true), attrs: danger ? { style: 'color:var(--error)' } : {} }))));
  return done;
}

export function sheet(build) {
  return overlay('sheet', (close) => {
    const el = h('div', { class: 'sheet', role: 'dialog' }, h('div', { class: 'handle' }));
    // swipe down on the handle to dismiss
    let y0 = null;
    el.addEventListener('pointerdown', (e) => { if (e.target.classList.contains('handle') || e.clientY - el.getBoundingClientRect().top < 40) y0 = e.clientY; });
    el.addEventListener('pointerup', (e) => { if (y0 !== null && e.clientY - y0 > 60) close(); y0 = null; });
    el.append(h('div', { class: 'sheet-body' }, build(close)));
    return el;
  });
}

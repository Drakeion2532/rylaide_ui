// One navigation graph (Figma: "Navigation map · for development").
// Four bottom tabs are top level; every other screen has one fixed parent; Back goes to that parent.
// Tabs fade through (200 ms); forward screens slide (300 ms ease-out).
import { h } from './util.js';

const registry = {};
const stack = []; // [{name, params, el, cleanup}]
let currentTab = 'home';
let navbarRender = () => {};

export const TABS = ['home', 'groups', 'history', 'garage'];

export function register(name, render) { registry[name] = render; }
export function onTabsChanged(fn) { navbarRender = fn; }
export const current = () => stack[stack.length - 1];
export const activeTab = () => currentTab;

function mount(name, params) {
  const render = registry[name];
  if (!render) throw new Error(`No screen ${name}`);
  const el = h('section', { class: 'screen', 'data-screen': name });
  const cleanup = render(el, params || {}) || null;
  return { name, params, el, cleanup };
}

function animateOut(entry, cls) {
  const { el } = entry;
  el.classList.add(cls);
  el.style.pointerEvents = 'none';
  const done = () => { el.remove(); };
  el.addEventListener('animationend', done, { once: true });
  setTimeout(done, 400);
  try { entry.cleanup?.(); } catch { /* ignore */ }
}

/** Switch bottom tab. Resets to the tab's root screen. */
export function tab(name, { force } = {}) {
  const stage = document.getElementById('stage');
  const top = current();
  if (!force && top && top.name === name && stack.length === 1) return;
  const entry = mount(name, {});
  while (stack.length) {
    const e = stack.pop();
    if (e === top) animateOut(e, 'exit-fade'); else { try { e.cleanup?.(); } catch { /* ignore */ } e.el.remove(); }
  }
  stack.push(entry);
  entry.el.classList.add('enter-fade');
  stage.append(entry.el);
  if (TABS.includes(name)) currentTab = name;
  navbarRender(currentTab, TABS.includes(name));
  history.replaceState({ depth: 0 }, '');
}

/** Open a child screen on top (slide in). opts.full hides the bottom nav (ride screens, setup flow). */
export function push(name, params = {}, { full = true, replace = false, anim = 'forward' } = {}) {
  const stage = document.getElementById('stage');
  const prev = current();
  const entry = mount(name, params);
  entry.full = full;
  if (replace && prev) { stack.pop(); animateOut(prev, 'exit-fade'); }
  else if (prev) { prev.el.classList.remove('enter-forward', 'enter-back', 'enter-fade'); prev.el.classList.add('exit-forward'); setTimeout(() => prev.el.classList.remove('exit-forward'), 320); prev.el.inert = true; }
  stack.push(entry);
  entry.el.classList.add(anim === 'up' ? 'enter-up' : replace ? 'enter-fade' : 'enter-forward');
  stage.append(entry.el);
  navbarRender(currentTab, !full && TABS.includes(stack[0]?.name));
  if (!replace) history.pushState({ depth: stack.length - 1 }, '');
  return entry;
}

/** Go up to the parent screen. */
export function back() {
  if (stack.length <= 1) {
    if (currentTab !== 'home') tab('home');
    return false;
  }
  const top = stack.pop();
  animateOut(top, top.el.classList.contains('enter-up') ? 'exit-down' : 'exit-back');
  const prev = current();
  prev.el.inert = false;
  prev.el.classList.remove('exit-forward');
  prev.el.classList.add('enter-back');
  setTimeout(() => prev.el.classList.remove('enter-back'), 320);
  prev.onResume?.();
  navbarRender(currentTab, !prev.full && TABS.includes(stack[0]?.name));
  return true;
}

/** Pop everything above the tab root, then optionally push. */
export function resetTo(tabName, then) {
  tab(tabName, { force: true });
  if (then) push(then.name, then.params, then.opts);
}

// System Back (Android gesture / browser back) follows the same graph.
window.addEventListener('popstate', () => {
  if (document.querySelector('#overlays .overlay')) {
    document.querySelector('#overlays .overlay .scrim')?.click();
    history.pushState({ depth: stack.length - 1 }, '');
    return;
  }
  const blocked = current()?.el.dataset.blockBack === '1';
  if (blocked) { history.pushState({ depth: stack.length - 1 }, ''); current()?.onBackBlocked?.(); return; }
  if (!back() && stack.length <= 1 && currentTab === 'home') { /* leave the app: let the browser handle it */ }
});

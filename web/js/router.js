// Copyright (c) 2026 Shubhan Punde · https://github.com/Drakeion2532/rylaide_ui · All rights reserved · sp2532-ce395384fbda
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
  // A screen can set el.onResume to refresh when the screen above it closes.
  return { name, params, el, cleanup, onResume: () => el.onResume?.() };
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

const parked = {}; // tab -> saved stack (Figma: "save and restore each tab's state")

function destroy(e) { try { e.cleanup?.(); } catch { /* ignore */ } e.el.remove(); }
function park(list) { for (const e of list) { e.el.classList.add('parked'); e.el.inert = true; } }

/**
 * Switch bottom tab (fade-through 200 ms). Switching restores where you were on that tab;
 * tapping the tab you're on goes back to its first screen. Non-tab roots (welcome, setup) clear everything.
 */
export function tab(name, { force } = {}) {
  const stage = document.getElementById('stage');
  const top = current();
  const isTab = TABS.includes(name);
  if (!force && top && top.name === name && stack.length === 1) return;
  const leaving = stack.splice(0);
  const sameTab = isTab && leaving[0]?.name === name; // tapping the tab you're on
  if (!force && isTab && !sameTab && TABS.includes(leaving[0]?.name)) {
    // switching tabs: keep where you were
    if (top) { top.el.classList.add('exit-fade'); setTimeout(() => top.el.classList.remove('exit-fade'), 220); }
    const key = leaving[0].name;
    parked[key] = leaving;
    setTimeout(() => { if (parked[key] === leaving) park(leaving); }, top ? 200 : 0); // not if already restored
  } else if (!force && sameTab) {
    // re-tap: back to the tab's first screen
    for (const e of leaving.slice(1)) (e === top ? animateOut(e, 'exit-back') : destroy(e));
  } else {
    for (const e of leaving) (e === top ? animateOut(e, 'exit-fade') : destroy(e));
  }
  if (!isTab) { for (const k of Object.keys(parked)) { parked[k].forEach(destroy); delete parked[k]; } }
  else if (force && parked[name]) { parked[name].forEach(destroy); delete parked[name]; }
  // arriving
  if (!force && isTab && parked[name]) {
    const restored = parked[name];
    delete parked[name];
    for (const e of restored) { e.el.classList.remove('parked'); e.el.inert = true; }
    stack.push(...restored);
    const t = current();
    t.el.inert = false;
    t.el.classList.remove('exit-forward', 'enter-forward', 'enter-back');
    t.el.classList.add('enter-fade'); setTimeout(() => t.el.classList.remove('enter-fade'), 220);
    t.onResume?.();
  } else if (!force && sameTab) {
    const root = leaving[0];
    root.el.inert = false;
    root.el.classList.remove('exit-forward', 'parked');
    root.el.classList.add('enter-back'); setTimeout(() => root.el.classList.remove('enter-back'), 320);
    stack.push(root);
    root.onResume?.();
  } else {
    const entry = mount(name, {});
    stack.push(entry);
    entry.el.classList.add('enter-fade');
    stage.append(entry.el);
  }
  if (isTab) currentTab = name;
  const t = current();
  navbarRender(currentTab, isTab && !t.full);
  history.replaceState({ depth: stack.length - 1 }, '');
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

/**
 * Up to a fixed parent (Figma: "every other screen has one fixed parent"). If the parent screen is
 * underneath, pop back to it; otherwise open the parent's tab.
 */
export function upTo(name, tabName = name) {
  const i = stack.map((e) => e.name).lastIndexOf(name);
  if (i >= 0 && i < stack.length - 1) { while (stack.length - 1 > i + 1) { const e = stack.splice(stack.length - 2, 1)[0]; try { e.cleanup?.(); } catch { /* ignore */ } e.el.remove(); } back(); return; }
  tab(tabName, { force: true });
}

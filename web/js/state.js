import { store } from './util.js';
import { Realtime } from './api.js';

export const ctx = {
  user: store.get('user', null),
  groups: [],
  group: null,          // currently open group
  locs: new Map(),      // userId -> last location
  sos: new Map(),       // userId -> alert
  messages: [],
  unread: 0,
  pos: null,            // my last GPS fix
  weather: null,
  contacts: [],
  ride: null,           // active ride (see engine.startRide)
  plan: null,           // ride-setup draft
  voiceOn: store.get('voiceOn', true),
  noiseCancel: store.get('noiseCancel', true),
  conn: 'connecting',
};

export const rt = new Realtime();

const bus = new EventTarget();
export function emit(type, detail) { bus.dispatchEvent(new CustomEvent(type, { detail })); }
/** Subscribe; returns an unsubscribe function (screens call it on cleanup). */
export function on(type, fn) {
  const wrap = (e) => fn(e.detail);
  bus.addEventListener(type, wrap);
  return () => bus.removeEventListener(type, wrap);
}
export function onMany(map) { const offs = Object.entries(map).map(([t, f]) => on(t, f)); return () => offs.forEach((o) => o()); }

export const setting = (k, d) => store.get(k, d);
export function setSetting(k, v) { store.set(k, v); emit('settings', { [k]: v }); }

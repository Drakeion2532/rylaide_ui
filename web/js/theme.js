// Day · Evening · Night (Figma: "Riding conditions") and the 8 rider accents (Figma: "Accent mapping").
// Light uses tone 40 for primary, dark uses tone 80, containers 90 / 30.
import { store } from './util.js';

export const ACCENTS = {
  blue:   { name: 'Blue',   l: ['#0159c7', '#ffffff', '#d9e2ff', '#001944'], d: ['#84aaff', '#001944', '#004299', '#d9e2ff'], e: ['#afc6ff', '#002c70', '#0159c7', '#ffffff'], sec: ['#dbe2f9', '#293042'] },
  teal:   { name: 'Teal',   l: ['#006b5f', '#ffffff', '#74f8e5', '#00201c'], d: ['#2fc9b6', '#003731', '#005048', '#74f8e5'], e: ['#53dbc9', '#003731', '#006b5f', '#ffffff'], sec: ['#cce8e2', '#1f3a36'] },
  green:  { name: 'Green',  l: ['#1f6b2c', '#ffffff', '#a6f4a3', '#002106'], d: ['#6fbf73', '#00390c', '#00531a', '#a6f4a3'], e: ['#8bd88a', '#00390c', '#1f6b2c', '#ffffff'], sec: ['#d3e8cf', '#263425'] },
  yellow: { name: 'Yellow', l: ['#6b5c00', '#ffffff', '#fbe271', '#201c00'], d: ['#d6b600', '#383000', '#524600', '#fbe271'], e: ['#dec64f', '#383000', '#6b5c00', '#ffffff'], sec: ['#ece2c5', '#363224'] },
  orange: { name: 'Orange', l: ['#934b00', '#ffffff', '#ffdcc3', '#301400'], d: ['#ff8f3a', '#4f2500', '#713700', '#ffdcc3'], e: ['#ffb77e', '#4f2500', '#934b00', '#ffffff'], sec: ['#f6ddcf', '#3d2d24'] },
  red:    { name: 'Red',    l: ['#b3261e', '#ffffff', '#ffdad5', '#410001'], d: ['#ff8a7d', '#690004', '#93000a', '#ffdad5'], e: ['#ffb4a9', '#690004', '#b3261e', '#ffffff'], sec: ['#f7dcd8', '#3f2a28'] },
  purple: { name: 'Purple', l: ['#6f4ab8', '#ffffff', '#ebddff', '#250058'], d: ['#c3a5ff', '#3b1586', '#56339e', '#ebddff'], e: ['#d3bbff', '#3b1586', '#6f4ab8', '#ffffff'], sec: ['#e8def8', '#332d41'] },
  pink:   { name: 'Pink',   l: ['#9c3d75', '#ffffff', '#ffd8e9', '#3d0028'], d: ['#ffa4d3', '#5e1144', '#7e255c', '#ffd8e9'], e: ['#ffaed6', '#5e1144', '#9c3d75', '#ffffff'], sec: ['#f8dce7', '#3f2d36'] },
};

/** Approximate sunrise/sunset (NOAA, ±few minutes) in local ms for the given day and place. */
export function sunTimes(date, lat, lng) {
  const rad = Math.PI / 180;
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const n = Math.floor((date.getTime() - start) / 864e5);
  const g = (2 * Math.PI / 365) * (n - 1);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const cosH = (Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl))) - Math.tan(lat * rad) * Math.tan(decl);
  if (cosH > 1 || cosH < -1) return null; // polar day/night
  const ha = Math.acos(cosH) / rad;
  const noonMin = 720 - 4 * lng - eqt; // minutes from UTC midnight
  const day0 = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return { sunrise: day0 + (noonMin - 4 * ha) * 6e4, sunset: day0 + (noonMin + 4 * ha) * 6e4 };
}

let lastPos = store.get('lastPos', null);
export function setThemePosition(lat, lng) { lastPos = { lat, lng }; store.set('lastPos', lastPos); applyTheme(); }

/** 'day' | 'evening' | 'night' for the current setting, time and place. */
export function currentLight() {
  const mode = store.get('theme', 'auto');
  if (mode === 'light') return 'day';
  if (mode === 'dark') return 'night';
  const now = new Date();
  const t = lastPos ? sunTimes(now, lastPos.lat, lastPos.lng) : null;
  const sunrise = t ? t.sunrise : new Date(now).setHours(6, 15, 0, 0);
  const sunset = t ? t.sunset : new Date(now).setHours(18, 30, 0, 0);
  const ms = now.getTime();
  if (ms >= sunrise && ms < sunset - 3600e3) return 'day';
  if (ms >= sunset - 3600e3 && ms < sunset) return 'evening';
  return 'night';
}

export function applyTheme() {
  const root = document.documentElement;
  const light = currentLight();
  if (light === 'day') delete root.dataset.light; else root.dataset.light = light;
  const a = ACCENTS[store.get('accent', 'blue')] || ACCENTS.blue;
  const set = light === 'day' ? a.l : light === 'evening' ? a.e : a.d;
  root.style.setProperty('--primary', set[0]);
  root.style.setProperty('--on-primary', set[1]);
  root.style.setProperty('--primary-container', set[2]);
  root.style.setProperty('--on-primary-container', set[3]);
  root.style.setProperty('--secondary-container', light === 'day' ? a.sec[0] : a.sec[1]);
  root.classList.toggle('glove', !!store.get('glove', false));
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--background').trim() || '#faf9fd');
  window.dispatchEvent(new CustomEvent('rylaide:theme', { detail: light }));
  return light;
}
// Re-check the light every few minutes so the app slides into Evening and Night on its own.
setInterval(() => { if (store.get('theme', 'auto') === 'auto') applyTheme(); }, 5 * 60e3);

// Which way the rider is facing, for a map that turns with them (like Google Maps' compass mode).
//
// Stopped or slow: the phone's compass (gyro + magnetometer, fused by the phone): turn the phone, the map turns.
// Moving faster than ~12 km/h: the GPS direction of travel. On a bike that's more reliable than the compass,
// which the engine, the handlebar and the phone mount's magnet can throw off.
import { ctx, emit } from './state.js';

const GPS_SPEED = 3.3;        // m/s (~12 km/h): above this, trust the GPS course
const SMOOTH = 0.18;          // compass smoothing (0..1, higher = snappier)
let compass = null;           // smoothed compass heading, degrees clockwise from north
let compassAt = 0;
let sx = 0, sy = 0;           // smoothing state (unit vector)
let listening = false;
let last = null;

const screenAngle = () => (screen.orientation?.angle ?? window.orientation ?? 0) || 0;
const norm = (d) => ((d % 360) + 360) % 360;

function onAbsolute(e) {
  if (e.alpha == null) return;
  feed(360 - e.alpha);
}
function onIos(e) {
  if (typeof e.webkitCompassHeading !== 'number' || e.webkitCompassHeading < 0) return;
  feed(e.webkitCompassHeading);
}
function feed(raw) {
  const d = norm(raw + screenAngle()) * Math.PI / 180;
  const x = Math.sin(d), y = Math.cos(d);
  if (compass == null) { sx = x; sy = y; } else { sx += (x - sx) * SMOOTH; sy += (y - sy) * SMOOTH; }
  compass = norm(Math.atan2(sx, sy) * 180 / Math.PI);
  compassAt = performance.now();
  update();
}

/** Current best heading (degrees), or null when nothing is known. */
export function heading() {
  const p = ctx.pos;
  const gpsOk = p && Number.isFinite(p.heading) && (p.speed ?? 0) >= GPS_SPEED && Date.now() - (p.ts || 0) < 5000;
  if (gpsOk) return { deg: p.heading, source: 'gps' };
  if (compass != null && performance.now() - compassAt < 3000) return { deg: compass, source: 'compass' };
  if (p && Number.isFinite(p.heading) && (p.speed ?? 0) > 1) return { deg: p.heading, source: 'gps' };
  return null;
}

let raf = 0;
function update() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const h = heading();
    if (!h) return;
    if (last && Math.abs(((h.deg - last.deg + 540) % 360) - 180) < 0.8 && h.source === last.source) return;
    last = h;
    ctx.heading = h;
    emit('heading', h);
  });
}

/**
 * Start listening to the compass. On iPhone this must run from a tap the first time (iOS asks permission).
 * Resolves to true if the compass is available.
 */
export async function startCompass() {
  if (listening) return true;
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return false;
  if (typeof DOE.requestPermission === 'function') {
    try { if ((await DOE.requestPermission()) !== 'granted') return false; } catch { return false; }
  }
  listening = true;
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onAbsolute);
  else window.addEventListener('deviceorientation', onIos);
  return true;
}

export function stopCompass() {
  if (!listening) return;
  listening = false;
  window.removeEventListener('deviceorientationabsolute', onAbsolute);
  window.removeEventListener('deviceorientation', onIos);
  compass = null;
}

/** GPS fixes also move the heading (engine calls this on every fix). */
export const onPosition = () => update();

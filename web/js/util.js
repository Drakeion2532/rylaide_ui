export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Build DOM safely: h('div', {class:'x', onclick}, 'text', child) — strings are always text nodes. */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

export function toast(text, { error = false, ms = 3200, action } = {}) {
  const host = $('#toasts');
  const el = h('div', { class: `toast${error ? ' err' : ''}`, role: error ? 'alert' : 'status' }, h('span', {}, text));
  if (action) el.append(h('button', { type: 'button', onclick: () => { action.run(); dismiss(); } }, action.label));
  host.append(el);
  while (host.children.length > 2) host.firstElementChild.remove();
  const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  setTimeout(dismiss, ms);
  return dismiss;
}

export const vibrate = (p) => { try { navigator.vibrate?.(p); } catch { /* not supported */ } };

export const fmtKm = (m) => (m >= 10000 ? (m / 1000).toFixed(0) : (m / 1000).toFixed(1));
export function fmtDist(m) {
  if (m < 50) return 'now';
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${fmtKm(m)} km`;
}
export function fmtDur(s) {
  s = Math.round(s);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}
export function fmtEta(s) {
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
export const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const initials = (name = '?') => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';

export function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Distance in metres from point p [lat,lng] to the polyline line [[lng,lat],...]. Flat-earth approximation, fine at road scale. */
export function distToLine(p, line) {
  const k = Math.cos((p[0] * Math.PI) / 180) * 111320, kLat = 110540;
  const px = p[1] * k, py = p[0] * kLat;
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = line[i - 1][0] * k, ay = line[i - 1][1] * kLat, bx = line[i][0] * k, by = line[i][1] * kLat;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
  }
  return best;
}

export const store = {
  get(k, d) { try { const v = localStorage.getItem(`rylaide.${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`rylaide.${k}`, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem(`rylaide.${k}`); } catch { /* ignore */ } },
};

export function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}
export function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Today's date in the rider's own time zone, as YYYY-MM-DD. */
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

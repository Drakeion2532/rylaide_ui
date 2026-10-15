// MapLibre wrapper styled to Figma "Map / Base": neutral grey streets, primary route, dashed grey alternatives,
// red destination pin, blue "me" puck with heading cone. Tiles: OpenFreeMap (Positron by day, Dark at night).
import { h, initials, etaShort } from './util.js';
import { ic } from './ui.js';

const STYLE = {
  day: ['https://tiles.openfreemap.org/styles/positron', 'https://tiles.openfreemap.org/styles/liberty'],
  night: ['https://tiles.openfreemap.org/styles/dark', 'https://tiles.openfreemap.org/styles/positron'],
};
const PUNE = [73.8567, 18.5204];
const styleCache = {};

function loadLib() {
  if (window.maplibregl) return Promise.resolve();
  if (loadLib.p) return loadLib.p;
  loadLib.p = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '/vendor/maplibre/maplibre-gl.js'; s.onload = res; s.onerror = () => rej(new Error('map library failed to load'));
    document.head.append(s);
  });
  return loadLib.p;
}

async function getStyle(kind) {
  if (styleCache[kind] !== undefined) return styleCache[kind];
  for (const url of STYLE[kind]) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) return (styleCache[kind] = await r.json());
    } catch { /* next */ }
  }
  styleCache[kind] = null;
  setTimeout(() => { delete styleCache[kind]; }, 60000); // try the network again later
  return null;
}
const blank = (night) => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': night ? '#1e1f22' : '#e9e8ed' } }] });
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const isNight = () => !!document.documentElement.dataset.light;

export class RideMap {
  constructor(el, { interactive = true, center, zoom = 14, onFollowChange } = {}) {
    this.el = el; this.interactive = interactive; this.center = center; this.zoom = zoom;
    this.onFollowChange = onFollowChange || (() => {});
    this.riders = new Map(); this.labels = []; this.queue = []; this.ready = false; this.follow = true;
  }

  async init() {
    try { await loadLib(); } catch { return this.fail(); }
    const night = isNight();
    const style = await getStyle(night ? 'night' : 'day');
    this.tilesOk = !!style;
    if (!this.el.isConnected) return false;
    try {
      this.map = new window.maplibregl.Map({
        container: this.el, style: style || blank(night), center: this.center || PUNE, zoom: this.zoom,
        attributionControl: false, interactive: this.interactive, pitchWithRotate: false, dragRotate: false, fadeDuration: 120,
      });
    } catch { return this.fail(); }
    this.map.touchZoomRotate?.disableRotation();
    this.map.on('error', () => {});
    this.map.on('dragstart', () => { if (this.follow) { this.follow = false; this.onFollowChange(false); } });
    if (style) this.el.append(h('div', { class: 'map-attrib' }, '© OpenStreetMap · OpenFreeMap'));
    await new Promise((r) => (this.map.loaded() ? r() : this.map.once('load', r)));
    this.addLayers();
    this.ready = true;
    this.queue.splice(0).forEach((f) => f());
    this.themeOff = (() => { const f = () => this.retheme(); window.addEventListener('rylaide:theme', f); return () => window.removeEventListener('rylaide:theme', f); })();
    return true;
  }
  fail() { this.el.append(h('p', { class: 'map-fallback-note body-m' }, 'The map can’t be shown on this device.')); return false; }
  when(f) { this.ready ? f() : this.queue.push(f); }
  destroy() { this.themeOff?.(); try { this.map?.remove(); } catch { /* ignore */ } this.map = null; }
  resize() { this.when(() => this.map.resize()); }

  async retheme() {
    if (!this.map) return;
    const night = isNight();
    if (night === this.night) return;
    this.night = night;
    const style = await getStyle(night ? 'night' : 'day');
    this.map.setStyle(style || blank(night));
    this.map.once('styledata', () => { this.addLayers(); this.setRoutes(this.routes, this.sel); this.setTrack(this.track); });
  }

  addLayers() {
    const m = this.map;
    const empty = { type: 'FeatureCollection', features: [] };
    const primary = cssVar('--primary') || '#0159c7';
    for (const id of ['alts', 'route', 'track']) if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: empty });
    if (!m.getLayer('alts')) m.addLayer({ id: 'alts', type: 'line', source: 'alts', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#6f727a', 'line-width': 5, 'line-dasharray': [1.2, 1.2] } });
    if (!m.getLayer('route-casing')) m.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': .9 } });
    if (!m.getLayer('route')) m.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': primary, 'line-width': 6 } });
    if (!m.getLayer('track')) m.addLayer({ id: 'track', type: 'line', source: 'track', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': primary, 'line-width': 5, 'line-opacity': .55 } });
    m.on('click', 'alts', (e) => this.onAltClick?.(e.features?.[0]?.properties?.i));
  }

  // ---------------------------------------------------------------- me + riders
  setMe(pos) {
    this.when(() => {
      if (!this.me) {
        this.meEl = h('div', { class: 'me-puck' }, h('div', { class: 'cone', hidden: true }), h('div', { class: 'dot' }, ic('navigation', { fill: true })));
        this.me = new window.maplibregl.Marker({ element: this.meEl, rotationAlignment: 'map' }).setLngLat([pos.lng, pos.lat]).addTo(this.map);
      }
      this.me.setLngLat([pos.lng, pos.lat]);
      const moving = Number.isFinite(pos.heading) && (pos.speed ?? 0) > 1;
      this.meEl.querySelector('.cone').hidden = !moving;
      this.me.setRotation(moving ? pos.heading : 0);
      if (this.follow) this.map.easeTo({ center: [pos.lng, pos.lat], duration: 600 });
    });
  }

  upsertRider(r, { sos } = {}) {
    this.when(() => {
      let m = this.riders.get(r.userId);
      if (!m) {
        const el = h('div', { class: 'rider-pin', 'data-rider': r.userId }, h('span', { class: 'avatar' }, initials(r.name)), h('span', { class: 'name' }, r.name.split(' ')[0]));
        el.addEventListener('click', () => this.map.easeTo({ center: [r.lng, r.lat], zoom: 16 }));
        m = { el, marker: new window.maplibregl.Marker({ element: el, anchor: 'top', offset: [0, -18] }).setLngLat([r.lng, r.lat]).addTo(this.map) };
        this.riders.set(r.userId, m);
      }
      m.data = r;
      m.marker.setLngLat([r.lng, r.lat]);
      const av = m.el.querySelector('.avatar');
      av.textContent = initials(r.name);
      av.style.background = r.color || '';
      av.style.color = '#fff';
      m.el.querySelector('.name').textContent = r.name.split(' ')[0];
      m.el.classList.toggle('sos', !!sos);
      m.el.classList.remove('stale');
    });
  }
  setSos(userId, on) { const m = this.riders.get(userId); if (m) m.el.classList.toggle('sos', on); }
  markStale(ms) { const now = Date.now(); for (const m of this.riders.values()) m.el.classList.toggle('stale', now - (m.data?.ts || 0) > ms); }
  removeRider(id) { const m = this.riders.get(id); if (m) { m.marker.remove(); this.riders.delete(id); } }

  setFollow(on) { this.follow = on; this.onFollowChange(on); }
  centerOn(lng, lat, zoom = 15) { this.when(() => this.map.easeTo({ center: [lng, lat], zoom, duration: 500 })); }
  fitAll(extra = []) {
    this.when(() => {
      const pts = [...this.riders.values()].map((m) => [m.data.lng, m.data.lat]);
      if (this.me) pts.push(this.me.getLngLat().toArray());
      pts.push(...extra);
      if (!pts.length) return;
      if (pts.length === 1) return this.map.easeTo({ center: pts[0], zoom: 15 });
      const b = new window.maplibregl.LngLatBounds(pts[0], pts[0]);
      pts.forEach((p) => b.extend(p));
      this.map.fitBounds(b, { padding: 70, maxZoom: 16, duration: 600 });
    });
  }

  // ---------------------------------------------------------------- routes
  /** routes: array of {geometry, duration}; sel: selected index. Draws the selected route solid, the rest dashed with time labels. */
  setRoutes(routes, sel = 0, { fit = true, labels = true, padding } = {}) {
    this.routes = routes; this.sel = sel;
    this.when(() => {
      this.labels.forEach((l) => l.remove());
      this.labels = [];
      const main = routes?.[sel];
      this.map.getSource('route')?.setData(main ? { type: 'Feature', geometry: main.geometry, properties: {} } : { type: 'FeatureCollection', features: [] });
      this.map.getSource('alts')?.setData({ type: 'FeatureCollection', features: (routes || []).map((r, i) => (i === sel ? null : { type: 'Feature', geometry: r.geometry, properties: { i } })).filter(Boolean) });
      if (main && this.map.getLayer('route')) this.map.setPaintProperty('route', 'line-color', cssVar('--primary') || '#0159c7');
      if (labels && routes?.length > 1) {
        routes.forEach((r, i) => {
          const c = r.geometry.coordinates;
          const at = c[Math.floor(c.length * (0.35 + 0.15 * i))] || c[0];
          const el = h('span', { class: `route-label${i === sel ? ' on' : ''}`, role: 'button', 'aria-label': `Route ${i + 1}: ${etaShort(r.duration)}` }, i === sel ? ic('check') : null, etaShort(r.duration));
          el.addEventListener('click', (e) => { e.stopPropagation(); this.onAltClick?.(i); });
          this.labels.push(new window.maplibregl.Marker({ element: el }).setLngLat(at).addTo(this.map));
        });
      }
      if (fit && main) this.fitLine(main.geometry.coordinates, padding);
    });
  }
  fitLine(coords, padding = { top: 90, bottom: 300, left: 40, right: 40 }) {
    this.when(() => {
      if (!coords?.length) return;
      const b = new window.maplibregl.LngLatBounds(coords[0], coords[0]);
      coords.forEach((p) => b.extend(p));
      const box = this.el.getBoundingClientRect();
      const pad = typeof padding === 'number' ? padding : { ...padding, bottom: Math.min(padding.bottom, box.height * 0.55), top: Math.min(padding.top, box.height * 0.2) };
      this.map.fitBounds(b, { padding: pad, duration: 700, maxZoom: 16 });
    });
  }
  setDestination(lng, lat) {
    this.when(() => {
      this.dest?.remove(); this.dest = null;
      if (lng === null || lng === undefined) return;
      this.dest = new window.maplibregl.Marker({ element: h('div', { class: 'dest-pin' }, ic('location_on', { fill: true })), anchor: 'bottom' }).setLngLat([lng, lat]).addTo(this.map);
    });
  }
  setOrigin(lng, lat) {
    this.when(() => {
      this.origin?.remove(); this.origin = null;
      if (lng === null || lng === undefined) return;
      this.origin = new window.maplibregl.Marker({ element: h('div', { class: 'origin-dot' }) }).setLngLat([lng, lat]).addTo(this.map);
    });
  }
  setTrack(points) {
    this.track = points;
    this.when(() => {
      const coords = (points || []).map((p) => [p[1], p[0]]);
      this.map.getSource('track')?.setData(coords.length > 1 ? { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} } : { type: 'FeatureCollection', features: [] });
    });
  }
}

/** Small static route thumbnail (no tiles): grid of streets + the route line + pin, like Figma's bento thumbnail. */
export function routeThumb(points, { w = 200, hgt = 96 } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag, a) => { const e = document.createElementNS(NS, tag); Object.entries(a).forEach(([k, v]) => e.setAttribute(k, v)); svg.append(e); return e; };
  add('rect', { width: w, height: hgt, fill: 'var(--surface-container-high)' });
  for (let x = 28; x < w; x += 52) add('line', { x1: x, y1: 0, x2: x + 6, y2: hgt, stroke: 'var(--surface-container-lowest)', 'stroke-width': 5 });
  for (let y = 22; y < hgt; y += 38) add('line', { x1: 0, y1: y + 3, x2: w, y2: y, stroke: 'var(--surface-container-lowest)', 'stroke-width': 5 });
  let pts = (points || []).map((p) => [p[1], p[0]]);
  if (pts.length < 2) pts = [[0, 0], [0, 1]];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 16, sx = (w - 2 * pad) / (maxX - minX || 1e-9), sy = (hgt - 2 * pad) / (maxY - minY || 1e-9), s = Math.min(sx, sy);
  const ox = (w - (maxX - minX) * s) / 2, oy = (hgt - (maxY - minY) * s) / 2;
  const P = pts.map(([x, y]) => [ox + (x - minX) * s, hgt - (oy + (y - minY) * s)]);
  add('polyline', { points: P.map((p) => p.join(',')).join(' '), fill: 'none', stroke: 'var(--primary)', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  const end = P[P.length - 1];
  add('circle', { cx: end[0], cy: end[1] - 9, r: 7, fill: '#fff', stroke: '#c4161c', 'stroke-width': 3 });
  add('circle', { cx: end[0], cy: end[1] - 9, r: 2, fill: '#c4161c' });
  return svg;
}

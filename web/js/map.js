import { h, initials } from './util.js';

const STYLES = {
  light: ['https://tiles.openfreemap.org/styles/liberty'],
  dark: ['https://tiles.openfreemap.org/styles/dark', 'https://tiles.openfreemap.org/styles/liberty'],
};
const DEFAULT_CENTER = [73.8567, 18.5204]; // Pune; replaced by the rider's location as soon as we have it

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.maplibregl) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('map library failed to load'));
    document.head.append(s);
  });
}

async function fetchStyle(urls) {
  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) return { style: await r.json(), ok: true };
    } catch { /* try next */ }
  }
  return { style: null, ok: false };
}

function blankStyle(dark) {
  return {
    version: 8, sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': dark ? '#232B36' : '#E9EDF0' } }],
  };
}

export class RideMap {
  constructor(el, { onBanner } = {}) {
    this.el = el;
    this.onBanner = onBanner || (() => {});
    this.map = null;
    this.ready = false;
    this.riders = new Map(); // userId -> {marker, el, data}
    this.me = null;
    this.follow = true;
    this.pending = [];
    this.dark = false;
  }

  async init(dark) {
    this.dark = dark;
    try {
      await loadScript('/vendor/maplibre/maplibre-gl.js');
    } catch {
      return this.fail();
    }
    const { style, ok } = await fetchStyle(dark ? STYLES.dark : STYLES.light);
    if (!ok) this.onBanner('Map tiles couldn’t load. Riders and routes still show; the map fills in when you’re back online.');
    try {
      this.map = new window.maplibregl.Map({
        container: this.el, style: style || blankStyle(dark), center: DEFAULT_CENTER, zoom: 12,
        attributionControl: { compact: true }, pitchWithRotate: false, dragRotate: false, fadeDuration: 150,
      });
    } catch {
      return this.fail();
    }
    this.map.touchZoomRotate.disableRotation();
    this.map.on('dragstart', () => { this.follow = false; this.el.dispatchEvent(new CustomEvent('follow', { detail: false })); });
    this.map.on('error', () => { /* tile errors are non-fatal; keep riding */ });
    await new Promise((r) => (this.map.loaded() ? r() : this.map.once('load', r)));
    this.addRouteLayers();
    this.ready = true;
    this.pending.splice(0).forEach((fn) => fn());
    return true;
  }

  fail() {
    document.getElementById('map-fallback').hidden = false;
    this.ready = false;
    return false;
  }

  whenReady(fn) { this.ready ? fn() : this.pending.push(fn); }

  async setTheme(dark) {
    if (!this.map || dark === this.dark) return;
    this.dark = dark;
    const { style } = await fetchStyle(dark ? STYLES.dark : STYLES.light);
    this.map.setStyle(style || blankStyle(dark));
    this.map.once('styledata', () => this.addRouteLayers(true));
  }

  addRouteLayers(restore = false) {
    const m = this.map;
    const empty = { type: 'FeatureCollection', features: [] };
    for (const id of ['route', 'track']) if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: empty });
    if (!m.getLayer('route-casing')) m.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1A222C', 'line-width': 10, 'line-opacity': .5 } });
    if (!m.getLayer('route')) m.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#2FC9C3', 'line-width': 6 } });
    if (!m.getLayer('track')) m.addLayer({ id: 'track', type: 'line', source: 'track', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#F98924', 'line-width': 5 } });
    if (restore) { this.setRoute(this.routeGeo); this.setTrack(this.trackPts); }
  }

  riderEl(data, isMe) {
    const el = h('div', { class: `rider${isMe ? ' me' : ''}` },
      h('div', { class: 'rider-head', hidden: data.heading === null || data.heading === undefined }),
      h('div', { class: 'rider-dot', style: `background:${data.color || '#2FC9C3'}` }, initials(data.name)),
      isMe ? null : h('div', { class: 'rider-name' }, data.name));
    return el;
  }

  upsertRider(data, isMe = false) {
    this.whenReady(() => {
      const key = isMe ? '__me' : data.userId;
      let r = this.riders.get(key);
      if (!r) {
        const el = this.riderEl(data, isMe);
        const marker = new window.maplibregl.Marker({ element: el }).setLngLat([data.lng, data.lat]).addTo(this.map);
        r = { marker, el, data };
        this.riders.set(key, r);
        if (!isMe) el.addEventListener('click', () => this.map.easeTo({ center: [data.lng, data.lat], zoom: 15 }));
      }
      r.data = { ...r.data, ...data };
      r.marker.setLngLat([data.lng, data.lat]);
      const head = r.el.querySelector('.rider-head');
      const hasHeading = Number.isFinite(data.heading) && (data.speed ?? 0) > 1;
      head.hidden = !hasHeading;
      if (hasHeading) head.style.transform = `rotate(${data.heading}deg)`;
      const dot = r.el.querySelector('.rider-dot');
      dot.style.background = data.color || dot.style.background;
      if (!isMe) { dot.textContent = initials(data.name); r.el.querySelector('.rider-name').textContent = data.name; }
      r.el.classList.remove('stale');
      if (isMe && this.follow) this.map.easeTo({ center: [data.lng, data.lat], duration: 600 });
    });
  }

  markStale(maxAgeMs) {
    const now = Date.now();
    for (const [k, r] of this.riders) if (k !== '__me') r.el.classList.toggle('stale', now - (r.data.ts || 0) > maxAgeMs);
  }
  setSos(userId, on) { const r = this.riders.get(userId); if (r) r.el.classList.toggle('sos', on); }
  removeRider(userId) { const r = this.riders.get(userId); if (r) { r.marker.remove(); this.riders.delete(userId); } }
  clearRiders() { for (const [k, r] of this.riders) if (k !== '__me') { r.marker.remove(); this.riders.delete(k); } }

  centerOn(lng, lat, zoom = 15) { this.whenReady(() => this.map.easeTo({ center: [lng, lat], zoom })); }
  setFollow(on) { this.follow = on; }

  fitRiders() {
    this.whenReady(() => {
      const pts = [...this.riders.values()].map((r) => [r.data.lng, r.data.lat]);
      if (this.destPt) pts.push(this.destPt);
      if (!pts.length) return false;
      if (pts.length === 1) return this.map.easeTo({ center: pts[0], zoom: 14 });
      const b = new window.maplibregl.LngLatBounds(pts[0], pts[0]);
      pts.forEach((p) => b.extend(p));
      this.map.fitBounds(b, { padding: { top: 120, bottom: 260, left: 60, right: 60 }, maxZoom: 15, duration: 700 });
    });
  }

  setRoute(geo) {
    this.routeGeo = geo || null;
    this.whenReady(() => {
      this.map.getSource('route')?.setData(geo ? { type: 'Feature', geometry: geo, properties: {} } : { type: 'FeatureCollection', features: [] });
      if (geo) {
        const c = geo.coordinates;
        const b = new window.maplibregl.LngLatBounds(c[0], c[0]);
        c.forEach((p) => b.extend(p));
        this.map.fitBounds(b, { padding: { top: 160, bottom: 280, left: 50, right: 50 }, duration: 800 });
      }
    });
  }

  setDestination(lng, lat) {
    this.whenReady(() => {
      this.dest?.remove();
      this.destPt = null;
      if (lng === null || lng === undefined) return;
      this.destPt = [lng, lat];
      this.dest = new window.maplibregl.Marker({ element: h('div', { class: 'dest-pin', title: 'Destination' }), anchor: 'bottom' }).setLngLat([lng, lat]).addTo(this.map);
    });
  }

  setTrack(points) {
    this.trackPts = points || null;
    this.whenReady(() => {
      const coords = (points || []).map((p) => [p[1], p[0]]);
      this.map.getSource('track')?.setData(coords.length > 1 ? { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} } : { type: 'FeatureCollection', features: [] });
    });
  }

  showTrack(points) {
    this.setTrack(points);
    this.whenReady(() => {
      if (!points?.length) return;
      const b = new window.maplibregl.LngLatBounds([points[0][1], points[0][0]], [points[0][1], points[0][0]]);
      points.forEach((p) => b.extend([p[1], p[0]]));
      this.map.fitBounds(b, { padding: 80, duration: 700 });
    });
  }
}

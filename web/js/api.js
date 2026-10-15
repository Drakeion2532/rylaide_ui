import { store } from './util.js';

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export const api = {
  token: store.get('token', null),

  async req(method, path, body) {
    let r;
    try {
      r = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('You’re offline. Check your connection and try again.', 0);
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401) window.dispatchEvent(new CustomEvent('rylaide:signedout'));
      throw new ApiError(data.error || `Something went wrong (${r.status}).`, r.status);
    }
    return data;
  },
  get(p) { return this.req('GET', p); },
  post(p, b = {}) { return this.req('POST', p, b); },
  put(p, b) { return this.req('PUT', p, b); },
  patch(p, b) { return this.req('PATCH', p, b); },
  del(p) { return this.req('DELETE', p); },
  setToken(t) { this.token = t; t ? store.set('token', t) : store.del('token'); },
};

/** WebSocket with automatic reconnect and re-subscribe. Emits {type: payload} via on(type, fn). */
export class Realtime {
  constructor() {
    this.handlers = {};
    this.groupId = null;
    this.ws = null;
    this.retry = 0;
    this.closedByUs = false;
    this.status = 'offline';
    window.addEventListener('online', () => this.connect());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.connect(); });
  }
  on(t, fn) { (this.handlers[t] ||= []).push(fn); }
  emit(t, m) { for (const fn of this.handlers[t] || []) fn(m); }
  setStatus(s) { if (s !== this.status) { this.status = s; this.emit('status', s); } }

  connect() {
    if (!api.token) return;
    if (this.ws && this.ws.readyState <= 1) return;
    this.closedByUs = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(api.token)}`);
    this.ws = ws;
    this.setStatus('connecting');
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('online');
      if (this.groupId) this.send({ t: 'sub', groupId: this.groupId });
    };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      this.emit(m.t, m);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.setStatus('offline');
      if (e.code === 4001) { window.dispatchEvent(new CustomEvent('rylaide:signedout')); return; }
      if (this.closedByUs) return;
      const wait = Math.min(15000, 600 * 2 ** this.retry++) + Math.random() * 400;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.connect(), wait);
    };
  }
  subscribe(groupId) {
    this.groupId = groupId;
    if (groupId) this.send({ t: 'sub', groupId });
  }
  send(m) {
    if (this.ws?.readyState === 1) { this.ws.send(JSON.stringify(m)); return true; }
    return false;
  }
  close() { this.closedByUs = true; clearTimeout(this.timer); this.ws?.close(); this.ws = null; this.setStatus('offline'); }
}

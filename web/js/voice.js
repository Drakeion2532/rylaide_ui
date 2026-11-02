// Voice building blocks: the processed mic chain (VoiceChain), clip streaming for browsers without WebCodecs
// (PushToTalk, VoicePlayer) and the Mic test. Live hands-free group voice is in livevoice.js.
//
// Send:  mic (kept warm during a group ride, so a press starts instantly and no words are clipped)
//        → high-pass 150 Hz (wind rumble) → RNNoise (AI noise removal, when Noise cancel is on)
//        → noise gate → compressor → MediaRecorder, Opus 48 kbps, streamed in 200 ms slices.
// Receive: slices are played as they arrive through Media Source Extensions (~0.4 s mouth-to-ear),
//        one rider at a time, with a short “pip” so you know someone’s talking.
import { blobToBase64, store } from './util.js';

const MAX_MS = 60000;
const MIN_MS = 400;
const SLICE_MS = 200;
const BITRATE = 48000;

export function pickMime() {
  if (!window.MediaRecorder) return null;
  for (const m of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

function constraints(deviceId, noiseSuppression = true) {
  return {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true, noiseSuppression, autoGainControl: true, channelCount: 1, sampleRate: 48000,
    },
  };
}

/** Smartwatch and fitness-band mics are never used for riding (same rule as the Android app). */
export const isWatchMic = (label = '') => /watch|\bband\b|fitbit|amazfit|galaxy fit|wear ?os|gear s|noisefit|fire-boltt|boat wave/i.test(label);

export async function getMic(deviceId = store.get('micId', ''), opts = {}) {
  const stream = await openMic(deviceId, opts);
  const label = stream.getAudioTracks()[0]?.label || '';
  if (!isWatchMic(label)) return stream;
  // The phone handed us a watch's mic (it's connected for calls): switch to the phone's or the headset's.
  const other = (await listMics()).find((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  if (!other) return stream;
  stream.getTracks().forEach((t) => t.stop());
  return openMic(other.deviceId, opts);
}

async function openMic(deviceId, { noiseSuppression = true } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use the microphone. Open Rylaide in Chrome or Safari.');
  try {
    return await navigator.mediaDevices.getUserMedia(constraints(deviceId, noiseSuppression));
  } catch (e) {
    if (deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
      store.del('micId');
      return navigator.mediaDevices.getUserMedia(constraints('', noiseSuppression));
    }
    if (e.name === 'NotAllowedError') throw new Error('Microphone is blocked. Allow it in your browser’s site settings to talk to your group.');
    if (e.name === 'NotFoundError') throw new Error('No microphone found. Connect your headset or earphones.');
    throw new Error('Couldn’t start the microphone.');
  }
}

// ---------------------------------------------------------------- noise cancellation (RNNoise in an AudioWorklet)
let rnnoiseWasm = null;
async function rnnoiseNode(ctx) {
  if (!ctx.audioWorklet) return null;
  try {
    const lib = await import('/vendor/nsup/index.js');
    rnnoiseWasm ||= await lib.loadRnnoise({ url: '/vendor/nsup/rnnoise.wasm', simdUrl: '/vendor/nsup/rnnoise_simd.wasm' });
    await ctx.audioWorklet.addModule('/vendor/nsup/rnnoise/workletProcessor.js');
    return new lib.RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: rnnoiseWasm });
  } catch (e) {
    console.warn('RNNoise unavailable, using the browser’s noise suppression only', e);
    return null;
  }
}

/** The processed microphone: one AudioContext + graph, reused for every press. */
export class VoiceChain {
  async open({ deviceId = store.get('micId', ''), noiseCancel = true } = {}) {
    if (this.stream) return this;
    this.stream = await getMic(deviceId, { noiseSuppression: true });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ sampleRate: 48000, latencyHint: 'interactive' });
    const c = this.ctx;
    this.src = c.createMediaStreamSource(this.stream);
    this.hp = c.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 150; this.hp.Q.value = 0.7; // wind and engine rumble
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 7500;                    // hiss above speech
    this.comp = c.createDynamicsCompressor();                                                                      // even out loud/quiet speech
    this.comp.threshold.value = -28; this.comp.knee.value = 12; this.comp.ratio.value = 4; this.comp.attack.value = 0.005; this.comp.release.value = 0.15;
    this.gain = c.createGain(); this.gain.gain.value = 1.4;
    this.dest = c.createMediaStreamDestination();
    this.rn = await rnnoiseNode(c);
    this.wire(noiseCancel);
    return this;
  }
  wire(noiseCancel) {
    this.noiseCancel = !!noiseCancel;
    for (const n of [this.src, this.hp, this.rn, this.lp, this.comp, this.gain]) try { n?.disconnect(); } catch { /* not connected */ }
    const chain = [this.src, this.hp, ...(this.noiseCancel && this.rn ? [this.rn] : []), this.lp, this.comp, this.gain, this.dest];
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
  }
  setNoiseCancel(on) { if (this.stream) this.wire(on); }
  get rnnoise() { return !!this.rn; }
  async resume() { if (this.ctx?.state === 'suspended') await this.ctx.resume().catch(() => {}); }
  close() {
    try { this.rn?.destroy?.(); } catch { /* ignore */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = this.ctx = this.rn = null;
  }
}

/**
 * Hold-to-talk that streams while you speak.
 * start() on press; every 200 ms onChunk({sid, seq, data, mime}) fires; stop() on release sends the last slice with end:true.
 */
export class PushToTalk {
  constructor() { this.rec = null; this.chain = new VoiceChain(); this.started = 0; this.warmUntil = 0; }
  get active() { return !!this.rec; }

  /** Open the mic ahead of time (group ride with voice on), so the first word isn’t lost. */
  async warm(opts) { this.keepWarm = true; await this.chain.open(opts); }
  cool() { this.keepWarm = false; if (!this.rec) this.chain.close(); }

  async start({ noiseSuppression = true, onChunk } = {}) {
    if (this.rec) return;
    const mime = pickMime();
    if (mime === null) throw new Error('This browser can’t record voice. Open Rylaide in Chrome or Safari.');
    clearTimeout(this.idle);
    await this.chain.open({ noiseCancel: noiseSuppression });
    this.chain.setNoiseCancel(noiseSuppression);
    await this.chain.resume();
    this.sid = Math.random().toString(36).slice(2, 10);
    this.seq = 0;
    this.onChunk = onChunk;
    this.sending = Promise.resolve();
    this.rec = new MediaRecorder(this.chain.dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: BITRATE } : undefined);
    this.mime = this.rec.mimeType || mime || 'audio/webm';
    this.rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      const seq = this.seq++, sid = this.sid, mime2 = this.mime;
      // keep slices in order even though base64 encoding is async
      this.sending = this.sending.then(async () => this.onChunk?.({ sid, seq, mime: mime2, data: await blobToBase64(e.data) }));
    };
    this.done = new Promise((r) => (this.rec.onstop = r));
    this.rec.start(SLICE_MS);
    this.started = performance.now();
    this.limit = setTimeout(() => this.onLimit?.(), MAX_MS);
  }

  /** Release. Resolves {sid, duration} when sent, or null if too short (receivers are told to drop it). */
  async stop() {
    if (!this.rec) return null;
    clearTimeout(this.limit);
    const rec = this.rec, sid = this.sid;
    const ms = performance.now() - this.started;
    if (rec.state !== 'inactive') rec.stop();
    await this.done;
    await this.sending;
    this.rec = null;
    if (!this.keepWarm) this.idle = setTimeout(() => this.chain.close(), 8000); // free the mic if not riding
    if (ms < MIN_MS) return { sid, short: true };
    return { sid, duration: ms / 1000 };
  }

  cancel() {
    clearTimeout(this.limit);
    try { this.rec?.stop(); } catch { /* already stopped */ }
    this.rec = null;
    if (!this.keepWarm) this.chain.close();
  }
}

/** Streams incoming voice: plays as slices arrive, one rider at a time, never overlapping. */
export class VoicePlayer {
  constructor({ onStart, onEnd, onBlocked } = {}) {
    this.streams = new Map(); // sid -> { from, mime, chunks: [], ended, duration }
    this.order = [];
    this.current = null;
    this.audio = new Audio();
    this.audio.setAttribute('playsinline', '');
    this.audio.preload = 'auto';
    Object.assign(this, { onStart, onEnd, onBlocked });
  }

  /** A live slice from the server. */
  chunk(m) {
    if (this.dropped?.has(m.sid)) return;
    let s = this.streams.get(m.sid);
    if (!s) {
      s = { sid: m.sid, from: m.from, mime: m.mime, chunks: [], ended: false, at: Date.now() };
      this.streams.set(m.sid, s);
      this.order.push(m.sid);
      if (this.order.length > 8) this.drop(this.order[0]);
    }
    if (m.data) s.chunks[m.seq] = m.data;
    s.last = Date.now();
    if (m.end) { s.ended = true; s.duration = m.duration; }
    if (this.current?.sid === s.sid) this.pump(); else if (!this.current) this.next();
  }
  /** Sender let go too early: forget it. */
  cancel(sid) { (this.dropped ||= new Set()).add(sid); this.drop(sid); }
  /** Older full-clip messages (and fallbacks) still play. */
  enqueue(msg) { const sid = `clip-${Math.random().toString(36).slice(2)}`; this.chunk({ sid, seq: 0, from: msg.from, mime: msg.mime, data: msg.data, end: true, duration: msg.duration }); }

  drop(sid) {
    this.streams.delete(sid);
    this.order = this.order.filter((x) => x !== sid);
    if (this.current?.sid === sid) this.finish();
  }

  next() {
    clearInterval(this.stallT);
    const sid = this.order[0];
    const s = sid && this.streams.get(sid);
    if (!s) { this.current = null; this.onEnd?.(); return; }
    this.current = s;
    s.fed = 0;
    this.pip();
    const canStream = window.MediaSource && MediaSource.isTypeSupported?.(s.mime);
    if (canStream) {
      const ms = new MediaSource();
      s.ms = ms;
      s.url = URL.createObjectURL(ms);
      this.audio.src = s.url;
      ms.addEventListener('sourceopen', () => {
        try { s.sb = ms.addSourceBuffer(s.mime); } catch { s.sb = null; return this.fallback(s); }
        s.sb.mode = 'sequence';
        s.sb.addEventListener('updateend', () => this.pump());
        this.pump();
      }, { once: true });
    } else if (s.ended) this.fallback(s);
    else s.waitWhole = true; // e.g. iOS: wait for the whole clip
    this.audio.onended = () => this.finish();
    this.audio.onerror = () => this.finish();
    this.onStart?.(s);
    this.play();
    // A sender who vanished mid-talk: stop waiting after 3 s of silence.
    this.stallT = setInterval(() => { if (this.current === s && !s.ended && Date.now() - s.last > 3000) { s.ended = true; this.pump(); } }, 1000);
  }

  pump() {
    const s = this.current;
    if (!s) return;
    if (s.waitWhole) { if (s.ended) { s.waitWhole = false; this.fallback(s); } return; }
    if (!s.sb || s.sb.updating) return;
    const data = s.chunks[s.fed];
    if (data) {
      s.fed++;
      try { s.sb.appendBuffer(base64ToBytes(data)); } catch { this.fallback(s); }
      return;
    }
    if (s.ended && s.fed >= s.chunks.length && s.ms.readyState === 'open') { try { s.ms.endOfStream(); } catch { /* closed */ } }
  }

  fallback(s) {
    const whole = new Blob(s.chunks.filter(Boolean).map((d) => base64ToBytes(d)), { type: s.mime });
    if (s.url) URL.revokeObjectURL(s.url);
    s.url = URL.createObjectURL(whole);
    s.sb = null;
    this.audio.src = s.url;
    this.play();
  }

  async play() {
    try { await this.audio.play(); } catch (e) {
      if (e?.name !== 'NotAllowedError') return;
      const s = this.current;
      this.current = null;
      this.onBlocked?.(() => { if (s && this.streams.has(s.sid)) this.next(); });
    }
  }

  finish() {
    const s = this.current;
    clearInterval(this.stallT);
    this.current = null;
    if (s) { if (s.url) URL.revokeObjectURL(s.url); this.streams.delete(s.sid); this.order = this.order.filter((x) => x !== s.sid); }
    this.audio.onended = this.audio.onerror = null;
    this.next();
  }

  /** Walkie-talkie style cue before a rider’s voice. */
  pip() {
    try {
      this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.frequency.value = 1046; g.gain.setValueAtTime(0.06, this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.09);
      o.connect(g).connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime + 0.1);
    } catch { /* no audio */ }
  }

  /** Call from any tap so later messages can auto-play (mobile browsers need one user gesture). */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    const a = this.audio;
    a.muted = true;
    a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    a.play().catch(() => {}).finally(() => { a.muted = false; });
    this.ctx?.resume?.().catch?.(() => {});
  }
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Live level meter + record/playback for the Mic test screen. Uses the same noise-cancelled chain as talking. */
export class MicTest {
  constructor({ onLevel, onStatus }) { Object.assign(this, { onLevel, onStatus }); }

  async start(deviceId) {
    this.stop();
    this.chain = new VoiceChain();
    await this.chain.open({ deviceId, noiseCancel: store.get('noiseCancel', true) });
    this.stream = this.chain.dest.stream;
    const ctx = this.chain.ctx;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.chain.gain.connect(this.analyser);
    const buf = new Float32Array(this.analyser.fftSize);
    const tick = () => {
      this.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      this.onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
      this.raf = requestAnimationFrame(tick);
    };
    tick();
    const label = this.chain.stream.getAudioTracks()[0]?.label || 'Microphone';
    this.onStatus(`Listening on “${label}”${this.chain.rnnoise && this.chain.noiseCancel ? ' with noise cancel' : ''}. Speak and watch the bar move.`);
    return label;
  }

  async record(ms = 3000) {
    if (!this.stream) throw new Error('Start the test first.');
    const mime = pickMime();
    const rec = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: BITRATE } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    rec.start();
    this.onStatus('Recording… say “Testing, one, two, three”.');
    await new Promise((r) => setTimeout(r, ms));
    rec.stop();
    await done;
    this.clip = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
    this.onStatus(this.clip.size ? 'Recorded. Tap “Play it back” to hear what your group hears.' : 'Nothing was recorded. Check the microphone and try again.');
    return this.clip.size > 0;
  }

  async play() {
    if (!this.clip) return;
    const url = URL.createObjectURL(this.clip);
    const a = new Audio(url);
    a.onended = () => { URL.revokeObjectURL(url); this.onStatus('If it sounded clear, you’re ready to ride.'); };
    await a.play();
    this.onStatus('Playing back…');
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.chain?.close();
    this.chain = this.stream = null;
    this.onLevel?.(0);
  }
}

export async function listMics() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput' && !isWatchMic(d.label));
  } catch { return []; }
}

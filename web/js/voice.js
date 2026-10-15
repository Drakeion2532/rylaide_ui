import { blobToBase64, base64ToBlob, store } from './util.js';

const MAX_MS = 60000;
const MIN_MS = 400;

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
      echoCancellation: true, noiseSuppression, autoGainControl: true, channelCount: 1,
    },
  };
}

export async function getMic(deviceId = store.get('micId', ''), { noiseSuppression = true } = {}) {
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

/** Hold-to-talk recorder. start() on press, stop() on release resolves {data, mime, duration} or null if too short. */
export class PushToTalk {
  constructor() { this.rec = null; this.stream = null; this.started = 0; }
  get active() { return !!this.rec; }

  async start(opts = {}) {
    if (this.rec) return;
    const mime = pickMime();
    if (mime === null) throw new Error('This browser can’t record voice. Open Rylaide in Chrome or Safari.');
    this.stream = await getMic(undefined, opts);
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.done = new Promise((r) => (this.rec.onstop = r));
    this.rec.start(250);
    this.started = performance.now();
    this.limit = setTimeout(() => this.onLimit?.(), MAX_MS);
  }

  async stop() {
    if (!this.rec) return null;
    clearTimeout(this.limit);
    const rec = this.rec;
    const ms = performance.now() - this.started;
    if (rec.state !== 'inactive') rec.stop();
    await this.done;
    this.stream.getTracks().forEach((t) => t.stop());
    this.rec = null;
    if (ms < MIN_MS) return null;
    const mime = rec.mimeType || 'audio/webm';
    const blob = new Blob(this.chunks, { type: mime });
    if (!blob.size) return null;
    return { data: await blobToBase64(blob), mime, duration: ms / 1000 };
  }

  cancel() {
    clearTimeout(this.limit);
    try { this.rec?.stop(); } catch { /* already stopped */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.rec = null;
  }
}

/** Plays incoming voice messages one after another, never overlapping. */
export class VoicePlayer {
  constructor({ onStart, onEnd, onBlocked } = {}) {
    this.queue = [];
    this.playing = false;
    this.audio = new Audio();
    this.audio.setAttribute('playsinline', '');
    Object.assign(this, { onStart, onEnd, onBlocked });
  }
  enqueue(msg) {
    this.queue.push(msg);
    if (this.queue.length > 10) this.queue.shift();
    if (!this.playing) this.next();
  }
  async next() {
    const msg = this.queue.shift();
    if (!msg) { this.playing = false; this.onEnd?.(); return; }
    this.playing = true;
    const url = URL.createObjectURL(base64ToBlob(msg.data, msg.mime));
    this.audio.src = url;
    this.onStart?.(msg);
    const finish = () => { URL.revokeObjectURL(url); this.audio.onended = this.audio.onerror = null; this.next(); };
    this.audio.onended = finish;
    this.audio.onerror = finish;
    try {
      await this.audio.play();
    } catch {
      // Autoplay blocked until the rider taps once; keep the message and offer a tap-to-play.
      this.queue.unshift(msg);
      this.playing = false;
      URL.revokeObjectURL(url);
      this.onBlocked?.(() => this.next());
    }
  }
  /** Call from any tap so later messages can auto-play (mobile browsers need one user gesture). */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    const a = this.audio;
    a.muted = true;
    a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    a.play().catch(() => {}).finally(() => { a.muted = false; });
  }
}

/** Live level meter + record/playback for the Mic test screen. */
export class MicTest {
  constructor({ onLevel, onStatus }) { Object.assign(this, { onLevel, onStatus }); }

  async start(deviceId) {
    this.stop();
    this.stream = await getMic(deviceId);
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    const buf = new Float32Array(this.analyser.fftSize);
    let peakSeen = 0;
    const tick = () => {
      this.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const level = Math.min(1, rms * 6);
      peakSeen = Math.max(peakSeen * 0.995, level);
      this.onLevel(level);
      this.raf = requestAnimationFrame(tick);
    };
    tick();
    const label = this.stream.getAudioTracks()[0]?.label || 'Microphone';
    this.onStatus(`Listening on “${label}”. Speak and watch the bar move.`);
    return label;
  }

  async record(ms = 3000) {
    if (!this.stream) throw new Error('Start the test first.');
    const mime = pickMime();
    const rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    rec.start();
    this.onStatus('Recording… say “Testing, one, two, three”.');
    await new Promise((r) => setTimeout(r, ms));
    rec.stop();
    await done;
    this.clip = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
    this.onStatus(this.clip.size ? 'Recorded. Tap “Play it back” to hear yourself.' : 'Nothing was recorded. Check the microphone and try again.');
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
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = this.ctx = null;
    this.onLevel?.(0);
  }
}

export async function listMics() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  } catch { return []; }
}

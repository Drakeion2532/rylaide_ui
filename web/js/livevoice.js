// Live group voice: always-on mic with a single mute toggle. No buttons to hold while riding.
//
// Send:    processed mic (VoiceChain: rumble filter → RNNoise → compressor) → 20 ms frames → voice detector
//          → Opus 24 kbps (WebCodecs) → RVP packets → server (and, in the Android app, nearby phones offline).
//          Nothing is sent while you're silent, so wind and engine noise between sentences never goes out.
// Receive: RVP packets → Opus decoder per rider → 60 ms jitter buffer → mixed, so two riders can talk at once.
//
// RVP (Rylaide Voice Packet) is the same on every link and every platform (web, Android, iPhone):
// see docs/offline-voice.md.

export const RVP = {
  VERSION: 1, HEADER: 16,
  VOICE: 1, END: 2,           // kind
  GATEWAY: 1,                 // flags bit 0: relayed between the mesh and the server by another rider
  pack({ kind = 1, sender, group, seq, ttl = 0, flags = 0, spurt = 0, payload = null }) {
    const n = payload ? payload.byteLength : 0;
    const out = new Uint8Array(16 + n);
    const v = new DataView(out.buffer);
    v.setUint8(0, 1); v.setUint8(1, kind);
    v.setUint32(2, sender >>> 0); v.setUint32(6, group >>> 0);
    v.setUint16(10, seq & 0xffff); v.setUint8(12, ttl); v.setUint8(13, flags); v.setUint16(14, spurt & 0xffff);
    if (n) out.set(payload instanceof Uint8Array ? payload : new Uint8Array(payload), 16);
    return out;
  },
  parse(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (b.length < 16 || b[0] !== 1) return null;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { kind: b[1], sender: v.getUint32(2), group: v.getUint32(6), seq: v.getUint16(10), ttl: b[12], flags: b[13], spurt: v.getUint16(14), payload: b.subarray(16), bytes: b };
  },
};

/** FNV-1a 32-bit of a UTF-8 string: the short id of a rider or group inside voice packets. */
export function fnv32(s) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(String(s))) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export const OPUS = { sampleRate: 48000, bitrate: 24000, frameMs: 20 };
const encoderConfig = (sampleRate) => ({ codec: 'opus', sampleRate, numberOfChannels: 1, bitrate: OPUS.bitrate, opus: { frameDuration: OPUS.frameMs * 1000, complexity: 7, useinbandfec: true, packetlossperc: 10 } });

export async function canEncodeOpus(sampleRate = 48000) {
  if (!window.AudioEncoder) return false;
  try { return !!(await AudioEncoder.isConfigSupported(encoderConfig(sampleRate))).supported; } catch { return false; }
}

// ---------------------------------------------------------------- voice detector
/** How loud speech must be above the background (wind, engine) before it's sent. */
export const SENSITIVITY = { low: 4.5, normal: 3.0, high: 2.0 };

export class VoiceDetector {
  constructor(sensitivity = 'normal') { this.floor = 0.004; this.on = false; this.hits = 0; this.quiet = 0; this.setSensitivity(sensitivity); }
  setSensitivity(s) { this.k = SENSITIVITY[s] || SENSITIVITY.normal; }
  /** Feed one 20 ms frame. Returns 'start' | 'end' | null, and keeps .on current. */
  frame(f) {
    let sum = 0;
    for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
    const rms = Math.sqrt(sum / f.length);
    this.level = rms;
    // Background tracker: falls fast, rises slowly; while "talking" it rises very slowly, so steady wind
    // that sneaks past the threshold is learned within ~30 s and stops being sent, but speech isn't.
    if (rms < this.floor) this.floor = this.floor * 0.8 + rms * 0.2;
    else this.floor = this.on ? this.floor * 0.9985 + rms * 0.0015 : this.floor * 0.995 + rms * 0.005;
    this.floor = Math.max(this.floor, 0.0005);
    const loud = rms > Math.max(this.floor * this.k, 0.006);
    if (!this.on) {
      this.hits = loud ? this.hits + 1 : 0;
      if (this.hits >= 2) { this.on = true; this.quiet = 0; return 'start'; } // 40 ms of speech
      return null;
    }
    this.quiet = loud ? 0 : this.quiet + 1;
    if (this.quiet >= 30) { this.on = false; this.hits = 0; return 'end'; } // 600 ms hang time keeps sentences whole
    return null;
  }
}

// ---------------------------------------------------------------- open mic
/**
 * The always-on mic. start() opens it; frames go through the detector; while you speak, Opus packets come out
 * of onPacket(bytes). onTalking(bool) drives the "you're talking" ring. stop() closes the mic completely (mute).
 * Without WebCodecs (older Safari) it reports spurts via onSpurt('start'|'end') so the caller can use clips.
 */
export class LiveMic {
  constructor({ chain, sender, group, onPacket, onTalking, onSpurt, sensitivity = 'normal' }) {
    Object.assign(this, { chain, sender, group, onPacket, onTalking, onSpurt });
    this.vad = new VoiceDetector(sensitivity);
    this.seq = Math.floor(Math.random() * 65536);
    this.spurt = 0;
    this.preroll = [];
    this.stats = { frames: 0, sent: 0, spurts: 0 };
  }
  get active() { return !!this.node; }
  setSensitivity(s) { this.vad.setSensitivity(s); }

  async start({ noiseCancel = true } = {}) {
    if (this.node) return;
    await this.chain.open({ noiseCancel });
    this.chain.setNoiseCancel(noiseCancel);
    await this.chain.resume();
    const c = this.chain.ctx;
    this.rate = c.sampleRate;
    this.opus = await canEncodeOpus(this.rate);
    if (this.opus) {
      this.encoder = new AudioEncoder({ output: (chunk) => this.out(chunk), error: (e) => console.warn('Opus encoder', e) });
      this.encoder.configure(encoderConfig(this.rate));
    }
    await c.audioWorklet.addModule('/js/rv-capture.js');
    this.node = new AudioWorkletNode(c, 'rv-capture', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' });
    this.node.port.onmessage = (e) => this.frame(e.data);
    this.chain.gain.connect(this.node);
    this.ts = 0;
  }

  frame(f) {
    this.stats.frames++;
    const edge = this.vad.frame(f);
    if (edge === 'start') {
      this.spurt = (this.spurt + 1) & 0xffff;
      this.stats.spurts++;
      this.onTalking?.(true);
      this.onSpurt?.('start');
      for (const p of this.preroll) this.encode(p); // the 100 ms before the detector fired: first syllable isn't clipped
      this.preroll = [];
    }
    if (this.vad.on) this.encode(f);
    else {
      this.preroll.push(f);
      if (this.preroll.length > 5) this.preroll.shift();
    }
    if (edge === 'end') this.endSpurt();
  }

  encode(f) {
    if (!this.encoder || this.encoder.state !== 'configured') return;
    const frames = f.length;
    const data = new AudioData({ format: 'f32', sampleRate: this.rate, numberOfFrames: frames, numberOfChannels: 1, timestamp: this.ts, data: f });
    this.ts += Math.round((frames / this.rate) * 1e6);
    this.encoder.encode(data);
    data.close();
  }

  out(chunk) {
    const payload = new Uint8Array(chunk.byteLength);
    chunk.copyTo(payload);
    this.seq = (this.seq + 1) & 0xffff;
    this.stats.sent++;
    this.onPacket?.(RVP.pack({ kind: RVP.VOICE, sender: this.sender, group: this.group, seq: this.seq, spurt: this.spurt, payload }));
  }

  async endSpurt() {
    this.onTalking?.(false);
    this.onSpurt?.('end');
    if (!this.encoder) return;
    const spurt = this.spurt;
    try { await this.encoder.flush(); } catch { return; }
    this.seq = (this.seq + 1) & 0xffff;
    this.onPacket?.(RVP.pack({ kind: RVP.END, sender: this.sender, group: this.group, seq: this.seq, spurt }));
  }

  /** Mute: the mic is released (the phone's mic indicator goes off). */
  stop() {
    if (this.vad.on) { this.vad.on = false; this.endSpurt(); }
    try { this.node?.port.close(); this.node?.disconnect(); } catch { /* gone */ }
    try { this.chain.gain.disconnect(this.node); } catch { /* not connected */ }
    this.node = null;
    try { if (this.encoder?.state === 'configured') this.encoder.close(); } catch { /* closed */ }
    this.encoder = null;
    this.preroll = [];
  }
}

// ---------------------------------------------------------------- playback
let wasmDecoderLib = null;
async function loadWasmDecoder() {
  if (wasmDecoderLib) return wasmDecoderLib;
  await new Promise((ok, bad) => { const s = document.createElement('script'); s.src = '/vendor/opusdec/opus-decoder.min.js'; s.onload = ok; s.onerror = bad; document.head.append(s); });
  wasmDecoderLib = window['opus-decoder'];
  return wasmDecoderLib;
}

const JITTER = 0.06;   // seconds of buffer per rider: smooths network bumps, adds little delay
const MAX_LAG = 0.35;  // if a rider's audio drifts this far behind, skip ahead

/**
 * Plays every rider at once (mixed), each through its own decoder and small jitter buffer.
 * onSpeakers(Set<senderHash>) fires when who's talking changes.
 */
export class LivePlayer {
  constructor({ onSpeakers, onBlocked } = {}) {
    Object.assign(this, { onSpeakers, onBlocked });
    this.riders = new Map(); // sender -> { dec, at, heard, ended }
    this.seen = new Map();   // `${sender}:${seq}:${kind}` -> time (drops duplicates from two links)
    this.speaking = new Set();
    this.stats = { packets: 0, played: 0, dupes: 0 };
    this.tick = setInterval(() => this.sweep(), 150);
  }

  get ctx() {
    if (!this._ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      this._ctx = new C({ latencyHint: 'interactive', sampleRate: 48000 });
      this.master = this._ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this._ctx.destination);
    }
    return this._ctx;
  }
  unlock() { this.ctx.resume?.().catch?.(() => {}); }

  /** One packet from any link. Returns false for duplicates. */
  packet(p) {
    if (!p) return false;
    const key = `${p.sender}:${p.seq}:${p.kind}`;
    const now = performance.now();
    if (this.seen.has(key) && now - this.seen.get(key) < 10000) { this.stats.dupes++; return false; }
    this.seen.set(key, now);
    if (this.seen.size > 3000) for (const [k, t] of this.seen) { if (now - t > 10000 || this.seen.size > 2000) this.seen.delete(k); else break; }
    this.stats.packets++;
    const r = this.rider(p.sender);
    if (p.kind === RVP.END) { r.ended = true; this.sweep(); return true; }
    if (p.kind !== RVP.VOICE || !p.payload.length) return true;
    r.heard = now; r.ended = false;
    if (!this.speaking.has(p.sender)) { this.speaking.add(p.sender); this.onSpeakers?.(new Set(this.speaking)); }
    if (this.ctx.state === 'suspended') { this.ctx.resume().catch(() => {}); if (!this.blockedTold) { this.blockedTold = true; this.onBlocked?.(() => this.unlock()); } }
    this.decode(r, p);
    return true;
  }

  rider(sender) {
    let r = this.riders.get(sender);
    if (!r) {
      r = { sender, at: 0, heard: 0, ts: 0 };
      if (window.AudioDecoder) {
        r.dec = new AudioDecoder({ output: (ad) => this.playData(r, ad), error: () => { r.dec = null; } });
        r.dec.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
      } else {
        r.wasm = loadWasmDecoder().then(async (lib) => { const d = new lib.OpusDecoder({ channels: 1 }); await d.ready; return d; }).catch(() => null);
      }
      this.riders.set(sender, r);
    }
    return r;
  }

  decode(r, p) {
    if (r.dec && r.dec.state === 'configured') {
      r.dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: (r.ts += 20000), data: p.payload }));
      return;
    }
    const bytes = p.payload.slice();
    r.wasm?.then((d) => { if (!d) return; const o = d.decodeFrame(bytes); if (o?.samplesDecoded) this.playPcm(r, o.channelData[0], o.sampleRate); });
  }

  playData(r, ad) {
    const n = ad.numberOfFrames;
    const pcm = new Float32Array(n);
    try { ad.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' }); } catch { ad.copyTo(pcm, { planeIndex: 0 }); }
    const rate = ad.sampleRate;
    ad.close();
    this.playPcm(r, pcm, rate);
  }

  playPcm(r, pcm, rate) {
    const c = this.ctx;
    const buf = c.createBuffer(1, pcm.length, rate);
    buf.copyToChannel(pcm, 0);
    const now = c.currentTime;
    if (r.at < now + 0.005 || r.at > now + MAX_LAG) r.at = now + JITTER; // start of a sentence, a gap, or drift
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(this.master);
    src.start(r.at);
    r.at += buf.duration;
    this.stats.played++;
  }

  sweep() {
    const now = performance.now();
    let changed = false;
    for (const s of this.speaking) {
      const r = this.riders.get(s);
      if (!r || r.ended || now - r.heard > 400) { this.speaking.delete(s); changed = true; }
    }
    if (changed) this.onSpeakers?.(new Set(this.speaking));
    for (const [s, r] of this.riders) if (now - r.heard > 120000 && !this.speaking.has(s)) { try { r.dec?.close(); } catch { /* closed */ } this.riders.delete(s); }
  }

  setVolume(v) { this.ctx; this.master.gain.value = v; }
  /** Drop everyone (voice chat turned off, group changed). */
  reset() {
    for (const r of this.riders.values()) try { r.dec?.close(); } catch { /* closed */ }
    this.riders.clear();
    if (this.speaking.size) { this.speaking.clear(); this.onSpeakers?.(new Set()); }
  }
}

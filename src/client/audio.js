// ============================================================================
//  AUDIO — synthesized SFX + push-to-talk VOIP.
//  Voice: mic → 16 kHz Int16 PCM frames → host. The HOST computes per-listener
//  gain (3D proximity + wall occlusion + intercom pipes during Work; global in
//  ceremonies; muted/gagged speakers are dropped) and forwards frames.
//  Toxic-fumes speakers arrive flagged and are played back garbled.
// ============================================================================
export class Audio {
  constructor() { this.ctx = null; this.mic = null; this.ptt = false; this.next = new Map(); this.onFrame = null; this.level = 0; }

  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.6; this.master.connect(this.ctx.destination);
      this.drive = this.ctx.createWaveShaper();
      const c = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; c[i] = Math.tanh(x * 4); } this.drive.curve = c;
      this.drive.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  // ---------------------------------------------------------------- SFX
  tone(freq, dur = 0.3, type = 'sine', vol = 0.3, slide = 0) {
    const ctx = this.ensure(), t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur = 0.4, vol = 0.2, hp = 800) {
    const ctx = this.ensure(), t = ctx.currentTime;
    const b = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = ctx.createBufferSource(); s.buffer = b;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const g = ctx.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  }
  sfx(name, d = {}) {
    if (!this.ctx) return;
    switch (name) {
      case 'gong': this.tone(98, 2.5, 'sine', 0.5); this.tone(147, 2.0, 'triangle', 0.2); this.tone(220, 1.2, 'sine', 0.1); break;
      case 'chime': [880, 1320, 1760].forEach((f, i) => setTimeout(() => this.tone(f, 0.8, 'sine', 0.18), i * 90)); break;
      case 'bell': this.tone([392, 494, 587][d.tone || 0], 1.0, 'triangle', 0.35); break;
      case 'slap': this.noise(0.12, 0.5, 1500); break;
      case 'ouch': this.tone(520, 0.25, 'square', 0.08, 0.5); break;
      case 'steam': this.noise(1.2, 0.25, 2500); break;
      case 'steam_warn': this.noise(0.8, 0.06, 4000); break;
      case 'taskdone': [660, 880, 1100].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, 'triangle', 0.2), i * 70)); break;
      case 'taskstep': this.tone(740, 0.12, 'triangle', 0.12); break;
      case 'coins': [1200, 1500].forEach((f, i) => setTimeout(() => this.tone(f, 0.15, 'square', 0.06), i * 60)); break;
      case 'portal_burst': this.tone(60, 1.6, 'sawtooth', 0.25, 0.3); this.noise(1.2, 0.2, 200); break;
      case 'shockwave': case 'explosion': this.tone(50, 1.5, 'sawtooth', 0.4, 0.3); this.noise(1.5, 0.4, 100); break;
      case 'rebellion': this.tone(220, 0.6, 'sawtooth', 0.2, 1.5); break;
      case 'milestone': this.sfx('gong'); break;
      case 'tick': this.tone(1000, 0.04, 'square', 0.05); break;
      case 'holdtick': this.tone(520, 0.03, 'triangle', 0.04); break;
      case 'holddone': this.tone(880, 0.12, 'triangle', 0.18); setTimeout(() => this.tone(1320, 0.22, 'triangle', 0.16), 90); break;
      case 'appoint': [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => { this.tone(f, 0.5, 'triangle', 0.2); this.tone(f * 1.5, 0.4, 'sine', 0.06); }, i * 110)); setTimeout(() => this.tone(1047, 1.4, 'sine', 0.18), 480); break;
      case 'buzz': this.tone(110, 0.45, 'sawtooth', 0.25); this.tone(116, 0.45, 'square', 0.12); break;
      case 'cancel': this.tone(300, 0.22, 'square', 0.1, 0.5); break;
      case 'fumes': this.noise(2, 0.15, 300); break;
      case 'clank': this.tone(180, 0.2, 'square', 0.15, 0.6); break;
      case 'puff': this.noise(0.25, 0.15, 600); break;
      default: break;
    }
  }

  /**
   * Escalating countdown cue for the last 5 seconds of a timed window.
   * 5 → 1: a tick that gets higher and louder each second (double tick at 2, triple at 1, plus a
   * low heartbeat under the last three). 0: deep "time's up" thud.
   */
  countdown(n) {
    if (!this.ctx) return;
    if (n <= 0) { this.tone(196, 0.55, 'sawtooth', 0.2, 0.45); this.tone(78, 0.8, 'sine', 0.34); return; }
    const k = 5 - Math.min(5, n);                      // 0 … 4
    const f = 520 + k * 140, v = 0.07 + k * 0.035;
    this.tone(f, 0.07, 'square', v);
    if (n <= 3) this.tone(66, 0.16, 'sine', 0.22 + (3 - n) * 0.06);
    if (n <= 2) setTimeout(() => this.tone(f * 1.25, 0.06, 'square', v * 0.9), 130);
    if (n <= 1) setTimeout(() => this.tone(f * 1.5, 0.06, 'square', v * 0.9), 260);
  }

  // ---------------------------------------------------------------- voice
  async startMic() {
    if (this.mic) return true;
    try {
      const ctx = this.ensure();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(2048, 1, 1);
      const ratio = ctx.sampleRate / 16000;
      proc.onaudioprocess = e => {
        const inp = e.inputBuffer.getChannelData(0);
        let lvl = 0; for (let i = 0; i < inp.length; i += 16) lvl = Math.max(lvl, Math.abs(inp[i]));
        this.level = lvl;
        if (!this.ptt || !this.onFrame) return;
        const n = Math.floor(inp.length / ratio), out = new Int16Array(n);
        for (let i = 0; i < n; i++) { const v = inp[Math.floor(i * ratio)]; out[i] = Math.max(-1, Math.min(1, v)) * 32767; }
        this.onFrame(out.buffer);
      };
      const mute = ctx.createGain(); mute.gain.value = 0;
      src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
      this.mic = { stream, proc };
      return true;
    } catch (e) { console.warn('mic unavailable', e); return false; }
  }

  playVoice(buf) {
    const ctx = this.ensure();
    const u8 = new Uint8Array(buf);
    const sid = u8[0], gain = u8[1] / 255, flags = u8[2];
    const pcm = new Int16Array(buf.slice(3));
    if (!pcm.length) return;
    const ab = ctx.createBuffer(1, pcm.length, 16000), ch = ab.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const s = ctx.createBufferSource(); s.buffer = ab;
    const g = ctx.createGain(); g.gain.value = gain * 1.4;
    if (flags & 1) { s.playbackRate.value = 0.75 + Math.random() * 0.6; s.connect(g); g.connect(this.drive); }  // garbled (Toxic Fumes)
    else if (flags & 2) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 1.2; s.connect(f); f.connect(g); g.connect(this.master); } // tinny intercom pipe
    else { s.connect(g); g.connect(this.master); }
    const t = Math.max(ctx.currentTime + 0.06, this.next.get(sid) || 0);
    s.start(t);
    this.next.set(sid, t + ab.duration / s.playbackRate.value);
  }
}

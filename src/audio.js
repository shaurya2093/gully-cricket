// All sound is synthesised with the Web Audio API, so the game ships no audio files.
export class Sound {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.ctx = null;
    this.master = null;
  }

  // Browsers only allow audio after a tap or key press: call this from one.
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, len);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch (e) { this.ctx = null; }
  }

  setEnabled(on) { this.enabled = on; }
  get ready() { return this.enabled && this.ctx && this.ctx.state === 'running'; }

  tone(freq, dur, { type = 'sine', gain = 0.3, to = null, delay = 0 } = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur, { gain = 0.3, freq = 1200, q = 1, type = 'bandpass', delay = 0, to = null } = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }

  click() { this.tone(660, 0.06, { type: 'triangle', gain: 0.15 }); }
  whoosh() { this.noise(0.16, { gain: 0.18, freq: 500, to: 1800, q: 0.8 }); }
  bounce() { this.tone(170, 0.09, { type: 'sine', gain: 0.22, to: 90 }); this.noise(0.04, { gain: 0.08, freq: 900 }); }
  thud() { this.tone(120, 0.1, { gain: 0.2, to: 60 }); }
  bat(q) {
    const g = 0.25 + q * 0.3;
    this.noise(0.05, { gain: g, freq: 1400 + q * 1400, q: 1.5 });
    this.tone(q > 0.9 ? 420 : 300, 0.09, { type: 'triangle', gain: g, to: 150 });
    if (q >= 1) this.tone(980, 0.16, { type: 'sine', gain: 0.12, delay: 0.01 });
  }
  wicket() {
    this.noise(0.22, { gain: 0.4, freq: 2600, q: 2 });
    this.tone(700, 0.12, { type: 'square', gain: 0.1, to: 200 });
    this.tone(520, 0.14, { type: 'square', gain: 0.1, to: 160, delay: 0.05 });
  }
  glass() {
    this.noise(0.5, { gain: 0.45, freq: 5200, q: 0.7, type: 'highpass' });
    for (let i = 0; i < 6; i++) this.tone(1800 + Math.random() * 2600, 0.12, { type: 'triangle', gain: 0.08, delay: i * 0.04 });
  }
  catchBall() { this.noise(0.06, { gain: 0.3, freq: 700 }); }
  cheer(big) {
    this.noise(big ? 1.4 : 0.8, { gain: big ? 0.3 : 0.2, freq: 1100, q: 0.5 });
    const notes = big ? [523, 659, 784, 1047] : [523, 659, 784];
    notes.forEach((n, i) => this.tone(n, 0.16, { type: 'triangle', gain: 0.16, delay: i * 0.09 }));
  }
  out() { [392, 330, 262].forEach((n, i) => this.tone(n, 0.22, { type: 'sawtooth', gain: 0.1, delay: i * 0.14 })); }
  run() { this.tone(520, 0.08, { type: 'triangle', gain: 0.14 }); }
  win() { [523, 659, 784, 1047, 1319].forEach((n, i) => this.tone(n, 0.22, { type: 'triangle', gain: 0.18, delay: i * 0.11 })); this.noise(1.6, { gain: 0.25, freq: 1100, q: 0.5 }); }
  lose() { [330, 294, 262, 196].forEach((n, i) => this.tone(n, 0.3, { type: 'triangle', gain: 0.14, delay: i * 0.18 })); }
  pop() { this.noise(0.35, { gain: 0.16, freq: 900, q: 0.6, to: 300 }); this.tone(140, 0.12, { gain: 0.14, to: 60 }); }
  coin() { this.tone(988, 0.07, { type: 'square', gain: 0.08 }); this.tone(1319, 0.14, { type: 'square', gain: 0.08, delay: 0.07 }); }
}

/**
 * Sound of 筊 on a granite floor, synthesised from the physics.
 *
 * Every contact impulse reported by Rapier becomes a modal-synthesis "clack":
 * a short broadband contact click + the block's own resonant modes (small
 * hardwood block: strongly damped partials in the 1.5-8 kHz range) + a faint
 * low thump from the stone. Loudness and brightness follow the impact speed,
 * so a hard first landing cracks while the last rocking taps are soft "tok"s.
 * A convolution reverb built for a stone-and-timber hall glues it together.
 */

const MODE_RATIOS = [1, 1.52, 2.21, 2.97, 3.9, 5.1];
const MODE_AMPS = [1, 0.8, 0.55, 0.42, 0.26, 0.16];
const MODE_TAUS = [0.05, 0.038, 0.028, 0.02, 0.014, 0.009]; // seconds

export class TempleAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.voices = 0;
    this.slide = [];
  }

  /**
   * Build the audio graph early (during loading): creating the first AudioContext costs
   * ~150 ms on some machines, which would otherwise stall the first throw. Browsers keep it
   * suspended until start() resumes it inside a user gesture.
   */
  prepare() {
    if (this.ctx) return;
    try {
      this.#build();
    } catch (e) {
      this.ctx = null;
    }
  }

  /** must be called from a user gesture; pass an OfflineAudioContext to render to a buffer */
  async start(offline) {
    if (!this.ctx) this.#build(offline);
    if (this.ctx && this.ctx.state === 'suspended' && !this.offline) await this.ctx.resume();
  }

  #build(offline) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC && !offline) return;
    this.offline = !!offline;
    const ctx = (this.ctx = offline || new AC({ latencyHint: 'interactive' }));
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.12;
    this.master.connect(comp).connect(ctx.destination);

    this.dry = ctx.createGain(); this.dry.gain.value = 1;
    this.wetSend = ctx.createGain(); this.wetSend.gain.value = 0.34;
    const verb = ctx.createConvolver();
    verb.buffer = this.#hallIR(2.1);
    const verbTone = ctx.createBiquadFilter(); verbTone.type = 'lowpass'; verbTone.frequency.value = 5200;
    this.dry.connect(this.master);
    this.wetSend.connect(verb).connect(verbTone).connect(this.master);

    this.noise = this.#noiseBuffer(1.5);
    this.#roomTone();
    this.#slideVoices();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  #noiseBuffer(sec) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  /** Stereo impulse response: sparse early reflections off pillars/walls, then a dense tail
   * whose high end dies faster (timber ceiling, incense haze, people). */
  #hallIR(sec) {
    const ctx = this.ctx, sr = ctx.sampleRate, n = Math.floor(sr * sec);
    const ir = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.exp(-t / 0.42) * (t < 0.012 ? t / 0.012 : 1);
        const k = 0.18 + 0.75 * Math.min(1, t / 1.2); // progressively darker
        lp += (Math.random() * 2 - 1 - lp) * (1 - k);
        d[i] = lp * env * 0.9;
      }
      const taps = [0.011, 0.019, 0.027, 0.034, 0.043, 0.057, 0.071, 0.089];
      taps.forEach((tt, j) => {
        const i = Math.floor((tt + (ch ? 0.0023 * j : 0)) * sr);
        if (i < n) d[i] += (j % 2 ? -1 : 1) * 0.55 * Math.exp(-tt / 0.06);
      });
    }
    return ir;
  }

  /** barely audible hall ambience so silence between throws doesn't feel dead */
  #roomTone() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 0.3;
    const g = ctx.createGain(); g.gain.value = 0.006;
    src.connect(lp).connect(g).connect(this.master);
    src.start();
  }

  #slideVoices() {
    const ctx = this.ctx;
    for (let i = 0; i < 2; i++) {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      src.playbackRate.value = 0.8 + 0.1 * i;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.9;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 700;
      const g = ctx.createGain(); g.gain.value = 0;
      const pan = ctx.createStereoPanner();
      src.connect(bp).connect(hp).connect(g).connect(pan);
      pan.connect(this.dry); pan.connect(this.wetSend);
      src.start();
      this.slide.push({ g, bp, pan });
    }
  }

  /**
   * @param speed impact speed (m/s) derived from the contact impulse
   * @param kind 'floor' | 'block' | 'wood' (table, stool)
   * @param pan  -1..1
   * @param block 0 | 1 (each block has slightly different modes)
   * @param dist metres from the listener
   */
  impact(speed, kind = 'floor', pan = 0, block = 0, dist = 1.2, at = null) {
    const ctx = this.ctx;
    this.onEvent?.(['impact', speed, kind, pan, block, dist]);
    if (!ctx || !this.enabled || (this.voices > 24 && !this.offline) || !Number.isFinite(speed) || !Number.isFinite(dist)) return;
    // perceptual loudness: the landing (Δv ≈ 5-6 m/s incl. rebound) is loud, rocking taps (0.1 m/s) faint
    const s = Math.min(1, Math.pow(speed / 6, 0.62));
    if (s < 0.03) return;
    const t = (at ?? ctx.currentTime) + 0.002;
    const gain = s * (1.0 / Math.max(0.7, dist));
    const out = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-0.9, Math.min(0.9, pan));
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400 + 12000 * s; // soft taps are duller
    out.connect(tone).connect(p);
    p.connect(this.dry); p.connect(this.wetSend);
    out.gain.value = gain * (kind === 'block' ? 0.75 : 1);
    this.voices++;
    let end = t;

    // contact click (broadband, a few ms)
    const click = ctx.createBufferSource();
    click.buffer = this.noise;
    const cf = ctx.createBiquadFilter(); cf.type = 'bandpass';
    cf.frequency.value = kind === 'block' ? 5200 : 3600 + 1500 * Math.random(); cf.Q.value = 0.7;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, t);
    cg.gain.linearRampToValueAtTime(0.55, t + 0.0006);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.012 + 0.01 * s);
    click.connect(cf).connect(cg).connect(out);
    click.start(t, Math.random() * 1.2, 0.05);
    end = Math.max(end, t + 0.05);

    // resonant modes of the block (the strike position changes the mix every hit)
    const f0 = (block ? 1790 : 1680) * (kind === 'block' ? 1.08 : 1) * (0.97 + 0.06 * Math.random());
    const nModes = kind === 'block' ? 6 : 5;
    for (let m = 0; m < nModes; m++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f0 * MODE_RATIOS[m] * (0.985 + 0.03 * Math.random());
      const g = ctx.createGain();
      const a = MODE_AMPS[m] * (0.35 + 0.65 * Math.random()) * 0.2 * (m > 2 ? 0.4 + s : 1);
      const tau = MODE_TAUS[m] * (kind === 'block' ? 0.8 : 1) * (0.8 + 0.4 * Math.random());
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.0008);
      g.gain.exponentialRampToValueAtTime(0.0005, t + tau * 7);
      osc.connect(g).connect(out);
      osc.start(t); osc.stop(t + tau * 7 + 0.01);
      end = Math.max(end, t + tau * 7);
    }

    // the stone answers with a dull knock on firm hits
    if (kind !== 'block' && s > 0.08) {
      const th = ctx.createOscillator(); th.type = 'sine';
      th.frequency.setValueAtTime(260 + 60 * Math.random(), t);
      th.frequency.exponentialRampToValueAtTime(150, t + 0.03);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0, t);
      tg.gain.linearRampToValueAtTime(0.35 * s, t + 0.001);
      tg.gain.exponentialRampToValueAtTime(0.0005, t + 0.045);
      th.connect(tg).connect(out);
      th.start(t); th.stop(t + 0.06);
    }
    if (this.offline) this.voices--;
    else setTimeout(() => { this.voices--; out.disconnect(); }, (end - ctx.currentTime + 0.2) * 1000);
  }

  /** continuous scrape while a block slides on the stone */
  setSlide(i, speed, pan, at = null) {
    this.onEvent?.(['slide', i, speed, pan]);
    const v = this.slide[i];
    if (!v || !Number.isFinite(speed) || !Number.isFinite(pan)) return;
    const t = at ?? this.ctx.currentTime;
    const g = speed > 0.03 ? Math.min(0.07, Math.pow(speed / 1.2, 1.3) * 0.07) : 0;
    v.g.gain.setTargetAtTime(this.enabled ? g : 0, t, 0.015);
    v.bp.frequency.setTargetAtTime(1500 + 2500 * Math.min(1, speed), t, 0.03);
    v.pan.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, pan)), t, 0.05);
  }

  /** soft bronze bowl (磬) when the answer is revealed */
  chime(kind = 'sheng', delay = 0, at = null) {
    const ctx = this.ctx;
    this.onEvent?.(['chime', kind, delay]);
    if (!ctx || !this.enabled) return;
    const t = (at ?? ctx.currentTime) + 0.02 + delay;
    const f0 = kind === 'sheng' ? 523.3 : kind === 'li' ? 659.3 : 440;
    const partials = [[1, 1, 3.2], [2.71, 0.45, 1.6], [5.13, 0.22, 0.8], [8.3, 0.08, 0.4]];
    const out = ctx.createGain(); out.gain.value = 0.12;
    out.connect(this.dry); out.connect(this.wetSend);
    for (const [r, a, tau] of partials) {
      for (const det of [-0.6, 0.6]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f0 * r + det * r;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(a * 0.5, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0003, t + tau * 3);
        o.connect(g).connect(out); o.start(t); o.stop(t + tau * 3 + 0.05);
      }
    }
    // the mallet
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1.2;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.25, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    n.connect(bp).connect(ng).connect(out); n.start(t, 0.1, 0.05);
  }

  /** the rustle of the blocks being cupped in the hands before a throw */
  pickup(at = null) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    for (let k = 0; k < 2; k++) {
      const dt = (40 + k * 70 + Math.random() * 30) / 1000;
      if (at != null) this.impact(0.25 + 0.15 * Math.random(), 'block', 0, k, 0.6, at + dt);
      else setTimeout(() => this.impact(0.25 + 0.15 * Math.random(), 'block', 0, k, 0.6), dt * 1000);
    }
  }
}

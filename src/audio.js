/**
 * Sound of 筊 on a granite floor, synthesised from the physics.
 *
 * Every contact impulse reported by Rapier becomes a short wooden "tak".
 * Matched against phone recordings of real blocks thrown on temple stone:
 * the hit is a bright, noisy clack (most energy 2-8 kHz, peak ~4-5 kHz) that
 * dies within a few milliseconds; the only long tail is the hall's reverb.
 * So the voice is a broadband contact-noise burst plus the block's bending
 * modes, which sit high (a thick 11 cm wooden crescent) but are damped out in
 * 2-6 ms by the wood. (Long-ringing pure partials are what make an impact
 * read as glass.) Loudness and brightness follow the impact speed, so a hard
 * first landing cracks while the last rocking taps are soft, dull "tok"s.
 * A convolution reverb built for a stone-and-timber hall glues it together.
 */

// block modes: [Hz, amplitude, decay time constant (s)]
const MODES = [[1250, 0.35, 0.006], [2750, 0.8, 0.0045], [4300, 1, 0.0035], [5900, 0.7, 0.0028], [7700, 0.4, 0.002]];

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
    this.wetSend = ctx.createGain(); this.wetSend.gain.value = 1.2;
    const verb = ctx.createConvolver();
    verb.buffer = this.#hallIR(1.6);
    const verbTone = ctx.createBiquadFilter(); verbTone.type = 'lowpass'; verbTone.frequency.value = 8000;
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
   * whose high end dies a little faster (timber ceiling, incense haze, people). The decay
   * (RT60 ~1.3 s) and brightness match phone recordings of blocks thrown in a temple hall. */
  #hallIR(sec) {
    const ctx = this.ctx, sr = ctx.sampleRate, n = Math.floor(sr * sec);
    const ir = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.exp(-t / 0.19) * (t < 0.012 ? t / 0.012 : 1);
        const k = 0.05 + 0.45 * Math.min(1, t / 1.2); // progressively darker
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
    const s = Math.min(1, Math.pow(speed / 6, 0.5));
    if (s < 0.03) return;
    const t = (at ?? ctx.currentTime) + 0.002;
    const gain = s * (1.0 / Math.max(0.7, dist));
    const out = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-0.9, Math.min(0.9, pan));
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200 + 11000 * s; // soft taps are duller
    out.connect(tone).connect(p);
    p.connect(this.dry); p.connect(this.wetSend);
    out.gain.value = gain * (kind === 'block' ? 0.8 : 1.35);
    this.voices++;
    let end = t;

    // contact noise: the "clack" itself. Real hits rise ~8 dB/octave from 300 Hz to a broad peak
    // at 4-6 kHz, so the noise is shaped by a gentle high-pass + low-pass rather than a narrow band.
    // A quieter, longer copy is the rattle of the block settling after the strike.
    const fc = (kind === 'block' ? 2200 : kind === 'wood' ? 900 : 1800) * (0.85 + 0.3 * Math.random());
    for (const [level, tau] of [[1, 0.0018 + 0.0014 * s], [0.2, 0.012 + 0.01 * s]]) {
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = fc; hp.Q.value = 0.5;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000; lp.Q.value = 0.5;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(level, t + 0.0003);
      ng.gain.exponentialRampToValueAtTime(0.0005, t + tau * 7);
      n.connect(hp).connect(lp).connect(ng).connect(out);
      n.start(t, Math.random() * 1.2, tau * 7 + 0.01);
      end = Math.max(end, t + tau * 7);
    }

    // bending modes of the block: high but heavily damped (the strike position changes the mix every hit);
    // 'block' = the two blocks knocking together, 'wood' = the offering table / stool (larger, hollower)
    const fScale = (block ? 1.06 : 1) * (kind === 'block' ? 1.1 : kind === 'wood' ? 0.6 : 1);
    const tauScale = kind === 'wood' ? 1.8 : 1;
    for (const [f, amp, tau0] of MODES) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * fScale * (0.95 + 0.1 * Math.random());
      const g = ctx.createGain();
      const a = amp * (0.3 + 0.7 * Math.random()) * 0.1;
      const tau = tau0 * tauScale * (0.8 + 0.4 * Math.random());
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.0004);
      g.gain.exponentialRampToValueAtTime(0.0005, t + tau * 7);
      osc.connect(g).connect(out);
      osc.start(t); osc.stop(t + tau * 7 + 0.01);
      end = Math.max(end, t + tau * 7);
    }

    // a faint low knock from the stone on firm hits
    if (kind !== 'block' && s > 0.1) {
      const th = ctx.createOscillator(); th.type = 'sine';
      th.frequency.setValueAtTime(240 + 60 * Math.random(), t);
      th.frequency.exponentialRampToValueAtTime(150, t + 0.02);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0, t);
      tg.gain.linearRampToValueAtTime(0.04 * s, t + 0.001);
      tg.gain.exponentialRampToValueAtTime(0.0005, t + 0.03);
      th.connect(tg).connect(out);
      th.start(t); th.stop(t + 0.04);
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

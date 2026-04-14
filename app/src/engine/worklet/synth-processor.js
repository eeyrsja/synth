/**
 * synth-processor.js — AudioWorkletProcessor for WaveCraft synthesis.
 *
 * Runs on the audio rendering thread. Receives messages from the main
 * thread for note events, parameter changes, and equation updates.
 *
 * Output: stereo (2 channels), 128-sample render quantum.
 */

/* global currentTime, sampleRate, registerProcessor, AudioWorkletProcessor */

const MAX_VOICES = 16;

class SynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // ── Voice state ──────────────────────────────────────────────────
    /** @type {Map<number, Voice>} */
    this.voices = new Map();

    // ── Parameters (smoothed) ────────────────────────────────────────
    this.params = { a: 1, b: 0, c: 0, d: 0 };
    this.targetParams = { a: 1, b: 0, c: 0, d: 0 };
    this.smoothCoeff = 0.999;

    // ── Scale factors ────────────────────────────────────────────────
    this.scale = { x: 1, y: 1 };

    // ── ADSR ─────────────────────────────────────────────────────────
    this.adsr = { attack: 0.012, decay: 0.18, sustain: 0.78, release: 0.22 };

    // ── Equation evaluator ───────────────────────────────────────────
    // Will be set from transpiled JS function body via message
    this.evalFn = null;
    this._scope = { x: 0, t: 0, freq: 0, note: 0, velocity: 0, a: 0, b: 0, c: 0, d: 0 };
    this._setDefaultEquation();

    // ── Drawn wavetable ──────────────────────────────────────────────
    this.drawnWave = null;

    // ── MessagePort listener ─────────────────────────────────────────
    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  _setDefaultEquation() {
    try {
      // Default: sin(x)
      this.evalFn = new Function(
        "scope",
        `const {x, t, freq, note, velocity, a, b, c, d} = scope;
         const pi = Math.PI, e = Math.E;
         const raw = Math.sin(x);
         return Number.isFinite(raw) ? raw : 0;`
      );
    } catch {
      this.evalFn = null;
    }
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case "noteOn":
        this._noteOn(msg.note, msg.velocity);
        break;
      case "noteOff":
        this._noteOff(msg.note);
        break;
      case "panic":
        this.voices.clear();
        break;
      case "params":
        this.targetParams.a = msg.a;
        this.targetParams.b = msg.b;
        this.targetParams.c = msg.c;
        this.targetParams.d = msg.d;
        break;
      case "scale":
        this.scale.x = msg.x;
        this.scale.y = msg.y;
        break;
      case "adsr":
        this.adsr.attack = msg.attack;
        this.adsr.decay = msg.decay;
        this.adsr.sustain = msg.sustain;
        this.adsr.release = msg.release;
        break;
      case "equation":
        this._updateEquation(msg.body);
        break;
      case "drawnWave":
        this.drawnWave = msg.wave ? new Float32Array(msg.wave) : null;
        break;
    }
  }

  _updateEquation(body) {
    if (!body) {
      this._setDefaultEquation();
      return;
    }
    try {
      this.evalFn = new Function("scope", body);
    } catch {
      this._setDefaultEquation();
    }
  }

  _noteOn(note, velocity) {
    const existing = this.voices.get(note);
    if (existing) {
      existing.velocity = velocity;
      existing.currentVelocity = velocity;
      existing.stage = "attack";
      existing.releaseStep = 0;
      return;
    }

    // Voice stealing if at limit
    if (this.voices.size >= MAX_VOICES) {
      this._stealVoice();
    }

    this.voices.set(note, {
      note,
      velocity,
      currentVelocity: velocity,
      freq: 440 * Math.pow(2, (note - 69) / 12),
      envGain: 0,
      stage: "attack",
      releaseStep: 0,
      phase: 0, // sample counter for phase accumulation
    });
  }

  _noteOff(note) {
    const v = this.voices.get(note);
    if (!v) return;
    v.stage = "release";
    v.releaseStep = Math.max(
      v.envGain / Math.max(1, this.adsr.release * sampleRate),
      1e-5
    );
  }

  _stealVoice() {
    // Steal voice with lowest envelope gain (prefer release stage)
    let weakest = null;
    let weakestGain = Infinity;
    for (const [key, v] of this.voices) {
      // Prioritize stealing voices in release
      const score = v.stage === "release" ? v.envGain * 0.01 : v.envGain;
      if (score < weakestGain) {
        weakestGain = score;
        weakest = key;
      }
    }
    if (weakest !== null) {
      this.voices.delete(weakest);
    }
  }

  /**
   * Evaluate the synth equation or wavetable for a single sample.
   */
  _buildSample(phase, freq, velocity, note, params) {
    const t = phase / sampleRate;
    const x = t * freq * 2 * Math.PI * this.scale.x;

    // Wavetable lookup
    if (this.drawnWave) {
      const wLen = this.drawnWave.length;
      const ph = ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const idx = (ph / (Math.PI * 2)) * wLen;
      const i0 = Math.floor(idx) % wLen;
      const i1 = (i0 + 1) % wLen;
      const frac = idx - Math.floor(idx);
      const raw = this.drawnWave[i0] * (1 - frac) + this.drawnWave[i1] * frac;
      return Math.tanh(raw * this.scale.y);
    }

    // Equation evaluation
    if (!this.evalFn) return 0;
    try {
      this._scope.x = x;
      this._scope.t = t;
      this._scope.freq = freq;
      this._scope.note = note;
      this._scope.velocity = velocity;
      this._scope.a = params.a;
      this._scope.b = params.b;
      this._scope.c = params.c;
      this._scope.d = params.d;
      const raw = this.evalFn(this._scope);
      return Number.isFinite(raw) ? Math.tanh(raw * this.scale.y) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * process() is called by the audio rendering thread for each
   * 128-sample render quantum.
   */
  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : null;
    const blockSize = outL.length;

    const smoothFactor = 1 - this.smoothCoeff;
    const voices = this.voices;
    const { attack, decay, sustain } = this.adsr;
    const targetP = this.targetParams;
    const p = this.params;

    for (let i = 0; i < blockSize; i++) {
      // Parameter smoothing
      p.a += (targetP.a - p.a) * smoothFactor;
      p.b += (targetP.b - p.b) * smoothFactor;
      p.c += (targetP.c - p.c) * smoothFactor;
      p.d += (targetP.d - p.d) * smoothFactor;

      if (voices.size === 0) {
        outL[i] = 0;
        if (outR) outR[i] = 0;
        continue;
      }

      let mix = 0;

      for (const [, v] of voices) {
        // Velocity smoothing
        v.currentVelocity += (v.velocity - v.currentVelocity) * 0.01;

        // ADSR envelope
        if (v.stage === "attack") {
          const attackStep = 1 / Math.max(1, attack * sampleRate);
          v.envGain = Math.min(1, v.envGain + attackStep);
          if (v.envGain >= 0.999) v.stage = "decay";
        } else if (v.stage === "decay") {
          const decayStep = (1 - sustain) / Math.max(1, decay * sampleRate);
          v.envGain = Math.max(sustain, v.envGain - decayStep);
          if (v.envGain <= sustain + 0.0001) v.stage = "sustain";
        } else if (v.stage === "sustain") {
          v.envGain = sustain;
        } else if (v.stage === "release") {
          v.envGain = Math.max(0, v.envGain - v.releaseStep);
        }

        if (v.envGain <= 0 && v.stage === "release") continue;

        mix += this._buildSample(v.phase, v.freq, v.currentVelocity, v.note, p) * 0.28 * v.envGain * v.currentVelocity;
        v.phase++;
      }

      const sample = Math.tanh(mix);
      outL[i] = sample;
      if (outR) outR[i] = sample;
    }

    // Clean up finished release voices
    for (const [key, v] of voices) {
      if (v.stage === "release" && v.envGain <= 0) {
        voices.delete(key);
      }
    }

    // Report active voice count periodically (every ~46ms at 128-sample blocks for 44.1kHz)
    return true;
  }
}

registerProcessor("synth-processor", SynthProcessor);

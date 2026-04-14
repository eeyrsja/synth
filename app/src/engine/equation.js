import { compile } from "mathjs";

let compiledEq = null;
const eqScope = { x: 0, t: 0, freq: 0, note: 0, velocity: 0, a: 0, b: 0, c: 0, d: 0, pi: Math.PI, e: Math.E };

export function compileEquation(eq) {
  try {
    compiledEq = compile(eq);
    return true;
  } catch {
    compiledEq = null;
    return false;
  }
}

export function getCompiledEquation() {
  return compiledEq;
}

/**
 * Build a single sample value from the synth equation or drawn wave.
 * @param {number} t - Phase accumulator / time value
 * @param {number} freq - Note frequency in Hz
 * @param {number} velocity - Note velocity 0-1
 * @param {number} note - MIDI note number
 * @param {{ a: number, b: number, c: number, d: number }} params - Smoothed equation parameters
 * @param {{ x: number, y: number }} scale - X/Y scale factors
 * @param {Float32Array|null} drawnWave - Drawn wavetable data, or null
 * @returns {number} Sample value (soft-clipped via tanh)
 */
export function buildSample(t, freq, velocity, note, params, scale, drawnWave) {
  try {
    const x = t * freq * 2 * Math.PI * scale.x;

    // Wavetable lookup if drawn wave is loaded
    if (drawnWave) {
      const phase = ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const idx = (phase / (Math.PI * 2)) * drawnWave.length;
      const i0 = Math.floor(idx) % drawnWave.length;
      const i1 = (i0 + 1) % drawnWave.length;
      const frac = idx - Math.floor(idx);
      const raw = drawnWave[i0] * (1 - frac) + drawnWave[i1] * frac;
      return Math.tanh(raw * scale.y);
    }

    if (!compiledEq) return 0;

    eqScope.x = x;
    eqScope.t = t;
    eqScope.freq = freq;
    eqScope.note = note;
    eqScope.velocity = velocity;
    eqScope.a = params.a;
    eqScope.b = params.b;
    eqScope.c = params.c;
    eqScope.d = params.d;

    const raw = compiledEq.evaluate(eqScope);
    if (!Number.isFinite(raw)) return 0;
    return Math.tanh(raw * scale.y);
  } catch {
    return 0;
  }
}

// Initialize with default equation
compileEquation("sin(x)");

import { clamp } from "./types.js";

/**
 * Evaluate a single LFO sample given shape and phase.
 */
export function lfoSample(shape, phase, prevSH) {
  const p = ((phase % 1) + 1) % 1;
  switch (shape) {
    case "sine": return Math.sin(p * Math.PI * 2);
    case "triangle": return 1 - 4 * Math.abs(p - 0.5);
    case "square": return p < 0.5 ? 1 : -1;
    case "saw": return 2 * p - 1;
    case "s&h": return prevSH;
    default: return 0;
  }
}

/**
 * Create refs-based LFO state for audio-rate modulation.
 */
export function createLfoState() {
  return {
    phases: [0, 0, 0],
    shValues: [0, 0, 0],     // sample & hold values
    outputs: [0, 0, 0],      // current LFO output for display
    bases: { a: 1, b: 0, c: 0, d: 0, cutoff: 18000, resonance: 0.7, volume: 0.18 },
  };
}

/**
 * Process one LFO tick (called from requestAnimationFrame loop).
 * Mutates lfoState in place. Returns accumulated modulations.
 */
export function processLfoTick(lfoState, lfos, dt) {
  const mods = { a: 0, b: 0, c: 0, d: 0, cutoff: 0, resonance: 0, volume: 0 };
  let anyActive = false;

  for (let i = 0; i < 3; i++) {
    const l = lfos[i];
    if (!l.enabled || l.depth === 0) {
      lfoState.outputs[i] = 0;
      continue;
    }
    anyActive = true;
    lfoState.phases[i] += l.rate * dt;
    const ph = lfoState.phases[i];

    // S&H: resample at each cycle boundary
    if (l.shape === "s&h") {
      const prevPh = ph - l.rate * dt;
      if (Math.floor(ph) !== Math.floor(prevPh)) {
        lfoState.shValues[i] = Math.random() * 2 - 1;
      }
    }

    const val = lfoSample(l.shape, ph, lfoState.shValues[i]);
    lfoState.outputs[i] = val;
    mods[l.target] += val * l.depth;
  }

  return { mods, anyActive };
}

/**
 * Apply LFO modulations to audio nodes (filter, gain) and params ref.
 */
export function applyLfoModulations(mods, bases, paramsRef, filterNode, gainRef, audioCtx, smoothTime = 0.03) {
  // Update equation params ref
  paramsRef.current = {
    a: bases.a + mods.a,
    b: bases.b + mods.b,
    c: bases.c + mods.c,
    d: bases.d + mods.d,
  };

  const t = audioCtx ? audioCtx.currentTime : 0;

  // Apply filter modulation
  if (filterNode && audioCtx) {
    if (mods.cutoff !== 0) {
      const modded = clamp(bases.cutoff * Math.pow(2, mods.cutoff * 2), 60, 20000);
      filterNode.frequency.setTargetAtTime(modded, t, smoothTime);
    }
    if (mods.resonance !== 0) {
      filterNode.Q.setTargetAtTime(clamp(bases.resonance + mods.resonance * 10, 0.1, 20), t, smoothTime);
    }
  }

  // Apply gain modulation
  if (gainRef && audioCtx && mods.volume !== 0) {
    gainRef.gain.setTargetAtTime(clamp(bases.volume + mods.volume * 0.3, 0, 0.5), t, smoothTime);
  }
}

/**
 * Compute the UI display modulation value for a given target.
 * Used by knobs to show LFO-modulated positions.
 */
export function getLfoUiMod(lfos, lfoOutputs, target) {
  let mod = 0;
  for (let i = 0; i < lfos.length; i++) {
    const l = lfos[i];
    if (!l.enabled || l.depth === 0 || l.target !== target) continue;
    mod += (lfoOutputs[i] || 0) * l.depth;
  }
  return mod;
}

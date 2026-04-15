import { createEffectsChain, rewireFxChain } from "./effects.js";
import { transpileEquation } from "./equation-transpiler.js";

// Resolve worklet URL at import time — Vite emits this as a separate asset
const workletUrl = new URL("./worklet/synth-processor.js", import.meta.url);

/**
 * Audio engine state — holds all Web Audio API node references.
 * Designed to be used as a singleton via refs, not React state.
 */
export function createEngineRefs() {
  return {
    audioCtx: null,
    workletNode: null,
    gain: null,
    analyser: null,
    fxNodes: null,
    filterNode: null,
    midiAccess: null,
    drawnWave: null,
    reverbDecay: 2.0,
    starting: false,
    /** Track held notes on main thread for UI (activeNotes display) */
    heldNotes: new Set(),
  };
}

/**
 * Post a message to the AudioWorklet processor.
 * @param {object} engine
 * @param {object} msg
 */
function postToWorklet(engine, msg) {
  engine.workletNode?.port.postMessage(msg);
}

/**
 * Set up the full audio engine: AudioContext, AudioWorkletNode,
 * effects chain, filter, analyser, gain.
 *
 * @param {object} engine - Engine refs object from createEngineRefs()
 * @param {object} options - Configuration
 * @param {number} options.masterVolume - Initial master volume
 * @param {string[]} options.fxOrder - Effect chain order
 * @param {{ attack:number, decay:number, sustain:number, release:number }} options.adsr - Initial ADSR
 * @param {{ a:number, b:number, c:number, d:number }} options.params - Initial equation params
 * @param {{ x:number, y:number }} options.scale - Initial scale factors
 * @param {Function} options.onReady - Callback when audio is ready
 * @param {Function} options.onSampleRate - Callback with sample rate
 * @returns {Promise<object>} The audio context
 */
export async function setupAudio(engine, options) {
  if (engine.audioCtx) {
    await engine.audioCtx.resume();
    options.onReady?.();
    return engine.audioCtx;
  }

  if (engine.starting) return null;
  engine.starting = true;

  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctor();

    // Register the AudioWorklet processor module
    await ctx.audioWorklet.addModule(workletUrl);

    const gain = ctx.createGain();
    gain.gain.value = options.masterVolume;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    gain.connect(analyser);
    analyser.connect(ctx.destination);

    // Create voice filter
    const voiceFilter = ctx.createBiquadFilter();
    voiceFilter.type = "allpass";
    voiceFilter.frequency.value = 18000;
    voiceFilter.Q.value = 0.7;

    // Create effects chain
    const fxNodes = createEffectsChain(ctx);

    // Wire effects chain
    rewireFxChain(fxNodes, options.fxOrder, gain, voiceFilter);

    // Create AudioWorkletNode (stereo output)
    const workletNode = new AudioWorkletNode(ctx, "synth-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    workletNode.connect(voiceFilter);

    // Send initial parameters to the worklet
    const port = workletNode.port;
    if (options.params) {
      port.postMessage({ type: "params", ...options.params });
    }
    if (options.scale) {
      port.postMessage({ type: "scale", x: options.scale.x, y: options.scale.y });
    }
    if (options.adsr) {
      port.postMessage({ type: "adsr", ...options.adsr });
    }

    // Store refs
    engine.audioCtx = ctx;
    engine.workletNode = workletNode;
    engine.gain = gain;
    engine.analyser = analyser;
    engine.fxNodes = fxNodes;
    engine.filterNode = voiceFilter;

    options.onReady?.();
    options.onSampleRate?.(ctx.sampleRate);

    return ctx;
  } finally {
    engine.starting = false;
  }
}

/**
 * Send updated equation params (a,b,c,d) to the worklet.
 */
export function sendParams(engine, params) {
  postToWorklet(engine, { type: "params", a: params.a, b: params.b, c: params.c, d: params.d });
}

/**
 * Send updated scale factors to the worklet.
 */
export function sendScale(engine, x, y) {
  postToWorklet(engine, { type: "scale", x, y });
}

/**
 * Send updated ADSR envelope to the worklet.
 */
export function sendAdsr(engine, adsr) {
  postToWorklet(engine, { type: "adsr", attack: adsr.attack, decay: adsr.decay, sustain: adsr.sustain, release: adsr.release });
}

/**
 * Transpile and send an equation to the worklet.
 * Returns true if transpilation succeeded.
 */
export function sendEquation(engine, eqString) {
  const result = transpileEquation(eqString);
  if (result.ok) {
    postToWorklet(engine, { type: "equation", body: result.body });
  } else {
    // Fallback to default sin(x) on transpilation failure
    postToWorklet(engine, { type: "equation", body: null });
  }
  return result.ok;
}

/**
 * Send drawn wavetable data to the worklet.
 */
export function sendDrawnWave(engine, wave) {
  if (wave) {
    postToWorklet(engine, { type: "drawnWave", wave: Array.from(wave) });
  } else {
    postToWorklet(engine, { type: "drawnWave", wave: null });
  }
}

/**
 * Trigger a note on — sends to worklet and tracks on main thread.
 */
export function noteOn(engine, note, velocity = 0.8) {
  postToWorklet(engine, { type: "noteOn", note, velocity });
  engine.heldNotes.add(note);
}

/**
 * Trigger a note off — sends to worklet and tracks on main thread.
 */
export function noteOff(engine, note) {
  postToWorklet(engine, { type: "noteOff", note });
  engine.heldNotes.delete(note);
}

/**
 * Panic — kill all notes.
 */
export function panic(engine) {
  postToWorklet(engine, { type: "panic" });
  engine.heldNotes.clear();
}

/**
 * Get list of currently active note numbers (main-thread tracking).
 */
export function getActiveNotes(engine) {
  return [...engine.heldNotes].sort((a, b) => a - b);
}

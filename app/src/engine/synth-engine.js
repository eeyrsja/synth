import { midiToFreq } from "./types.js";
import { createEffectsChain, rewireFxChain } from "./effects.js";

/**
 * Audio engine state — holds all Web Audio API node references.
 * Designed to be used as a singleton via refs, not React state.
 */
export function createEngineRefs() {
  return {
    audioCtx: null,
    processor: null,
    gain: null,
    analyser: null,
    fxNodes: null,
    filterNode: null,
    heldNotes: new Map(),
    phases: new Map(),
    midiAccess: null,
    drawnWave: null,
    reverbDecay: 2.0,
    starting: false,
  };
}

/**
 * Set up the full audio engine: AudioContext, ScriptProcessorNode,
 * effects chain, filter, analyser, gain.
 *
 * @param {object} engine - Engine refs object from createEngineRefs()
 * @param {object} options - Configuration
 * @param {number} options.masterVolume - Initial master volume
 * @param {string[]} options.fxOrder - Effect chain order
 * @param {Function} options.buildSample - Sample builder function
 * @param {{ current: object }} options.adsrRef - Ref to current ADSR config
 * @param {{ current: object }} options.paramsRef - Ref to current params {a,b,c,d}
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

    // Create ScriptProcessorNode
    const processor = ctx.createScriptProcessor(2048, 0, 1);
    const smoothParams = { a: 1, b: 0, c: 0, d: 0 };
    const paramSmooth = 0.999;

    processor.onaudioprocess = (ev) => {
      const out = ev.outputBuffer.getChannelData(0);
      const notes = Array.from(engine.heldNotes.entries());

      for (let i = 0; i < out.length; i++) {
        const targetParams = options.paramsRef.current;
        smoothParams.a += (targetParams.a - smoothParams.a) * (1 - paramSmooth);
        smoothParams.b += (targetParams.b - smoothParams.b) * (1 - paramSmooth);
        smoothParams.c += (targetParams.c - smoothParams.c) * (1 - paramSmooth);
        smoothParams.d += (targetParams.d - smoothParams.d) * (1 - paramSmooth);

        if (!notes.length) { out[i] = 0; continue; }

        let mix = 0;
        for (const [, ns] of notes) {
          if (ns.currentVelocity === undefined) ns.currentVelocity = ns.velocity;
          else ns.currentVelocity += (ns.velocity - ns.currentVelocity) * 0.01;

          const { attack, decay, sustain } = options.adsrRef.current;
          if (ns.stage === "attack") {
            const attackStep = 1 / Math.max(1, attack * ctx.sampleRate);
            ns.envGain = Math.min(1, ns.envGain + attackStep);
            if (ns.envGain >= 0.999) ns.stage = "decay";
          } else if (ns.stage === "decay") {
            const decayStep = (1 - sustain) / Math.max(1, decay * ctx.sampleRate);
            ns.envGain = Math.max(sustain, ns.envGain - decayStep);
            if (ns.envGain <= sustain + 0.0001) ns.stage = "sustain";
          } else if (ns.stage === "sustain") {
            ns.envGain = sustain;
          } else if (ns.stage === "release") {
            ns.envGain = Math.max(0, ns.envGain - ns.releaseStep);
          }

          if (ns.envGain <= 0 && ns.stage === "release") continue;

          const p = engine.phases.get(ns.note) || 0;
          mix += options.buildSample(p / ctx.sampleRate, ns.freq, ns.currentVelocity, ns.note, smoothParams) * 0.28 * ns.envGain * ns.currentVelocity;
          engine.phases.set(ns.note, p + 1);
        }
        out[i] = Math.tanh(mix);
      }

      // Clean up finished release envelopes
      for (const [key, ns] of notes) {
        if (ns.stage === "release" && ns.envGain <= 0) {
          engine.heldNotes.delete(key);
          engine.phases.delete(key);
        }
      }
    };

    processor.connect(voiceFilter);

    // Store refs
    engine.audioCtx = ctx;
    engine.processor = processor;
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
 * Trigger a note on.
 */
export function noteOn(engine, note, velocity = 0.8) {
  const existing = engine.heldNotes.get(note);
  if (existing) {
    existing.velocity = velocity;
    existing.stage = "attack";
    existing.releaseStep = 0;
  } else {
    engine.heldNotes.set(note, {
      note,
      velocity,
      freq: midiToFreq(note),
      envGain: 0,
      stage: "attack",
      releaseStep: 0,
    });
    if (!engine.phases.has(note)) engine.phases.set(note, 0);
  }
}

/**
 * Trigger a note off (start release).
 */
export function noteOff(engine, note) {
  const ns = engine.heldNotes.get(note);
  if (ns) {
    ns.stage = "release";
    const sampleRate = engine.audioCtx?.sampleRate || 44100;
    // adsrRef is accessed via the options passed to setupAudio, but we read release from the voice
    // For now, we need the ADSR release value. The caller should pass it or we store it on engine.
    ns.releaseStep = Math.max(
      ns.envGain / Math.max(1, 0.22 * sampleRate),
      1e-5
    );
  }
}

/**
 * Note off with explicit release time.
 */
export function noteOffWithRelease(engine, note, releaseTime) {
  const ns = engine.heldNotes.get(note);
  if (ns) {
    ns.stage = "release";
    const sampleRate = engine.audioCtx?.sampleRate || 44100;
    ns.releaseStep = Math.max(
      ns.envGain / Math.max(1, releaseTime * sampleRate),
      1e-5
    );
  }
}

/**
 * Panic — kill all notes.
 */
export function panic(engine) {
  engine.heldNotes.clear();
  engine.phases.clear();
}

/**
 * Get list of currently active (non-release) note numbers.
 */
export function getActiveNotes(engine) {
  return [...engine.heldNotes.entries()]
    .filter(([, voice]) => voice.stage !== "release")
    .map(([note]) => note)
    .sort((a, b) => a - b);
}

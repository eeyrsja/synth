export { clamp, midiToFreq, DEFAULT_EQ, NOTE_NAMES, noteName, FILTER_TYPES, LFO_SHAPES, LFO_TARGETS, DEFAULT_LFO, DEFAULT_ADSR, DEFAULT_FILTER, DEFAULT_FX_PARAMS, withFxDefaults, PRESET_ADSRS } from "./types.js";
export { compileEquation, getCompiledEquation, buildSample } from "./equation.js";
export { transpileEquation } from "./equation-transpiler.js";
export { generateIR, createEffectsChain, rewireFxChain, syncFxParams, updateReverbDecay } from "./effects.js";
export { lfoSample, createLfoState, processLfoTick, applyLfoModulations, getLfoUiMod } from "./lfo.js";
export { createEngineRefs, setupAudio, noteOn, noteOff, panic, getActiveNotes, sendParams, sendScale, sendAdsr, sendEquation, sendDrawnWave } from "./synth-engine.js";
export { setupMidi } from "./midi.js";
export { createRecorderState, recNoteOn, recNoteOff, startRecording, cancelCountdown, stopRecording, startPlayback, stopPlayback, exportAudio, applyTrim, cleanupRecorder } from "./recorder.js";
export { THEMES, T, setTheme } from "./themes.js";

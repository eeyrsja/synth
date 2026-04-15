// ─── Engine Type Definitions (as JSDoc / default shapes) ──────────

/** @typedef {{ attack: number, decay: number, sustain: number, release: number }} ADSRConfig */
/** @typedef {{ type: string, cutoff: number, resonance: number }} FilterConfig */
/** @typedef {{ enabled: boolean, drive: number, tone: number, mix: number, asym: number }} DistortionParams */
/** @typedef {{ enabled: boolean, mix: number, rate: number, depth: number }} ChorusParams */
/** @typedef {{ enabled: boolean, mix: number, time: number, feedback: number }} DelayParams */
/** @typedef {{ enabled: boolean, mix: number, decay: number }} ReverbParams */
/** @typedef {{ distortion: DistortionParams, chorus: ChorusParams, delay: DelayParams, reverb: ReverbParams }} FXParams */
/** @typedef {{ enabled: boolean, shape: string, rate: number, depth: number, target: string, phase: number }} LFOConfig */
/** @typedef {{ note: number, velocity: number, freq: number, envGain: number, stage: string, releaseStep: number, currentVelocity?: number }} VoiceState */
/** @typedef {{ name: string, eq: string, a: number, b: number, c: number, d: number, adsr: ADSRConfig, filter: FilterConfig, fxParams: FXParams, lfos: LFOConfig[], drawnWave?: number[] | null }} PresetData */

export const DEFAULT_EQ = "sin(x)";

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (n) => NOTE_NAMES[n % 12] + Math.floor(n / 12 - 1);

export const FILTER_TYPES = [
  { value: "allpass", label: "Bypass" },
  { value: "lowpass", label: "Low-Pass" },
  { value: "highpass", label: "High-Pass" },
  { value: "bandpass", label: "Band-Pass" },
];

export const LFO_SHAPES = ["sine", "triangle", "square", "saw", "s&h"];
export const LFO_TARGETS = [
  { value: "a", label: "Param A" },
  { value: "b", label: "Param B" },
  { value: "c", label: "Param C" },
  { value: "d", label: "Param D" },
  { value: "cutoff", label: "Filter Cutoff" },
  { value: "resonance", label: "Filter Reso" },
  { value: "volume", label: "Volume" },
];

export const DEFAULT_LFO = { enabled: false, shape: "sine", rate: 1, depth: 0, target: "a", phase: 0 };
export const DEFAULT_ADSR = { attack: 0.012, decay: 0.18, sustain: 0.78, release: 0.22 };
export const DEFAULT_FILTER = { type: "allpass", cutoff: 18000, resonance: 0.7 };

export const DEFAULT_FX_PARAMS = {
  distortion: { enabled: false, drive: 8, tone: 0.45, mix: 0.8, asym: 0.15 },
  chorus:     { enabled: false, mix: 0.5, rate: 1.5, depth: 0.005 },
  delay:      { enabled: false, mix: 0.3, time: 0.35, feedback: 0.4 },
  reverb:     { enabled: false, mix: 0.3, decay: 2.0 },
};

export const withFxDefaults = (fx = {}) => ({
  distortion: { ...DEFAULT_FX_PARAMS.distortion, ...(fx.distortion || {}) },
  chorus: { ...DEFAULT_FX_PARAMS.chorus, ...(fx.chorus || {}) },
  delay: { ...DEFAULT_FX_PARAMS.delay, ...(fx.delay || {}) },
  reverb: { ...DEFAULT_FX_PARAMS.reverb, ...(fx.reverb || {}) },
});

// ─── Helpers ────────────────────────────────────────────────────────
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const midiToFreq = (n) => 440 * Math.pow(2, (n - 69) / 12);

export const PRESET_ADSRS = {
  "Pure Sine": { attack: 0.02, decay: 0.15, sustain: 0.85, release: 0.2 },
  "FM Bell": { attack: 0.002, decay: 1.2, sustain: 0.0, release: 1.1 },
  "Warm Saw": { attack: 0.02, decay: 0.28, sustain: 0.72, release: 0.35 },
  "Fat Square": { attack: 0.004, decay: 0.2, sustain: 0.8, release: 0.24 },
  "Organ": { attack: 0.01, decay: 0.08, sustain: 0.92, release: 0.18 },
  "Chirp": { attack: 0.001, decay: 0.22, sustain: 0.0, release: 0.08 },
  "PWM": { attack: 0.003, decay: 0.14, sustain: 0.74, release: 0.16 },
  "Metallic": { attack: 0.001, decay: 0.75, sustain: 0.12, release: 0.45 },
  "Sub Bass": { attack: 0.008, decay: 0.18, sustain: 0.88, release: 0.24 },
  "Pluck": { attack: 0.001, decay: 0.32, sustain: 0.0, release: 0.12 },
  "Noise Ring": { attack: 0.002, decay: 0.5, sustain: 0.22, release: 0.3 },
  "Alien": { attack: 0.015, decay: 0.4, sustain: 0.5, release: 0.5 },
};

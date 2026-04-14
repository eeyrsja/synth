import {
  DEFAULT_ADSR, DEFAULT_FILTER, DEFAULT_LFO, PRESET_ADSRS, withFxDefaults,
} from "../engine/types.js";

export const PRESETS = [
  { name: "Pure Sine",  eq: "sin(x)",                                           a: 1,      b: 0,    c: 0,     d: 0 },
  { name: "FM Bell",    eq: "sin(x + a*sin(b*x))",                              a: 3,      b: 7,    c: 0,     d: 0 },
  { name: "Warm Saw",   eq: "tanh(a*sin(x) + b*sin(2*x) + c*sin(3*x))",         a: 1,      b: 0.5,  c: 0.33,  d: 0 },
  { name: "Fat Square", eq: "tanh(a * sin(x))",                                  a: 5,      b: 0,    c: 0,     d: 0 },
  { name: "Organ",      eq: "sin(x) + a*sin(2*x) + b*sin(3*x) + c*sin(4*x)",   a: 0.5,    b: 0.25, c: 0.125, d: 0 },
  { name: "Chirp",      eq: "sin(a*x^2 + b*x)",                                 a: -1.149, b: 0.113,c: 0,     d: 0 },
  { name: "PWM",        eq: "sign(sin(x) - a)",                                  a: 0,      b: 0,    c: 0,     d: 0 },
  { name: "Metallic",   eq: "sin(x + a*sin(b*x)) + c*sin(11*x)",                a: 2,      b: 5,    c: 0.15,  d: 0 },
  { name: "Sub Bass",   eq: "sin(x) + a*sin(0.5*x)",                             a: 0.8,    b: 0,    c: 0,     d: 0 },
  { name: "Pluck",      eq: "sin(x) * exp(-a*t) * (1 + b*sin(3*x))",            a: 3,      b: 0.5,  c: 0,     d: 0 },
  { name: "Noise Ring", eq: "tanh(sin(x) + a*sin(x*1.01) + b*sin(x*2.99))",     a: 0.8,    b: 0.4,  c: 0,     d: 0 },
  { name: "Alien",      eq: "sin(a*x) * cos(b*x) + c*sin(d*x)",                 a: 1,      b: 0.5,  c: 0.3,   d: 3 },
].map((preset) => ({
  ...preset,
  adsr: { ...DEFAULT_ADSR, ...(PRESET_ADSRS[preset.name] || {}) },
  filter: { ...DEFAULT_FILTER },
  fxParams: withFxDefaults(),
  lfos: [
    { ...DEFAULT_LFO },
    { ...DEFAULT_LFO, target: "b" },
    { ...DEFAULT_LFO, target: "cutoff" },
  ],
}));

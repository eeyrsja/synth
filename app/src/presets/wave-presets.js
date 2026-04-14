export const WAVE_SHAPES = [
  { name: "Sine", fn: (t) => Math.sin(t * Math.PI * 2) },
  { name: "Triangle", fn: (t) => 1 - 4 * Math.abs(Math.round(t) - t) },
  { name: "Square", fn: (t) => t < 0.5 ? 1 : -1 },
  { name: "Sawtooth", fn: (t) => 2 * t - 1 },
  { name: "Pulse 25", fn: (t) => t < 0.25 ? 1 : -1 },
  { name: "PWM Rich", fn: (t) => {
    const p = 0.5 + 0.22 * Math.sin(2 * Math.PI * t);
    return t < p ? 1 : -1;
  }},
  { name: "SuperSaw", fn: (t) => {
    const saw = (ph) => 2 * (ph - Math.floor(ph + 0.5));
    return 0.28 * saw(t)
      + 0.2 * saw(t * 1.003)
      + 0.2 * saw(t * 0.997)
      + 0.16 * saw(t * 1.009)
      + 0.16 * saw(t * 0.991);
  }},
  { name: "Juno Wire", fn: (t) => {
    const x = 2 * Math.PI * t;
    return 0.78 * Math.sin(x) + 0.25 * Math.sin(2 * x) + 0.12 * Math.sin(3 * x);
  }},
  { name: "Moog Bass", fn: (t) => {
    const x = 2 * Math.PI * t;
    return Math.tanh(1.6 * (0.85 * Math.sin(x) + 0.22 * Math.sin(2 * x) + 0.08 * Math.sin(3 * x)));
  }},
  { name: "OB Brass", fn: (t) => {
    const x = 2 * Math.PI * t;
    return 0.55 * Math.sin(x) + 0.35 * Math.sin(2 * x) + 0.2 * Math.sin(3 * x) + 0.08 * Math.sin(4 * x);
  }},
  { name: "Prophet Sweep", fn: (t) => {
    const x = 2 * Math.PI * t;
    const w = 0.35 + 0.2 * Math.sin(x);
    return Math.sin(x) * (1 - w) + (t < w ? 0.9 : -0.9) * w;
  }},
  { name: "TB Squelch", fn: (t) => {
    const x = 2 * Math.PI * t;
    const s = 2 * t - 1;
    return Math.tanh(2.2 * (0.75 * s + 0.35 * Math.sin(x * 2.2) + 0.12 * Math.sin(x * 3.7)));
  }},
  { name: "Sync Lead", fn: (t) => {
    const x = 2 * Math.PI * t;
    return Math.sin(x + 0.65 * Math.sin(3 * x)) + 0.2 * Math.sin(5 * x);
  }},
  { name: "Vox Formant", fn: (t) => {
    const x = 2 * Math.PI * t;
    return 0.6 * Math.sin(x) + 0.28 * Math.sin(2.7 * x) + 0.18 * Math.sin(4.1 * x);
  }},
  { name: "Glass FM", fn: (t) => {
    const x = 2 * Math.PI * t;
    return Math.sin(x + 2.6 * Math.sin(3 * x)) + 0.3 * Math.sin(6 * x);
  }},
  { name: "Bell DX", fn: (t) => {
    const x = 2 * Math.PI * t;
    return 0.55 * Math.sin(x) + 0.34 * Math.sin(2.7 * x) + 0.22 * Math.sin(7.3 * x);
  }},
  { name: "Choir Pad", fn: (t) => {
    const x = 2 * Math.PI * t;
    return 0.62 * Math.sin(x) + 0.2 * Math.sin(2 * x + 0.3) + 0.14 * Math.sin(4 * x + 1.1);
  }},
  { name: "Reese", fn: (t) => {
    const x = 2 * Math.PI * t;
    return Math.tanh(1.8 * (0.65 * Math.sin(x * 0.99) + 0.65 * Math.sin(x * 1.01) + 0.2 * Math.sin(2 * x)));
  }},
  { name: "Noise", fn: () => Math.random() * 2 - 1 },
];

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { compile } from "mathjs";

// ─── Helpers ────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const midiToFreq = (n) => 440 * Math.pow(2, (n - 69) / 12);
const DEFAULT_EQ = "sin(x)";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (n) => NOTE_NAMES[n % 12] + Math.floor(n / 12 - 1);

const FILTER_TYPES = [
  { value: "allpass", label: "Bypass" },
  { value: "lowpass", label: "Low-Pass" },
  { value: "highpass", label: "High-Pass" },
  { value: "bandpass", label: "Band-Pass" },
];

const LFO_SHAPES = ["sine", "triangle", "square", "saw", "s&h"];
const LFO_TARGETS = [
  { value: "a", label: "Param A" },
  { value: "b", label: "Param B" },
  { value: "c", label: "Param C" },
  { value: "d", label: "Param D" },
  { value: "cutoff", label: "Filter Cutoff" },
  { value: "resonance", label: "Filter Reso" },
  { value: "volume", label: "Volume" },
];

const DEFAULT_LFO = { enabled: false, shape: "sine", rate: 1, depth: 0, target: "a", phase: 0 };

const DEFAULT_ADSR = { attack: 0.012, decay: 0.18, sustain: 0.78, release: 0.22 };
const DEFAULT_FILTER = { type: "allpass", cutoff: 18000, resonance: 0.7 };
const DEFAULT_FX_PARAMS = {
  distortion: { enabled: false, drive: 8, tone: 0.45, mix: 0.8, asym: 0.15 },
  chorus:     { enabled: false, mix: 0.5, rate: 1.5, depth: 0.005 },
  delay:      { enabled: false, mix: 0.3, time: 0.35, feedback: 0.4 },
  reverb:     { enabled: false, mix: 0.3, decay: 2.0 },
};

const withFxDefaults = (fx = {}) => ({
  distortion: { ...DEFAULT_FX_PARAMS.distortion, ...(fx.distortion || {}) },
  chorus: { ...DEFAULT_FX_PARAMS.chorus, ...(fx.chorus || {}) },
  delay: { ...DEFAULT_FX_PARAMS.delay, ...(fx.delay || {}) },
  reverb: { ...DEFAULT_FX_PARAMS.reverb, ...(fx.reverb || {}) },
});

const PRESET_ADSRS = {
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

function lfoSample(shape, phase, prevSH) {
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

const PRESETS = [
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

function generateIR(ctx, decay) {
  const len = Math.floor(ctx.sampleRate * clamp(decay, 0.1, 5));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  }
  return buf;
}

// ─── Theme ── Retro Analog ───────────────────────────────────────────
const T = {
  bg:         "#0d0b08",
  surface:    "#1a1510",
  surfaceAlt: "#211c14",
  raised:     "#2e2820",
  border:     "rgba(255,180,60,0.12)",
  borderHi:   "rgba(255,180,60,0.25)",
  text:       "#e8d5b0",
  textDim:    "#9a8560",
  textMuted:  "#6b5a3e",
  accent:     "#e8850c",
  accentGlow: "rgba(232,133,12,0.35)",
  accentSoft: "rgba(232,133,12,0.15)",
  green:      "#33ff66",
  greenGlow:  "rgba(51,255,102,0.3)",
  greenDark:  "#20cc44",
  red:        "#cc3300",
  amber:      "#ffaa00",
  white:      "#f0e6d2",
  plotBg:     "#080c08",
  plotLine:   "#33ff66",
  plotAxis:   "#1a3a1a",
  plotGrid:   "#0f1f0f",
  radius:     3,
  radiusLg:   5,
  font:       "'Share Tech Mono', 'Courier New', monospace",
};

// CRT scanline overlay CSS injected once
if (typeof document !== "undefined" && !document.getElementById("crt-style")) {
  const style = document.createElement("style");
  style.id = "crt-style";
  style.textContent = `
    .crt-overlay {
      pointer-events: none;
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0,0,0,0.06) 2px,
        rgba(0,0,0,0.06) 4px
      );
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    @keyframes led-glow {
      0%, 100% { box-shadow: 0 0 4px currentColor; }
      50% { box-shadow: 0 0 8px currentColor, 0 0 16px currentColor; }
    }
    input[type=range]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 14px; height: 14px;
      border-radius: 2px;
      background: #e8850c;
      border: 1px solid #ffaa00;
      box-shadow: 0 0 6px rgba(232,133,12,0.5);
      cursor: pointer;
    }
    input[type=range]::-webkit-slider-runnable-track {
      height: 4px;
      background: #2e2820;
      border-radius: 2px;
      border: 1px solid rgba(255,180,60,0.15);
    }
    ::selection { background: rgba(232,133,12,0.3); }
  `;
  document.head.appendChild(style);
};

// ─── Slider ─────────────────────────────────────────────────────────
function Knob({ label, value, onChange, min = -5, max = 5, step = 0.001, compact = false, defaultValue, lfoMod }) {
  const showReset = defaultValue !== undefined && value !== defaultValue;
  const hasLfo = lfoMod != null && lfoMod !== 0;
  const modulated = hasLfo ? clamp(value + lfoMod, min, max) : value;
  // Compute positions as % of range for the LFO bar
  const range = max - min;
  const valuePct = ((value - min) / range) * 100;
  const modPct = hasLfo ? ((modulated - min) / range) * 100 : valuePct;
  return (
    <div style={{ marginBottom: compact ? 8 : 12 }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 5, padding: "0 2px",
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: T.textDim, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: T.font }}>
          {label}
          {hasLfo && <span style={{ color: T.accent, fontSize: 8, marginLeft: 4, opacity: 0.8 }}>LFO</span>}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {showReset && (
            <button
              onClick={() => onChange(defaultValue)}
              title="Reset"
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: T.textMuted, fontSize: 13, padding: 0, lineHeight: 1,
              }}
            >↺</button>
          )}
          {hasLfo ? (
            <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{
                fontSize: compact ? 11 : 12, fontVariantNumeric: "tabular-nums",
                color: T.textDim, fontFamily: "'VT323', 'Courier New', monospace",
              }}>
                {value.toFixed(3)}
              </span>
              <span style={{
                fontSize: compact ? 13 : 14, fontVariantNumeric: "tabular-nums",
                color: T.accent, fontWeight: 700, fontFamily: "'VT323', 'Courier New', monospace",
                textShadow: `0 0 8px ${T.accentGlow}`,
              }}>
                {modulated.toFixed(3)}
              </span>
            </span>
          ) : (
            <span style={{
              fontSize: compact ? 13 : 14, fontVariantNumeric: "tabular-nums",
              color: T.green, fontWeight: 700, fontFamily: "'VT323', 'Courier New', monospace",
              textShadow: "0 0 8px rgba(51,255,102,0.5)",
            }}>
              {value.toFixed(3)}
            </span>
          )}
        </span>
      </div>
      <div style={{
        background: "#181208", border: `1px solid ${T.border}`,
        borderRadius: T.radius, padding: "8px 12px",
        position: "relative",
      }}>
        {hasLfo && (
          <div style={{
            position: "absolute", top: 4, bottom: 4, left: 12, right: 12,
            pointerEvents: "none",
          }}>
            <div style={{
              position: "absolute",
              left: `${Math.min(valuePct, modPct)}%`,
              width: `${Math.abs(modPct - valuePct)}%`,
              top: "50%", transform: "translateY(-50%)",
              height: 6, borderRadius: 3,
              background: `${T.accent}55`,
              transition: "none",
            }} />
            <div style={{
              position: "absolute",
              left: `${modPct}%`,
              top: "50%", transform: "translate(-50%, -50%)",
              width: 4, height: 12, borderRadius: 2,
              background: T.accent,
              boxShadow: `0 0 6px ${T.accentGlow}`,
            }} />
          </div>
        )}
        <input
          type="range" min={min} max={max} step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: "100%", cursor: "pointer", accentColor: T.accent,
            height: 6, WebkitAppearance: "none", appearance: "none",
            background: "transparent", outline: "none",
            position: "relative", zIndex: 1,
          }}
        />
      </div>
    </div>
  );
}

// ─── Rotary Knob ────────────────────────────────────────────────────
function RotaryKnob({ label, value, onChange, min = 0, max = 1, step = 0.01, size = 52, defaultValue, lfoMod, log }) {
  const dragRef = useRef(null);
  const hasLfo = lfoMod != null && lfoMod !== 0;
  const modulated = hasLfo ? clamp(value + lfoMod, min, max) : value;
  // Log scaling helpers: map value ↔ normalized 0–1 via log/exp
  const toNorm = log
    ? (v) => Math.log(v / min) / Math.log(max / min)
    : (v) => (v - min) / (max - min);
  const fromNorm = log
    ? (n) => min * Math.pow(max / min, n)
    : (n) => min + n * (max - min);
  const norm = toNorm(clamp(value, min, max));
  const modNorm = hasLfo ? toNorm(clamp(modulated, min, max)) : norm;
  const angle = -135 + norm * 270;
  const modAngle = -135 + modNorm * 270;
  const r = size / 2;
  const ir = r - 6;
  const tr = r - 3;
  const toRad = (deg) => (deg - 90) * Math.PI / 180;
  const arcD = (sA, eA, rad) => {
    const x1 = r + rad * Math.cos(toRad(sA)), y1 = r + rad * Math.sin(toRad(sA));
    const x2 = r + rad * Math.cos(toRad(eA)), y2 = r + rad * Math.sin(toRad(eA));
    return `M${x1},${y1} A${rad},${rad} 0 ${eA - sA > 180 ? 1 : 0} 1 ${x2},${y2}`;
  };
  const pRad = toRad(angle);
  const px = r + (ir - 6) * Math.cos(pRad);
  const py = r + (ir - 6) * Math.sin(pRad);
  // LFO modulated pointer position
  const mRad = toRad(modAngle);
  const mpx = r + (tr + 2) * Math.cos(mRad);
  const mpy = r + (tr + 2) * Math.sin(mRad);
  const showReset = defaultValue !== undefined && Math.abs(value - defaultValue) > step * 0.5;

  const onDown = (e) => {
    e.preventDefault();
    const startNorm = toNorm(clamp(value, min, max));
    dragRef.current = { y: e.clientY, n: startNorm };
    const onMove = (me) => {
      const dy = dragRef.current.y - me.clientY;
      const nn = clamp(dragRef.current.n + dy / 150, 0, 1);
      const nv = clamp(fromNorm(nn), min, max);
      onChange(Math.round(nv / step) * step);
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <svg width={size} height={size} style={{ cursor: "grab", touchAction: "none" }} onPointerDown={onDown}>
        <path d={arcD(-135, 135, tr)} fill="none" stroke={T.border} strokeWidth={2.5} strokeLinecap="round" />
        {norm > 0.005 && <path d={arcD(-135, angle, tr)} fill="none" stroke={T.accent} strokeWidth={2.5} strokeLinecap="round" />}
        {hasLfo && modAngle !== angle && (
          <path
            d={arcD(Math.min(angle, modAngle), Math.max(angle, modAngle), tr + 0.5)}
            fill="none" stroke={T.accent} strokeWidth={5} strokeLinecap="round"
            opacity={0.3}
          />
        )}
        <circle cx={r} cy={r} r={ir} fill={T.raised} stroke={T.borderHi} strokeWidth={1} />
        <line x1={r} y1={r} x2={px} y2={py} stroke={T.accent} strokeWidth={2} strokeLinecap="round" />
        {hasLfo && (
          <circle cx={mpx} cy={mpy} r={3} fill={T.accent} opacity={0.85}>
            <animate attributeName="opacity" values="0.85;0.4;0.85" dur="0.6s" repeatCount="indefinite" />
          </circle>
        )}
      </svg>
      <span style={{ fontSize: 8, color: hasLfo ? T.accent : T.textDim, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, fontFamily: T.font }}>
        {label}{hasLfo ? " ●" : ""}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
        {hasLfo ? (
          <span style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
            <span style={{ fontSize: 9, color: T.textDim, fontVariantNumeric: "tabular-nums", fontFamily: "'VT323', 'Courier New', monospace" }}>{value.toFixed(step < 0.01 ? 3 : 2)}</span>
            <span style={{ fontSize: 11, color: T.accent, fontVariantNumeric: "tabular-nums", fontFamily: "'VT323', 'Courier New', monospace", textShadow: `0 0 6px ${T.accentGlow}` }}>{modulated.toFixed(step < 0.01 ? 3 : 2)}</span>
          </span>
        ) : (
          <span style={{ fontSize: 11, color: T.green, fontVariantNumeric: "tabular-nums", fontFamily: "'VT323', 'Courier New', monospace", textShadow: "0 0 6px rgba(51,255,102,0.4)" }}>{value.toFixed(step < 0.01 ? 3 : 2)}</span>
        )}
        {showReset && (
          <button
            onClick={() => onChange(defaultValue)}
            title="Reset"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: T.textMuted, fontSize: 11, padding: 0, lineHeight: 1,
            }}
          >↺</button>
        )}
      </span>
    </div>
  );
}

// ─── Plot ────────────────────────────────────────────────────────────
function PlotCanvas({ equation, params, xScale, yScale, drawnWave, lfoParams }) {
  const ref = useRef(null);
  const [error, setError] = useState("");
  const hasLfoMod = lfoParams && (lfoParams.a !== 0 || lfoParams.b !== 0 || lfoParams.c !== 0 || lfoParams.d !== 0);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const W = c.width, H = c.height;

    // background
    ctx.fillStyle = T.plotBg;
    ctx.fillRect(0, 0, W, H);

    // grid
    ctx.strokeStyle = T.plotGrid;
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 8; i++) {
      const g = (i / 8) * W;
      ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(W, g); ctx.stroke();
    }

    // axes
    ctx.strokeStyle = T.plotAxis;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();

    try {
      setError("");

      // If LFO is modifying params, draw the modulated waveform first (behind)
      if (hasLfoMod && !drawnWave) {
        const modParams = {
          ...params,
          a: params.a + (lfoParams?.a || 0),
          b: params.b + (lfoParams?.b || 0),
          c: params.c + (lfoParams?.c || 0),
          d: params.d + (lfoParams?.d || 0),
        };
        ctx.strokeStyle = T.accent;
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.shadowColor = T.accentGlow;
        ctx.shadowBlur = 12;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        let first = true;
        const compiled = compile(equation);
        for (let px = 0; px < W; px++) {
          const x = ((px / W) * 2 - 1) * 8 * xScale;
          const scope = { x, t: 0, note: 60, velocity: 1, ...modParams, pi: Math.PI, e: Math.E };
          let y = compiled.evaluate(scope);
          if (!Number.isFinite(y)) { first = true; continue; }
          y = clamp(y, -10, 10);
          const py = H / 2 - (y / (4 / yScale)) * (H / 2);
          first ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          first = false;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1.0;
      }

      // Base waveform (always drawn on top)
      ctx.strokeStyle = T.plotLine;
      ctx.lineWidth = hasLfoMod ? 1.5 : 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = "rgba(51,255,102,0.6)";
      ctx.shadowBlur = hasLfoMod ? 4 : 10;
      ctx.globalAlpha = hasLfoMod ? 0.5 : 1.0;
      ctx.beginPath();
      let first = true;
      if (drawnWave) {
        // Draw the wavetable directly
        for (let px = 0; px < W; px++) {
          const idx = (px / W) * drawnWave.length;
          const i0 = Math.floor(idx) % drawnWave.length;
          const i1 = (i0 + 1) % drawnWave.length;
          const frac = idx - Math.floor(idx);
          const y = drawnWave[i0] * (1 - frac) + drawnWave[i1] * frac;
          const py = H / 2 - (y / (4 / yScale)) * (H / 2);
          first ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          first = false;
        }
      } else {
        const compiled = compile(equation);
        for (let px = 0; px < W; px++) {
          const x = ((px / W) * 2 - 1) * 8 * xScale;
          const scope = { x, t: 0, note: 60, velocity: 1, ...params, pi: Math.PI, e: Math.E };
          let y = compiled.evaluate(scope);
          if (!Number.isFinite(y)) { first = true; continue; }
          y = clamp(y, -10, 10);
          const py = H / 2 - (y / (4 / yScale)) * (H / 2);
          first ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          first = false;
        }
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1.0;
    } catch (err) {
      setError(err.message || "Invalid equation");
    }
  }, [equation, params, xScale, yScale, drawnWave, lfoParams]);

  return (
    <div>
      <div style={{
        border: `1px solid ${T.border}`, borderRadius: T.radius,
        overflow: "hidden", aspectRatio: "1", width: "100%",
        boxShadow: "inset 0 2px 8px rgba(0,0,0,0.08)",
      }}>
        <canvas ref={ref} width={600} height={600} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>
      {error && (
        <div style={{ color: T.amber, fontSize: 12, marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
          <span>⚠</span> {error}
        </div>
      )}
    </div>
  );
}

// ─── Piano Keyboard ─────────────────────────────────────────────────
const BLACK_SET = new Set([1, 3, 6, 8, 10]);
const KB_LO = 48, KB_HI = 72;
const KB_WHITES = (() => { let c = 0; for (let i = KB_LO; i <= KB_HI; i++) if (!BLACK_SET.has(i % 12)) c++; return c; })();

function whitesBefore(note) {
  let c = 0;
  for (let i = KB_LO; i < note; i++) if (!BLACK_SET.has(i % 12)) c++;
  return c;
}

function PianoKeyboard({ activeNotes, onNoteOn, onNoteOff }) {
  const active = new Set(activeNotes);
  const draggingRef = useRef(false);
  const currentNoteRef = useRef(null);
  const cbRef = useRef({ onNoteOn, onNoteOff });
  cbRef.current = { onNoteOn, onNoteOff };

  useEffect(() => {
    const up = () => {
      if (currentNoteRef.current !== null) cbRef.current.onNoteOff(currentNoteRef.current);
      currentNoteRef.current = null;
      draggingRef.current = false;
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const all = [];
  for (let i = KB_LO; i <= KB_HI; i++) all.push(i);
  const whites = all.filter((n) => !BLACK_SET.has(n % 12));
  const blacks = all.filter((n) => BLACK_SET.has(n % 12));
  const ww = 100 / KB_WHITES;
  const bw = ww * 0.58;

  const keyDown = (n, e) => {
    e.preventDefault();
    draggingRef.current = true;
    currentNoteRef.current = n;
    onNoteOn(n);
  };

  const keyEnter = (n) => {
    if (!draggingRef.current) return;
    if (currentNoteRef.current !== null && currentNoteRef.current !== n) onNoteOff(currentNoteRef.current);
    currentNoteRef.current = n;
    onNoteOn(n);
  };

  const keyLeave = (n) => {
    if (!draggingRef.current) onNoteOff(n);
  };

  const whiteStyle = (n) => ({
    flex: 1, borderRadius: "0 0 3px 3px",
    border: `1px solid ${active.has(n) ? T.accent : "rgba(60,50,30,0.5)"}`,
    cursor: "pointer", transition: "all 60ms",
    background: active.has(n)
      ? `linear-gradient(180deg, #ffcc66 0%, ${T.accent} 100%)`
      : "linear-gradient(180deg, #f5ead0 0%, #e0d0b0 100%)",
    boxShadow: active.has(n)
      ? `0 0 14px ${T.accentGlow}, inset 0 -2px 4px rgba(0,0,0,0.15)`
      : "inset 0 -3px 6px rgba(0,0,0,0.1), 0 2px 3px rgba(0,0,0,0.2)",
  });

  const blackStyle = (n) => {
    const left = whitesBefore(n) * ww - bw / 2;
    return {
      position: "absolute", left: `${left}%`, width: `${bw}%`,
      top: 0, height: "60%", zIndex: 10,
      borderRadius: "0 0 3px 3px", cursor: "pointer",
      transition: "all 60ms",
      background: active.has(n)
        ? `linear-gradient(180deg, ${T.accent} 0%, #8b4500 100%)`
        : "linear-gradient(180deg, #2a2218 0%, #181208 100%)",
      boxShadow: active.has(n)
        ? `0 0 12px ${T.accentGlow}`
        : "inset 0 -2px 4px rgba(0,0,0,0.4), 0 3px 6px rgba(0,0,0,0.5)",
    };
  };

  return (
    <div style={{ position: "relative", height: 94, userSelect: "none", touchAction: "none" }}>
      {/* white keys */}
      <div style={{ position: "absolute", inset: 0, display: "flex", gap: 2 }}>
        {whites.map((n) => (
          <div key={n}
            onPointerDown={(e) => keyDown(n, e)}
            onPointerEnter={() => keyEnter(n)}
            onPointerLeave={() => keyLeave(n)}
            style={whiteStyle(n)}
          />
        ))}
      </div>
      {/* black keys */}
      {blacks.map((n) => (
        <div key={n}
          onPointerDown={(e) => keyDown(n, e)}
          onPointerEnter={() => keyEnter(n)}
          onPointerLeave={() => keyLeave(n)}
          style={blackStyle(n)}
        />
      ))}
    </div>
  );
}

// ─── Pill Badge ─────────────────────────────────────────────────────
function Pill({ children, glow = false }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "4px 10px", fontSize: 10, fontWeight: 700,
      fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase",
      borderRadius: 2, background: glow ? "rgba(232,133,12,0.12)" : "#1a1510",
      color: glow ? T.amber : T.textDim,
      border: `1px solid ${glow ? "rgba(255,180,60,0.3)" : T.border}`,
      boxShadow: glow ? "0 0 6px rgba(232,133,12,0.15)" : "none",
    }}>
      {children}
    </span>
  );
}

// ─── Section Card ───────────────────────────────────────────────────
function Section({ title, icon, children, style: outerStyle }) {
  return (
    <div style={{
      background: "linear-gradient(180deg, #211c14 0%, #1a1510 100%)",
      border: `1px solid ${T.border}`,
      borderTop: `1px solid ${T.borderHi}`,
      borderRadius: T.radiusLg, padding: 16,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), 0 2px 8px rgba(0,0,0,0.3)",
      ...outerStyle,
    }}>
      {title && (
        <div style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase",
          letterSpacing: 2, color: T.amber, marginBottom: 12,
          display: "flex", alignItems: "center", gap: 8,
          fontFamily: T.font,
          borderBottom: `1px solid ${T.border}`, paddingBottom: 8,
        }}>
          {icon && <span style={{ fontSize: 12 }}>{icon}</span>}
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Placeholder Feature ────────────────────────────────────────────
function FeaturePlaceholder({ label, description }) {
  return (
    <div style={{
      padding: "12px 14px", borderRadius: T.radius,
      border: `1px dashed ${T.borderHi}`, background: "rgba(232,133,12,0.03)",
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <span style={{
        width: 28, height: 28, borderRadius: 3,
        background: T.accentSoft, display: "flex",
        alignItems: "center", justifyContent: "center",
        fontSize: 12, color: T.accent, flexShrink: 0,
      }}>♦</span>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.text, fontFamily: T.font, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
        <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>{description}</div>
      </div>
    </div>
  );
}

// ─── ADSR Envelope Graph ────────────────────────────────────────────
function AdsrGraph({ adsr }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    const W = cvs.width, H = cvs.height;
    const pad = 8;
    const w = W - pad * 2, h = H - pad * 2;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = T.plotBg;
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = T.plotGrid;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const y = pad + (h * i) / 4;
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
    }

    const { attack, decay, sustain, release } = adsr;
    const sustainHold = Math.max(attack + decay, 0.3) * 0.5;
    const totalTime = attack + decay + sustainHold + release;
    const aW = (attack / totalTime) * w;
    const dW = (decay / totalTime) * w;
    const sW = (sustainHold / totalTime) * w;
    const rW = (release / totalTime) * w;

    const x0 = pad, yBot = pad + h, yTop = pad;
    const ySus = pad + h * (1 - sustain);

    // Fill
    ctx.beginPath();
    ctx.moveTo(x0, yBot);
    ctx.lineTo(x0 + aW, yTop);
    ctx.lineTo(x0 + aW + dW, ySus);
    ctx.lineTo(x0 + aW + dW + sW, ySus);
    ctx.lineTo(x0 + aW + dW + sW + rW, yBot);
    ctx.closePath();
    ctx.fillStyle = "rgba(51,255,102,0.08)";
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(x0, yBot);
    ctx.lineTo(x0 + aW, yTop);
    ctx.lineTo(x0 + aW + dW, ySus);
    ctx.lineTo(x0 + aW + dW + sW, ySus);
    ctx.lineTo(x0 + aW + dW + sW + rW, yBot);
    ctx.strokeStyle = T.plotLine;
    ctx.lineWidth = 2;
    ctx.shadowColor = T.greenGlow;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Dots
    [
      [x0, yBot], [x0 + aW, yTop], [x0 + aW + dW, ySus],
      [x0 + aW + dW + sW, ySus], [x0 + aW + dW + sW + rW, yBot],
    ].forEach(([dx, dy]) => {
      ctx.beginPath(); ctx.arc(dx, dy, 3, 0, Math.PI * 2);
      ctx.fillStyle = T.green; ctx.fill();
    });

    // Labels
    ctx.font = `9px ${T.font}`;
    ctx.fillStyle = T.textMuted;
    ctx.textAlign = "center";
    ["A", "D", "S", "R"].forEach((l, i) => {
      const cx = [x0 + aW / 2, x0 + aW + dW / 2, x0 + aW + dW + sW / 2, x0 + aW + dW + sW + rW / 2][i];
      ctx.fillText(l, cx, H - 2);
    });

    // Border
    ctx.strokeStyle = T.border;
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }, [adsr]);

  return (
    <canvas
      ref={canvasRef}
      width={280}
      height={100}
      style={{
        width: "100%", maxWidth: 280, height: 100,
        display: "block", margin: "0 auto 14px",
        borderRadius: T.radius,
      }}
    />
  );
}

// ─── Oscilloscope ───────────────────────────────────────────────────
function Oscilloscope({ analyserRef, heldNotesRef, audioCtxRef }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const smoothPeakRef = useRef(0.5);
  useEffect(() => {
    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const analyser = analyserRef.current;
      if (!canvas || !analyser) return;
      const ctx = canvas.getContext("2d");
      const w = canvas.width;
      const h = canvas.height;
      const bufLen = analyser.fftSize;
      const data = new Float32Array(bufLen);
      analyser.getFloatTimeDomainData(data);

      // Find peak amplitude for auto-scale
      let peak = 0;
      for (let i = 0; i < bufLen; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
      peak = Math.max(peak, 0.01);
      // Smooth the peak to avoid jitter (attack fast, release slow)
      const prev = smoothPeakRef.current;
      smoothPeakRef.current = peak > prev ? peak : prev * 0.95 + peak * 0.05;
      const scale = smoothPeakRef.current;

      // Determine period in samples from the lowest held note
      let periodSamples = bufLen;
      const sr = audioCtxRef.current ? audioCtxRef.current.sampleRate : 44100;
      const voices = heldNotesRef.current;
      if (voices && voices.size > 0) {
        let lowestFreq = Infinity;
        for (const [, v] of voices) {
          if (v.freq < lowestFreq && v.stage !== "release") lowestFreq = v.freq;
        }
        if (lowestFreq < Infinity && lowestFreq > 0) {
          periodSamples = Math.round(sr / lowestFreq);
        }
      }

      // Show ~2 full cycles, clamped to buffer
      const displaySamples = Math.min(periodSamples * 2, bufLen - 1);

      // Zero-crossing trigger: find a rising edge near the start
      let triggerIdx = 0;
      const searchEnd = Math.min(bufLen - displaySamples, periodSamples * 2);
      for (let i = 1; i < searchEnd; i++) {
        if (data[i - 1] <= 0 && data[i] > 0) { triggerIdx = i; break; }
      }

      ctx.fillStyle = T.bg;
      ctx.fillRect(0, 0, w, h);
      // center line
      ctx.strokeStyle = T.borderHi;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      // waveform
      ctx.strokeStyle = T.green;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const sliceW = w / displaySamples;
      for (let i = 0; i < displaySamples; i++) {
        const sample = data[triggerIdx + i] || 0;
        const y = (1 - sample / scale) * h / 2;
        if (i === 0) ctx.moveTo(0, y); else ctx.lineTo(i * sliceW, y);
      }
      ctx.stroke();
    };
    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [analyserRef, heldNotesRef, audioCtxRef]);
  return (
    <canvas
      ref={canvasRef}
      width={280}
      height={100}
      style={{ width: "100%", height: 100, borderRadius: T.radius, border: `1px solid ${T.border}` }}
    />
  );
}

// ─── Spectrum Analyser ──────────────────────────────────────────────
function Spectrum({ analyserRef }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  useEffect(() => {
    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const analyser = analyserRef.current;
      if (!canvas || !analyser) return;
      const ctx = canvas.getContext("2d");
      const w = canvas.width;
      const h = canvas.height;
      const bufLen = analyser.frequencyBinCount;
      const data = new Uint8Array(bufLen);
      analyser.getByteFrequencyData(data);
      ctx.fillStyle = T.bg;
      ctx.fillRect(0, 0, w, h);
      const barW = w / bufLen;
      for (let i = 0; i < bufLen; i++) {
        const barH = (data[i] / 255) * h;
        const ratio = i / bufLen;
        const r = Math.round(40 + ratio * 200);
        const g = Math.round(255 - ratio * 160);
        const b = Math.round(20 + ratio * 10);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(i * barW, h - barH, Math.max(barW - 1, 1), barH);
      }
    };
    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [analyserRef]);
  return (
    <canvas
      ref={canvasRef}
      width={280}
      height={100}
      style={{ width: "100%", height: 100, borderRadius: T.radius, border: `1px solid ${T.border}` }}
    />
  );
}

// ─── LFO Mini Scope ─────────────────────────────────────────────────
function LfoScope({ shape, rate, lfoOutputRef, index }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  useEffect(() => {
    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = "#080c08";
      ctx.fillRect(0, 0, w, h);
      // center line
      ctx.strokeStyle = T.border;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
      // waveform shape preview
      ctx.strokeStyle = T.amber;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = "rgba(255,170,0,0.4)";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      for (let px = 0; px < w; px++) {
        const phase = (px / w) * 2; // show 2 cycles
        const val = lfoSample(shape, phase, 0);
        const py = (1 - val) * h / 2;
        px === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      // playhead indicator from live output
      const liveVal = lfoOutputRef.current[index];
      const iy = (1 - liveVal) * h / 2;
      ctx.fillStyle = T.green;
      ctx.shadowColor = T.greenGlow;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(w - 6, clamp(iy, 3, h - 3), 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    };
    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [shape, rate, lfoOutputRef, index]);
  return (
    <canvas ref={canvasRef} width={120} height={36}
      style={{ width: "100%", height: 36, borderRadius: T.radius, border: `1px solid ${T.border}` }}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════
//  WAVE DRAWER PAGE
// ═══════════════════════════════════════════════════════════════════
const WAVE_RES = 256;

function WaveDrawer({ onUseWave }) {
  const canvasRef = useRef(null);
  const [wave, setWave] = useState(() => {
    const w = new Float32Array(WAVE_RES);
    for (let i = 0; i < WAVE_RES; i++) w[i] = Math.sin((i / WAVE_RES) * Math.PI * 2);
    return w;
  });
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState("draw"); // draw | line | smooth

  const getCanvasPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
    return { x, y: y * 2 - 1 };
  };

  const updateSample = useCallback((pos) => {
    setWave((prev) => {
      const next = new Float32Array(prev);
      const idx = Math.round(pos.x * (WAVE_RES - 1));
      next[clamp(idx, 0, WAVE_RES - 1)] = clamp(pos.y, -1, 1);
      return next;
    });
  }, []);

  const onPointerDown = (e) => {
    setDrawing(true);
    canvasRef.current.setPointerCapture(e.pointerId);
    if (tool === "draw") updateSample(getCanvasPos(e));
  };
  const onPointerMove = (e) => {
    if (!drawing) return;
    if (tool === "draw") updateSample(getCanvasPos(e));
  };
  const onPointerUp = () => setDrawing(false);

  const smooth = () => {
    setWave((prev) => {
      const next = new Float32Array(WAVE_RES);
      for (let i = 0; i < WAVE_RES; i++) {
        const l = prev[(i - 1 + WAVE_RES) % WAVE_RES];
        const r = prev[(i + 1) % WAVE_RES];
        next[i] = prev[i] * 0.5 + (l + r) * 0.25;
      }
      return next;
    });
  };

  const normalize = () => {
    setWave((prev) => {
      let peak = 0;
      for (let i = 0; i < WAVE_RES; i++) if (Math.abs(prev[i]) > peak) peak = Math.abs(prev[i]);
      if (peak < 0.001) return prev;
      const next = new Float32Array(WAVE_RES);
      for (let i = 0; i < WAVE_RES; i++) next[i] = prev[i] / peak;
      return next;
    });
  };

  const clearWave = () => {
    setWave(new Float32Array(WAVE_RES));
  };

  const loadShape = (fn) => {
    const w = new Float32Array(WAVE_RES);
    let peak = 0;
    for (let i = 0; i < WAVE_RES; i++) {
      const v = clamp(fn(i / WAVE_RES), -1.25, 1.25);
      w[i] = v;
      peak = Math.max(peak, Math.abs(v));
    }
    // Keep every generated preset loud and consistent.
    if (peak > 0.001) {
      const inv = 1 / peak;
      for (let i = 0; i < WAVE_RES; i++) w[i] *= inv;
    }
    setWave(w);
  };

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, w, h);
    // grid
    ctx.strokeStyle = T.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.moveTo(0, h / 4); ctx.lineTo(w, h / 4);
    ctx.moveTo(0, h * 3 / 4); ctx.lineTo(w, h * 3 / 4);
    for (let i = 0; i <= 4; i++) { ctx.moveTo(w * i / 4, 0); ctx.lineTo(w * i / 4, h); }
    ctx.stroke();
    // center line
    ctx.strokeStyle = T.borderHi;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    // waveform
    ctx.strokeStyle = T.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < WAVE_RES; i++) {
      const px = (i / (WAVE_RES - 1)) * w;
      const py = (1 - wave[i]) * h / 2;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // fill
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = T.accent;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    for (let i = 0; i < WAVE_RES; i++) {
      ctx.lineTo((i / (WAVE_RES - 1)) * w, (1 - wave[i]) * h / 2);
    }
    ctx.lineTo(w, h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }, [wave]);

  const btnTool = (lbl, id) => ({
    height: 30, padding: "0 14px", fontSize: 10, fontWeight: 700,
    fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase",
    border: `1px solid ${tool === id ? T.accent : T.border}`,
    borderRadius: 2, cursor: "pointer",
    background: tool === id ? "linear-gradient(180deg, #cc6e08, #a05500)" : "linear-gradient(180deg, #2e2820, #1a1510)",
    color: tool === id ? "#f0e6d2" : T.textDim,
    boxShadow: tool === id ? `0 0 8px ${T.accentGlow}` : "none",
  });
  const btnAction = {
    height: 30, padding: "0 14px", fontSize: 10, fontWeight: 700,
    fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase",
    border: `1px solid ${T.border}`, borderRadius: 2, cursor: "pointer",
    background: "linear-gradient(180deg, #2e2820, #1a1510)", color: T.textDim,
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "20px 20px 40px" }}>
      <Section title="Wave Drawing" icon="✏️">
        <div style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btnTool("Draw", "draw")} onClick={() => setTool("draw")}>✏️ Draw</button>
          <div style={{ width: 1, background: T.border }} />
          <button style={btnAction} onClick={smooth}>Smooth</button>
          <button style={btnAction} onClick={normalize}>Normalize</button>
          <button style={btnAction} onClick={clearWave}>Clear</button>
        </div>
        <canvas
          ref={canvasRef}
          width={800}
          height={300}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            width: "100%", height: 300, borderRadius: T.radius,
            border: `1px solid ${T.border}`, cursor: "crosshair",
            touchAction: "none",
          }}
        />
      </Section>

      <Section title="Load Shape" icon="📐" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
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
          ].map((s) => (
            <button key={s.name} onClick={() => loadShape(s.fn)} style={btnAction}>
              {s.name}
            </button>
          ))}
        </div>
      </Section>

      {onUseWave && (
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <button
            onClick={() => onUseWave(wave)}
            style={{
              height: 42, padding: "0 32px", fontSize: 12, fontWeight: 700,
              fontFamily: T.font, letterSpacing: 1.5, textTransform: "uppercase",
              border: `1px solid rgba(255,180,60,0.3)`,
              borderRadius: 3, cursor: "pointer",
              background: "linear-gradient(180deg, #cc6e08, #a05500)",
              color: "#f0e6d2",
              boxShadow: `0 2px 12px ${T.accentGlow}, inset 0 1px 0 rgba(255,255,255,0.1)`,
            }}
          >
            USE WAVE IN SYNTH →
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  VL-TONE DRUM MACHINE
// ═══════════════════════════════════════════════════════════════════

const VL_PATTERNS = [
  { name: "Rock 1", tempo: 120, steps: { po: [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0], pi: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], sha: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0] } },
  { name: "Rock 2", tempo: 128, steps: { po: [1,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0], pi: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,1], sha: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0] } },
  { name: "March", tempo: 112, steps: { po: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], pi: [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0], sha: [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0] } },
  { name: "Waltz", tempo: 108, steps: { po: [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], pi: [0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0], sha: [1,0,0,1,0,0,1,0,0,1,0,0,0,0,0,0] } },
  { name: "4 Beat", tempo: 120, steps: { po: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], pi: [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0], sha: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0] } },
  { name: "Swing", tempo: 116, steps: { po: [1,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0], pi: [0,0,0,0,1,0,0,1,0,0,0,0,1,0,0,0], sha: [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1] } },
  { name: "Bossa Nova", tempo: 126, steps: { po: [1,0,0,1,0,0,1,0,0,0,1,0,0,1,0,0], pi: [0,0,1,0,0,1,0,0,1,0,0,0,1,0,0,1], sha: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0] } },
  { name: "Samba", tempo: 132, steps: { po: [1,0,0,1,0,0,1,0,1,0,0,1,0,0,1,0], pi: [0,0,1,0,1,0,0,0,0,0,1,0,1,0,0,1], sha: [1,1,1,0,1,1,1,0,1,1,1,0,1,1,1,0] } },
  { name: "Beguine", tempo: 118, steps: { po: [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0], pi: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], sha: [1,0,1,0,0,0,1,0,1,0,1,0,0,0,1,0] } },
  { name: "Rhumba", tempo: 110, steps: { po: [1,0,0,1,0,0,1,0,0,0,0,0,1,0,0,0], pi: [0,0,0,0,1,0,0,0,0,0,1,0,0,0,1,0], sha: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,0,1] } },
];

const DRUM_SOUNDS = [
  { id: "po", label: "Po", desc: "Bass · 30ms", color: T.accent },
  { id: "pi", label: "Pi", desc: "Click · 20ms", color: T.green },
  { id: "sha", label: "Sha", desc: "Noise · 160ms", color: T.amber },
];

function triggerDrumSound(ctx, dest, time, type, params, noiseBuf) {
  if (type === "po") {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(params.pitch * 2, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(params.pitch, 20), time + 0.015);
    g.gain.setValueAtTime(params.volume, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + Math.max(params.decay, 0.005));
    osc.connect(g); g.connect(dest);
    osc.start(time); osc.stop(time + params.decay + 0.05);
  } else if (type === "pi") {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(params.pitch, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(params.pitch * 0.5, 20), time + Math.max(params.decay, 0.005));
    g.gain.setValueAtTime(params.volume * 0.3, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + Math.max(params.decay, 0.005));
    osc.connect(g); g.connect(dest);
    osc.start(time); osc.stop(time + params.decay + 0.05);
  } else if (type === "sha") {
    if (!noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bpf = ctx.createBiquadFilter();
    bpf.type = "bandpass";
    bpf.frequency.value = params.pitch;
    bpf.Q.value = 1.0;
    const g = ctx.createGain();
    g.gain.setValueAtTime(params.volume * 0.4, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + Math.max(params.decay, 0.005));
    src.connect(bpf); bpf.connect(g); g.connect(dest);
    src.start(time); src.stop(time + params.decay + 0.05);
  }
}

const DrumMachine = React.forwardRef(function DrumMachine({ audioCtxRef, gainRef, setupAudio, tempo: sharedTempo, onTempoChange, syncPlaying, syncStartAt, syncEpoch, onToggleSync }, ref) {
  const [steps, setSteps] = useState({
    po:  Array(16).fill(0),
    pi:  Array(16).fill(0),
    sha: Array(16).fill(0),
  });
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [localTempo, setLocalTempo] = useState(120);
  const tempo = sharedTempo ?? localTempo;
  const setTempo = onTempoChange ?? setLocalTempo;
  const [drumParams, setDrumParams] = useState({
    po:  { pitch: 150, decay: 0.03, volume: 0.8 },
    pi:  { pitch: 1000, decay: 0.02, volume: 0.6 },
    sha: { pitch: 6000, decay: 0.16, volume: 0.5 },
  });

  React.useImperativeHandle(ref, () => ({
    getState: () => ({
      steps: { po: [...steps.po], pi: [...steps.pi], sha: [...steps.sha] },
      drumParams: JSON.parse(JSON.stringify(drumParams)),
      drumVolume, padVolume,
    }),
    loadState: (s) => {
      if (s.steps) setSteps({ po: [...s.steps.po], pi: [...s.steps.pi], sha: [...s.steps.sha] });
      if (s.drumParams) setDrumParams(JSON.parse(JSON.stringify(s.drumParams)));
      if (s.drumVolume != null) setDrumVolume(s.drumVolume);
      if (s.padVolume != null) setPadVolume(s.padVolume);
    },
  }));

  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;
  const drumParamsRef = useRef(drumParams);
  drumParamsRef.current = drumParams;
  const currentStepRef = useRef(-1);
  const nextStepTimeRef = useRef(0);
  const timerRef = useRef(null);
  const noiseBufferRef = useRef(null);
  const drumGainRef = useRef(null);
  const [drumVolume, setDrumVolume] = useState(0.8);
  const [padVolume, setPadVolume] = useState(0.85);

  useEffect(() => {
    if (drumGainRef.current) drumGainRef.current.gain.value = drumVolume;
  }, [drumVolume]);

  const ensureNoiseBuf = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return null;
    if (!noiseBufferRef.current) {
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      noiseBufferRef.current = buf;
    }
    return noiseBufferRef.current;
  }, [audioCtxRef]);

  const getDrumDest = useCallback(() => {
    if (drumGainRef.current) return drumGainRef.current;
    const ctx = audioCtxRef.current;
    if (!ctx || !gainRef.current) return null;
    const g = ctx.createGain();
    g.gain.value = 1.0;
    g.connect(gainRef.current);
    drumGainRef.current = g;
    return g;
  }, [audioCtxRef, gainRef]);

  const triggerSound = useCallback((type, time, level = 1) => {
    const ctx = audioCtxRef.current;
    const baseDest = getDrumDest();
    if (!ctx || !baseDest) return;
    const hitGain = ctx.createGain();
    hitGain.gain.value = level;
    hitGain.connect(baseDest);
    triggerDrumSound(ctx, hitGain, time, type, drumParamsRef.current[type], ensureNoiseBuf());
  }, [audioCtxRef, getDrumDest, ensureNoiseBuf]);

  const scheduler = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    while (nextStepTimeRef.current < ctx.currentTime + 0.1) {
      const step = currentStepRef.current;
      const s = stepsRef.current;
      const time = nextStepTimeRef.current;
      if (s.po[step]) triggerSound("po", time);
      if (s.pi[step]) triggerSound("pi", time);
      if (s.sha[step]) triggerSound("sha", time);
      const secondsPerStep = 60.0 / tempoRef.current / 4;
      nextStepTimeRef.current += secondsPerStep;
      currentStepRef.current = (currentStepRef.current + 1) % 16;
      setCurrentStep(currentStepRef.current);
    }
  }, [audioCtxRef, triggerSound]);

  const startSequencerAt = useCallback((startAt) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (timerRef.current) clearInterval(timerRef.current);
    currentStepRef.current = 0;
    nextStepTimeRef.current = startAt ?? (ctx.currentTime + 0.05);
    setCurrentStep(0);
    setPlaying(true);
    timerRef.current = setInterval(scheduler, 25);
  }, [audioCtxRef, scheduler]);

  const stopSequencer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setPlaying(false);
    setCurrentStep(-1);
    currentStepRef.current = -1;
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (syncPlaying) startSequencerAt(syncStartAt);
    else stopSequencer();
  }, [syncPlaying, syncStartAt, syncEpoch, startSequencerAt, stopSequencer]);

  const toggleStep = (sound, idx) => {
    setSteps(prev => {
      const next = { ...prev };
      next[sound] = [...prev[sound]];
      next[sound][idx] = next[sound][idx] ? 0 : 1;
      return next;
    });
  };

  const loadPattern = (pattern) => {
    setSteps({
      po:  [...pattern.steps.po],
      pi:  [...pattern.steps.pi],
      sha: [...pattern.steps.sha],
    });
    setTempo(pattern.tempo);
  };

  const clearPattern = () => {
    setSteps({
      po:  Array(16).fill(0),
      pi:  Array(16).fill(0),
      sha: Array(16).fill(0),
    });
  };

  const preview = async (type) => {
    if (!audioCtxRef.current) await setupAudio();
    else if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();
    triggerSound(type, audioCtxRef.current.currentTime, padVolume);
  };

  const updateParam = (sound, key, val) => {
    setDrumParams(prev => ({
      ...prev,
      [sound]: { ...prev[sound], [key]: val },
    }));
  };

  // ── Drum User Presets (localStorage) ──────────────────────────
  const [drumPresets, setDrumPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem("wavecraft_drum_presets") || "[]"); } catch { return []; }
  });
  const [newDrumPresetName, setNewDrumPresetName] = useState("");

  const saveDrumPreset = () => {
    const name = newDrumPresetName.trim();
    if (!name) return;
    const preset = {
      name,
      steps: { po: [...steps.po], pi: [...steps.pi], sha: [...steps.sha] },
      tempo,
      drumParams: JSON.parse(JSON.stringify(drumParams)),
    };
    const existing = drumPresets.findIndex((p) => p.name === name);
    const next = [...drumPresets];
    if (existing >= 0) next[existing] = preset; else next.push(preset);
    setDrumPresets(next);
    localStorage.setItem("wavecraft_drum_presets", JSON.stringify(next));
    setNewDrumPresetName("");
  };

  const loadDrumPreset = (p) => {
    setSteps({ po: [...p.steps.po], pi: [...p.steps.pi], sha: [...p.steps.sha] });
    setTempo(p.tempo);
    if (p.drumParams) setDrumParams(JSON.parse(JSON.stringify(p.drumParams)));
  };

  const deleteDrumPreset = (name) => {
    const next = drumPresets.filter((p) => p.name !== name);
    setDrumPresets(next);
    localStorage.setItem("wavecraft_drum_presets", JSON.stringify(next));
  };

  const btnPrimary = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    height: 38, padding: "0 18px", borderRadius: 3,
    border: "1px solid rgba(255,180,60,0.3)",
    background: "linear-gradient(180deg, #cc6e08 0%, #a05500 100%)",
    color: "#f0e6d2",
    fontSize: 12, fontWeight: 700, cursor: "pointer",
    fontFamily: T.font, textTransform: "uppercase", letterSpacing: 1,
    boxShadow: `0 2px 8px ${T.accentGlow}, inset 0 1px 0 rgba(255,255,255,0.1)`,
  };
  const btnGhost = {
    ...btnPrimary,
    background: "linear-gradient(180deg, #2e2820 0%, #1a1510 100%)",
    color: T.text,
    border: `1px solid ${T.borderHi}`,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 4px rgba(0,0,0,0.3)",
  };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 20px 40px" }}>
      {/* Transport & Tempo */}
      <Section title="VL-Tone Drum Machine" icon="🥁">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <button
            onClick={onToggleSync}
            style={{
              ...btnPrimary,
              background: playing
                ? `linear-gradient(180deg, ${T.red}, #881a00)`
                : "linear-gradient(180deg, #cc6e08, #a05500)",
              boxShadow: playing
                ? "0 2px 12px rgba(204,51,0,0.4)"
                : `0 2px 8px ${T.accentGlow}`,
            }}
          >
            {playing ? "■ Stop" : "▶ Play"}
          </button>
          <button onClick={clearPattern} style={btnGhost}>Clear</button>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.textDim, fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase" }}>BPM</span>
            <input
              type="range" min={60} max={240} step={1} value={tempo}
              onChange={(e) => setTempo(Number(e.target.value))}
              style={{ width: 120, cursor: "pointer", accentColor: T.accent }}
            />
            <span style={{
              fontSize: 14, fontVariantNumeric: "tabular-nums", color: T.green,
              fontWeight: 700, fontFamily: "'VT323', 'Courier New', monospace",
              textShadow: "0 0 8px rgba(51,255,102,0.5)", minWidth: 32,
            }}>
              {tempo}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.textDim, fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase" }}>VOL</span>
            <input
              type="range" min={0} max={1} step={0.01} value={drumVolume}
              onChange={(e) => setDrumVolume(Number(e.target.value))}
              style={{ width: 80, cursor: "pointer", accentColor: T.accent }}
            />
            <span style={{
              fontSize: 14, fontVariantNumeric: "tabular-nums", color: T.green,
              fontWeight: 700, fontFamily: "'VT323', 'Courier New', monospace",
              textShadow: "0 0 8px rgba(51,255,102,0.5)", minWidth: 28,
            }}>
              {Math.round(drumVolume * 100)}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.textDim, fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase" }}>PAD</span>
            <input
              type="range" min={0} max={1} step={0.01} value={padVolume}
              onChange={(e) => setPadVolume(Number(e.target.value))}
              style={{ width: 80, cursor: "pointer", accentColor: T.accent }}
            />
            <span style={{
              fontSize: 14, fontVariantNumeric: "tabular-nums", color: T.green,
              fontWeight: 700, fontFamily: "'VT323', 'Courier New', monospace",
              textShadow: "0 0 8px rgba(51,255,102,0.5)", minWidth: 28,
            }}>
              {Math.round(padVolume * 100)}
            </span>
          </div>
        </div>

        {/* Step Sequencer Grid */}
        <div style={{ overflowX: "auto" }}>
          {/* Step numbers */}
          <div style={{ display: "flex", gap: 3, marginBottom: 4, paddingLeft: 64 }}>
            {Array.from({ length: 16 }, (_, i) => (
              <div key={i} style={{
                width: 42, textAlign: "center", fontSize: 8, fontWeight: 700,
                color: currentStep === i ? T.green : (i % 4 === 0 ? T.textDim : T.textMuted),
                fontFamily: T.font, letterSpacing: 0.5,
              }}>
                {i + 1}
              </div>
            ))}
          </div>

          {/* Sound rows */}
          {DRUM_SOUNDS.map((sound) => (
            <div key={sound.id} style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 3 }}>
              {/* Sound label + preview button */}
              <button
                onClick={() => preview(sound.id)}
                title={`Preview ${sound.label}`}
                style={{
                  width: 60, height: 42, border: `1px solid ${T.border}`,
                  borderRadius: T.radius, cursor: "pointer",
                  background: "linear-gradient(180deg, #2e2820, #1a1510)",
                  display: "flex", flexDirection: "column", alignItems: "center",
                  justifyContent: "center", gap: 1, padding: 0,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 900, color: sound.color, fontFamily: T.font }}>
                  {sound.label}
                </span>
                <span style={{ fontSize: 7, color: T.textMuted, fontFamily: T.font, letterSpacing: 0.5, textTransform: "uppercase" }}>
                  {sound.desc}
                </span>
              </button>

              {/* Step buttons */}
              {steps[sound.id].map((active, i) => (
                <div
                  key={i}
                  onClick={() => toggleStep(sound.id, i)}
                  style={{
                    width: 42, height: 42, borderRadius: T.radius,
                    border: `1px solid ${
                      currentStep === i ? T.green
                      : active ? sound.color
                      : i % 4 === 0 ? T.borderHi : T.border
                    }`,
                    background: active
                      ? `linear-gradient(180deg, ${sound.color}33, ${sound.color}18)`
                      : (i % 8 < 4 ? T.surface : T.surfaceAlt),
                    cursor: "pointer",
                    transition: "all 60ms",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: currentStep === i
                      ? `0 0 8px ${T.greenGlow}, inset 0 0 12px ${T.greenGlow}`
                      : active ? `inset 0 0 8px ${sound.color}22` : "none",
                  }}
                >
                  {active ? (
                    <div style={{
                      width: 14, height: 14, borderRadius: 2,
                      background: sound.color,
                      boxShadow: `0 0 6px ${sound.color}88`,
                    }} />
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Playback indicator bar */}
        {playing && (
          <div style={{
            marginTop: 8, height: 4, background: T.surface,
            borderRadius: 2, border: `1px solid ${T.border}`,
            position: "relative", overflow: "hidden",
          }}>
            <div style={{
              position: "absolute",
              left: `${(currentStep / 16) * 100}%`,
              width: `${100 / 16}%`,
              top: 0, bottom: 0,
              background: T.green,
              boxShadow: `0 0 6px ${T.greenGlow}`,
              transition: "left 50ms",
            }} />
          </div>
        )}
      </Section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        {/* Rhythm Presets */}
        <Section title="VL-1 Rhythm Presets" icon="🎵">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {VL_PATTERNS.map((p) => (
              <button
                key={p.name}
                onClick={() => loadPattern(p)}
                style={{
                  padding: "8px 10px", borderRadius: 2,
                  border: `1px solid ${T.border}`,
                  background: "linear-gradient(180deg, #2e2820, #1a1510)",
                  color: T.textDim,
                  fontSize: 10, fontWeight: 700, cursor: "pointer",
                  textAlign: "left", transition: "all 80ms",
                  fontFamily: T.font, letterSpacing: 0.8, textTransform: "uppercase",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                }}
              >
                <span style={{ color: T.text }}>{p.name}</span>
                <span style={{ marginLeft: 6, fontSize: 9, color: T.textMuted }}>{p.tempo}bpm</span>
              </button>
            ))}
          </div>
        </Section>

        {/* Sound Parameters */}
        <Section title="Sound Controls" icon="🎛">
          {DRUM_SOUNDS.map((sound) => {
            const p = drumParams[sound.id];
            return (
              <div key={sound.id} style={{
                marginBottom: 12, borderRadius: T.radius,
                border: `1px solid ${T.border}`, background: T.surface,
                padding: "10px 12px",
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: sound.color,
                  fontFamily: T.font, letterSpacing: 1.5, textTransform: "uppercase",
                  marginBottom: 8,
                }}>
                  {sound.label} — {sound.desc}
                </div>
                <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
                  <RotaryKnob
                    label="Pitch"
                    value={p.pitch}
                    onChange={(v) => updateParam(sound.id, "pitch", v)}
                    min={sound.id === "sha" ? 1000 : 40}
                    max={sound.id === "sha" ? 12000 : (sound.id === "pi" ? 4000 : 500)}
                    step={sound.id === "sha" ? 100 : 1}
                    size={44}
                  />
                  <RotaryKnob
                    label="Decay"
                    value={p.decay}
                    onChange={(v) => updateParam(sound.id, "decay", v)}
                    min={0.005}
                    max={sound.id === "sha" ? 0.5 : 0.15}
                    step={0.001}
                    size={44}
                  />
                  <RotaryKnob
                    label="Volume"
                    value={p.volume}
                    onChange={(v) => updateParam(sound.id, "volume", v)}
                    min={0}
                    max={1}
                    step={0.01}
                    size={44}
                  />
                </div>
              </div>
            );
          })}
        </Section>
      </div>

      {/* My Drum Presets */}
      <Section title="My Drum Presets" icon="💾" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <input
            value={newDrumPresetName}
            onChange={(e) => setNewDrumPresetName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveDrumPreset()}
            placeholder="Pattern name…"
            style={{
              flex: 1, height: 36, fontSize: 13, padding: "0 10px",
              background: T.surface, color: T.white,
              border: `1px solid ${T.border}`, borderRadius: 8,
              outline: "none", minWidth: 0, fontFamily: T.font,
            }}
          />
          <button onClick={saveDrumPreset} disabled={!newDrumPresetName.trim()} style={{
            ...btnPrimary, height: 34, padding: "0 14px", fontSize: 10,
            opacity: newDrumPresetName.trim() ? 1 : 0.4,
            cursor: newDrumPresetName.trim() ? "pointer" : "not-allowed",
          }}>
            Save
          </button>
        </div>
        {drumPresets.length === 0 ? (
          <div style={{ fontSize: 12, color: T.textMuted, textAlign: "center", padding: "8px 0" }}>
            No saved drum presets yet
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {drumPresets.map((p) => (
              <div key={p.name} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 10px", borderRadius: 2,
                border: `1px solid ${T.border}`,
                background: "linear-gradient(180deg, #2e2820, #1a1510)",
              }}>
                <button onClick={() => loadDrumPreset(p)} style={{
                  flex: 1, background: "none", border: "none",
                  color: T.text, fontSize: 10, fontWeight: 700,
                  cursor: "pointer", textAlign: "left", padding: 0,
                  fontFamily: T.font, letterSpacing: 0.8, textTransform: "uppercase",
                }}>
                  {p.name}
                </button>
                <span style={{ fontSize: 9, color: T.textMuted, fontFamily: T.font }}>{p.tempo}bpm</span>
                <button onClick={() => deleteDrumPreset(p.name)} title="Delete" style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: T.textMuted, fontSize: 14, padding: "0 2px", lineHeight: 1,
                }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Info */}
      <Section title="About" icon="📖" style={{ marginTop: 12 }}>
        <div style={{ fontSize: 10, lineHeight: 2, color: T.textDim, fontFamily: T.font }}>
          <div>Inspired by the <b style={{ color: T.amber }}>Casio VL-Tone VL-1</b> (1979–1984)</div>
          <div>Three internal drum sounds: <b style={{ color: T.accent }}>Po</b> (bass, 30ms), <b style={{ color: T.green }}>Pi</b> (click, 20ms), <b style={{ color: T.amber }}>Sha</b> (noise, 160ms)</div>
          <div>Used in 10 built-in rhythm patterns — famously heard on Trio's "Da Da Da"</div>
        </div>
      </Section>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
//  PO-32 TONIC DRUM MACHINE
// ═══════════════════════════════════════════════════════════════════

const PO32_SOUNDS = [
  { id: 0,  name: "Kick 1",    short: "KK1", ch: 1, color: "#ff5544" },
  { id: 1,  name: "Snare 1",   short: "SN1", ch: 1, color: "#ff8844" },
  { id: 2,  name: "Shaker",    short: "SHK", ch: 1, color: "#ffaa33" },
  { id: 3,  name: "Zap",       short: "ZAP", ch: 1, color: "#ffcc22" },
  { id: 4,  name: "Kick 2",    short: "KK2", ch: 2, color: "#44ff66" },
  { id: 5,  name: "Snare 2",   short: "SN2", ch: 2, color: "#33ddaa" },
  { id: 6,  name: "Hi-Hat C",  short: "HHC", ch: 2, color: "#33ccdd" },
  { id: 7,  name: "Hi-Hat O",  short: "HHO", ch: 2, color: "#44aaff" },
  { id: 8,  name: "Low Tom",   short: "LTM", ch: 3, color: "#8866ff" },
  { id: 9,  name: "Rimshot",   short: "RIM", ch: 3, color: "#aa55ff" },
  { id: 10, name: "Tamb",      short: "TMB", ch: 3, color: "#cc44ee" },
  { id: 11, name: "Clap",      short: "CLP", ch: 3, color: "#ff44cc" },
  { id: 12, name: "Bass",      short: "BAS", ch: 4, color: "#ff4488" },
  { id: 13, name: "FM",        short: "FM ", ch: 4, color: "#ff6666" },
  { id: 14, name: "Synth",     short: "SYN", ch: 4, color: "#ee8844" },
  { id: 15, name: "Noise",     short: "NOI", ch: 4, color: "#ddaa33" },
];

const PO32_TEMPO_PRESETS = [
  { name: "Hip Hop", bpm: 80 },
  { name: "Disco", bpm: 120 },
  { name: "Techno", bpm: 140 },
];

function triggerPO32Sound(ctx, dest, time, soundId, params, noiseBuf) {
  const pitch = params.pitch;
  const morph = params.morph;

  switch (soundId) {
    case 0: case 4: { // Kick 1, Kick 2
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      const basePitch = soundId === 0 ? pitch * 80 : pitch * 60;
      osc.frequency.setValueAtTime(basePitch * 3, time);
      osc.frequency.exponentialRampToValueAtTime(Math.max(basePitch, 20), time + 0.04 + morph * 0.06);
      const decay = 0.15 + morph * 0.25;
      g.gain.setValueAtTime(0.9, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + decay);
      osc.connect(g); g.connect(dest);
      osc.start(time); osc.stop(time + decay + 0.05);
      // Sub click
      const click = ctx.createOscillator();
      const cg = ctx.createGain();
      click.type = "sine";
      click.frequency.value = basePitch * 1.5;
      cg.gain.setValueAtTime(0.3, time);
      cg.gain.exponentialRampToValueAtTime(0.001, time + 0.01);
      click.connect(cg); cg.connect(dest);
      click.start(time); click.stop(time + 0.05);
      break;
    }
    case 1: case 5: { // Snare 1, Snare 2
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(pitch * 200, time);
      osc.frequency.exponentialRampToValueAtTime(Math.max(pitch * 120, 20), time + 0.05);
      const decay = 0.12 + morph * 0.15;
      og.gain.setValueAtTime(0.5, time);
      og.gain.exponentialRampToValueAtTime(0.001, time + decay);
      osc.connect(og); og.connect(dest);
      osc.start(time); osc.stop(time + decay + 0.05);
      if (noiseBuf) {
        const ns = ctx.createBufferSource(); ns.buffer = noiseBuf;
        const nf = ctx.createBiquadFilter(); nf.type = "highpass";
        nf.frequency.value = soundId === 1 ? 3000 + morph * 4000 : 5000 + morph * 3000;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.6, time);
        ng.gain.exponentialRampToValueAtTime(0.001, time + decay * 1.2);
        ns.connect(nf); nf.connect(ng); ng.connect(dest);
        ns.start(time); ns.stop(time + decay * 1.2 + 0.05);
      }
      break;
    }
    case 2: { // Shaker
      if (!noiseBuf) break;
      const ns = ctx.createBufferSource(); ns.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass";
      bp.frequency.value = 6000 + pitch * 4000; bp.Q.value = 1 + morph * 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.4, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.06 + morph * 0.1);
      ns.connect(bp); bp.connect(g); g.connect(dest);
      ns.start(time); ns.stop(time + 0.2);
      break;
    }
    case 3: { // Zap
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(pitch * 2000, time);
      osc.frequency.exponentialRampToValueAtTime(Math.max(pitch * 100, 20), time + 0.05 + morph * 0.15);
      g.gain.setValueAtTime(0.4, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.08 + morph * 0.12);
      osc.connect(g); g.connect(dest);
      osc.start(time); osc.stop(time + 0.3);
      break;
    }
    case 6: case 7: { // Hi-Hat Closed, Hi-Hat Open
      if (!noiseBuf) break;
      const ns = ctx.createBufferSource(); ns.buffer = noiseBuf;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass";
      hp.frequency.value = 7000 + pitch * 3000;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass";
      bp.frequency.value = 10000; bp.Q.value = 2;
      const g = ctx.createGain();
      const decay = soundId === 6 ? 0.04 + morph * 0.04 : 0.15 + morph * 0.3;
      g.gain.setValueAtTime(0.35, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + decay);
      ns.connect(hp); hp.connect(bp); bp.connect(g); g.connect(dest);
      ns.start(time); ns.stop(time + decay + 0.05);
      // Metallic tone
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 4000 + pitch * 2000;
      og.gain.setValueAtTime(0.08, time);
      og.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.5);
      osc.connect(og); og.connect(dest);
      osc.start(time); osc.stop(time + decay + 0.05);
      break;
    }
    case 8: { // Low Tom
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(pitch * 150, time);
      osc.frequency.exponentialRampToValueAtTime(Math.max(pitch * 60, 20), time + 0.1);
      const decay = 0.2 + morph * 0.3;
      g.gain.setValueAtTime(0.7, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + decay);
      osc.connect(g); g.connect(dest);
      osc.start(time); osc.stop(time + decay + 0.05);
      break;
    }
    case 9: { // Rimshot
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = pitch * 800;
      g.gain.setValueAtTime(0.5, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.03 + morph * 0.02);
      osc.connect(g); g.connect(dest);
      osc.start(time); osc.stop(time + 0.1);
      if (noiseBuf) {
        const ns = ctx.createBufferSource(); ns.buffer = noiseBuf;
        const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 6000;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.3, time);
        ng.gain.exponentialRampToValueAtTime(0.001, time + 0.02);
        ns.connect(hp); hp.connect(ng); ng.connect(dest);
        ns.start(time); ns.stop(time + 0.08);
      }
      break;
    }
    case 10: { // Tambourine
      if (!noiseBuf) break;
      const ns = ctx.createBufferSource(); ns.buffer = noiseBuf;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 8000 + pitch * 2000;
      const g = ctx.createGain();
      const decay = 0.08 + morph * 0.15;
      g.gain.setValueAtTime(0.35, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + decay);
      ns.connect(hp); hp.connect(g); g.connect(dest);
      ns.start(time); ns.stop(time + decay + 0.05);
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 5000 + pitch * 1000;
      og.gain.setValueAtTime(0.05, time);
      og.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.3);
      osc.connect(og); og.connect(dest);
      osc.start(time); osc.stop(time + decay + 0.05);
      break;
    }
    case 11: { // Clap
      if (!noiseBuf) break;
      for (let j = 0; j < 3; j++) {
        const ns = ctx.createBufferSource(); ns.buffer = noiseBuf;
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass";
        bp.frequency.value = 1500 + pitch * 1500; bp.Q.value = 1;
        const g = ctx.createGain();
        const t = time + j * 0.012;
        g.gain.setValueAtTime(0.4, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
        ns.connect(bp); bp.connect(g); g.connect(dest);
        ns.start(t); ns.stop(t + 0.06);
      }
      const tail = ctx.createBufferSource(); tail.buffer = noiseBuf;
      const tbp = ctx.createBiquadFilter(); tbp.type = "bandpass";
      tbp.frequency.value = 1500 + pitch * 1500; tbp.Q.value = 1;
      const tg = ctx.createGain();
      const decay = 0.1 + morph * 0.2;
      tg.gain.setValueAtTime(0.5, time + 0.04);
      tg.gain.exponentialRampToValueAtTime(0.001, time + 0.04 + decay);
      tail.connect(tbp); tbp.connect(tg); tg.connect(dest);
      tail.start(time + 0.04); tail.stop(time + 0.04 + decay + 0.05);
      break;
    }
    case 12: { // Bass
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = morph > 0.5 ? "sawtooth" : "sine";
      osc.frequency.setValueAtTime(pitch * 55, time);
      const decay = 0.2 + morph * 0.4;
      g.gain.setValueAtTime(0.7, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + decay);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
      lp.frequency.setValueAtTime(400 + morph * 2000, time);
      lp.frequency.exponentialRampToValueAtTime(Math.max(100, 100 + morph * 200), time + decay);
      osc.connect(lp); lp.connect(g); g.connect(dest);
      osc.start(time); osc.stop(time + decay + 0.05);
      break;
    }
    case 13: { // FM
      const carrier = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modGain = ctx.createGain();
      const g = ctx.createGain();
      carrier.type = "sine";
      mod.type = "sine";
      carrier.frequency.value = pitch * 200;
      mod.frequency.value = pitch * 200 * (1 + morph * 6);
      modGain.gain.setValueAtTime(pitch * 400 * morph, time);
      modGain.gain.exponentialRampToValueAtTime(1, time + 0.15 + morph * 0.1);
      const decay = 0.1 + morph * 0.2;
      g.gain.setValueAtTime(0.5, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + decay);
      mod.connect(modGain); modGain.connect(carrier.frequency);
      carrier.connect(g); g.connect(dest);
      mod.start(time); carrier.start(time);
      mod.stop(time + decay + 0.1); carrier.stop(time + decay + 0.1);
      break;
    }
    case 14: { // Synth
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = pitch * 220;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
      lp.frequency.setValueAtTime(800 + morph * 6000, time);
      lp.frequency.exponentialRampToValueAtTime(Math.max(200, 200 + morph * 400), time + 0.15);
      lp.Q.value = 2 + morph * 6;
      const decay = 0.1 + morph * 0.2;
      g.gain.setValueAtTime(0.45, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + decay);
      osc.connect(lp); lp.connect(g); g.connect(dest);
      osc.start(time); osc.stop(time + decay + 0.05);
      break;
    }
    case 15: { // Noise
      if (!noiseBuf) break;
      const ns = ctx.createBufferSource(); ns.buffer = noiseBuf;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
      lp.frequency.value = 2000 + pitch * 8000;
      const g = ctx.createGain();
      const decay = 0.05 + morph * 0.3;
      g.gain.setValueAtTime(0.45, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + decay);
      ns.connect(lp); lp.connect(g); g.connect(dest);
      ns.start(time); ns.stop(time + decay + 0.05);
      break;
    }
    default: break;
  }
}

const PO32Tonic = React.forwardRef(function PO32Tonic({ audioCtxRef, gainRef, setupAudio, tempo: sharedTempo, onTempoChange, syncPlaying, syncStartAt, syncEpoch, onToggleSync }, ref) {
  const emptyGrid = () => Array.from({ length: 16 }, () => Array(16).fill(0));
  const [grid, setGrid] = useState(emptyGrid);
  const [accents, setAccents] = useState(() => Array(16).fill(0));
  const [selectedSound, setSelectedSound] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [localTempo, setLocalTempo] = useState(120);
  const tempo = sharedTempo ?? localTempo;
  const setTempo = onTempoChange ?? setLocalTempo;
  const [swing, setSwing] = useState(0);
  const [soundParams, setSoundParams] = useState(() =>
    Array.from({ length: 16 }, () => ({ pitch: 1.0, morph: 0.5 }))
  );
  const [mutedChannels, setMutedChannels] = useState([false, false, false, false]);

  React.useImperativeHandle(ref, () => ({
    getState: () => ({
      grid: grid.map(r => [...r]),
      accents: [...accents],
      swing,
      soundParams: JSON.parse(JSON.stringify(soundParams)),
      mutedChannels: [...mutedChannels],
      po32Volume, padVolume,
    }),
    loadState: (s) => {
      if (s.grid) setGrid(s.grid.map(r => [...r]));
      if (s.accents) setAccents([...s.accents]);
      if (s.swing != null) setSwing(s.swing);
      if (s.soundParams) setSoundParams(JSON.parse(JSON.stringify(s.soundParams)));
      if (s.mutedChannels) setMutedChannels([...s.mutedChannels]);
      if (s.po32Volume != null) setPo32Volume(s.po32Volume);
      if (s.padVolume != null) setPadVolume(s.padVolume);
    },
  }));

  const gridRef = useRef(grid);       gridRef.current = grid;
  const accentsRef = useRef(accents);  accentsRef.current = accents;
  const tempoRef = useRef(tempo);      tempoRef.current = tempo;
  const swingRef = useRef(swing);      swingRef.current = swing;
  const soundParamsRef = useRef(soundParams); soundParamsRef.current = soundParams;
  const mutedRef = useRef(mutedChannels);     mutedRef.current = mutedChannels;
  const currentStepRef = useRef(-1);
  const nextStepTimeRef = useRef(0);
  const timerRef = useRef(null);
  const noiseBufferRef = useRef(null);
  const po32GainRef = useRef(null);
  const stepCountRef = useRef(0);
  const [po32Volume, setPo32Volume] = useState(0.8);
  const [padVolume, setPadVolume] = useState(0.85);

  useEffect(() => {
    if (po32GainRef.current) po32GainRef.current.gain.value = po32Volume;
  }, [po32Volume]);

  const ensureNoiseBuf = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return null;
    if (!noiseBufferRef.current) {
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      noiseBufferRef.current = buf;
    }
    return noiseBufferRef.current;
  }, [audioCtxRef]);

  const getDest = useCallback(() => {
    if (po32GainRef.current) return po32GainRef.current;
    const ctx = audioCtxRef.current;
    if (!ctx || !gainRef.current) return null;
    const g = ctx.createGain(); g.gain.value = 1.0;
    g.connect(gainRef.current);
    po32GainRef.current = g;
    return g;
  }, [audioCtxRef, gainRef]);

  const triggerSound = useCallback((soundId, time, accent, level = 1) => {
    const ctx = audioCtxRef.current;
    const dest = getDest();
    if (!ctx || !dest) return;
    const ch = PO32_SOUNDS[soundId].ch;
    if (mutedRef.current[ch - 1]) return;
    const p = soundParamsRef.current[soundId];
    // Create a per-hit gain to apply accent
    const hitGain = ctx.createGain();
    hitGain.gain.value = (accent ? 1.3 : 0.8) * level;
    hitGain.connect(dest);
    triggerPO32Sound(ctx, hitGain, time, soundId, p, ensureNoiseBuf());
  }, [audioCtxRef, getDest, ensureNoiseBuf]);

  const scheduler = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    while (nextStepTimeRef.current < ctx.currentTime + 0.1) {
      const step = currentStepRef.current;
      const g = gridRef.current;
      const acc = accentsRef.current;
      const time = nextStepTimeRef.current;
      for (let s = 0; s < 16; s++) {
        if (g[s][step]) triggerSound(s, time, acc[step]);
      }
      // Calculate next step time with swing
      const baseInterval = 60.0 / tempoRef.current / 4;
      const swingAmt = swingRef.current;
      const isEven = stepCountRef.current % 2 === 0;
      const interval = isEven
        ? baseInterval * (1 + swingAmt * 0.33)
        : baseInterval * (1 - swingAmt * 0.33);
      nextStepTimeRef.current += interval;
      stepCountRef.current++;
      currentStepRef.current = (currentStepRef.current + 1) % 16;
      setCurrentStep(currentStepRef.current);
    }
  }, [audioCtxRef, triggerSound]);

  const startSequencerAt = useCallback((startAt) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (timerRef.current) clearInterval(timerRef.current);
    currentStepRef.current = 0;
    stepCountRef.current = 0;
    nextStepTimeRef.current = startAt ?? (ctx.currentTime + 0.05);
    setCurrentStep(0);
    setPlaying(true);
    timerRef.current = setInterval(scheduler, 25);
  }, [audioCtxRef, scheduler]);

  const stopSequencer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setPlaying(false);
    setCurrentStep(-1);
    currentStepRef.current = -1;
  }, []);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  useEffect(() => {
    if (syncPlaying) startSequencerAt(syncStartAt);
    else stopSequencer();
  }, [syncPlaying, syncStartAt, syncEpoch, startSequencerAt, stopSequencer]);

  const toggleStep = (sound, idx) => {
    setGrid(prev => {
      const next = prev.map(r => [...r]);
      next[sound][idx] = next[sound][idx] ? 0 : 1;
      return next;
    });
  };

  const toggleAccent = (idx) => {
    setAccents(prev => {
      const next = [...prev];
      next[idx] = next[idx] ? 0 : 1;
      return next;
    });
  };

  const toggleMute = (ch) => {
    setMutedChannels(prev => {
      const next = [...prev];
      next[ch] = !next[ch];
      return next;
    });
  };

  const clearPattern = () => {
    setGrid(emptyGrid());
    setAccents(Array(16).fill(0));
  };

  const preview = async (soundId) => {
    if (!audioCtxRef.current) await setupAudio();
    else if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();
    triggerSound(soundId, audioCtxRef.current.currentTime, false, padVolume);
  };

  const updateSoundParam = (soundId, key, val) => {
    setSoundParams(prev => {
      const next = [...prev];
      next[soundId] = { ...next[soundId], [key]: val };
      return next;
    });
  };

  // ── PO-32 User Presets ──────────────────────────────────────────
  const [po32Presets, setPo32Presets] = useState(() => {
    try { return JSON.parse(localStorage.getItem("wavecraft_po32_presets") || "[]"); } catch { return []; }
  });
  const [newPo32PresetName, setNewPo32PresetName] = useState("");

  const savePo32Preset = () => {
    const name = newPo32PresetName.trim();
    if (!name) return;
    const preset = {
      name, grid: grid.map(r => [...r]), accents: [...accents],
      tempo, swing, soundParams: JSON.parse(JSON.stringify(soundParams)),
    };
    const existing = po32Presets.findIndex(p => p.name === name);
    const next = [...po32Presets];
    if (existing >= 0) next[existing] = preset; else next.push(preset);
    setPo32Presets(next);
    localStorage.setItem("wavecraft_po32_presets", JSON.stringify(next));
    setNewPo32PresetName("");
  };

  const loadPo32Preset = (p) => {
    setGrid(p.grid.map(r => [...r]));
    setAccents([...p.accents]);
    setTempo(p.tempo);
    if (p.swing != null) setSwing(p.swing);
    if (p.soundParams) setSoundParams(JSON.parse(JSON.stringify(p.soundParams)));
  };

  const deletePo32Preset = (name) => {
    const next = po32Presets.filter(p => p.name !== name);
    setPo32Presets(next);
    localStorage.setItem("wavecraft_po32_presets", JSON.stringify(next));
  };

  const btnPrimary = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    height: 38, padding: "0 18px", borderRadius: 3,
    border: "1px solid rgba(255,180,60,0.3)",
    background: "linear-gradient(180deg, #cc6e08 0%, #a05500 100%)",
    color: "#f0e6d2",
    fontSize: 12, fontWeight: 700, cursor: "pointer",
    fontFamily: T.font, textTransform: "uppercase", letterSpacing: 1,
    boxShadow: `0 2px 8px ${T.accentGlow}, inset 0 1px 0 rgba(255,255,255,0.1)`,
  };
  const btnGhost = {
    ...btnPrimary,
    background: "linear-gradient(180deg, #2e2820 0%, #1a1510 100%)",
    color: T.text,
    border: `1px solid ${T.borderHi}`,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 4px rgba(0,0,0,0.3)",
  };

  const sel = PO32_SOUNDS[selectedSound];

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 20px 40px" }}>
      <Section title="PO-32 Tonic" icon="🔲">
        {/* Transport */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <button
            onClick={onToggleSync}
            style={{
              ...btnPrimary,
              background: playing ? `linear-gradient(180deg, ${T.red}, #881a00)` : "linear-gradient(180deg, #cc6e08, #a05500)",
              boxShadow: playing ? "0 2px 12px rgba(204,51,0,0.4)" : `0 2px 8px ${T.accentGlow}`,
            }}
          >
            {playing ? "■ Stop" : "▶ Play"}
          </button>
          <button onClick={clearPattern} style={btnGhost}>Clear</button>

          {/* Tempo presets */}
          <div style={{ display: "flex", gap: 3 }}>
            {PO32_TEMPO_PRESETS.map(tp => (
              <button key={tp.name} onClick={() => setTempo(tp.bpm)} style={{
                height: 28, padding: "0 10px", fontSize: 9, fontWeight: 700,
                fontFamily: T.font, letterSpacing: 0.8, textTransform: "uppercase",
                border: `1px solid ${tempo === tp.bpm ? T.accent : T.border}`,
                borderRadius: 2, cursor: "pointer",
                background: tempo === tp.bpm ? "linear-gradient(180deg, #cc6e08, #a05500)" : "linear-gradient(180deg, #2e2820, #1a1510)",
                color: tempo === tp.bpm ? "#f0e6d2" : T.textDim,
              }}>
                {tp.name}
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.textDim, fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase" }}>BPM</span>
            <input type="range" min={60} max={240} step={1} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} style={{ width: 100, cursor: "pointer", accentColor: T.accent }} />
            <span style={{ fontSize: 14, fontVariantNumeric: "tabular-nums", color: T.green, fontWeight: 700, fontFamily: "'VT323', 'Courier New', monospace", textShadow: "0 0 8px rgba(51,255,102,0.5)", minWidth: 32 }}>{tempo}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.textDim, fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase" }}>VOL</span>
            <input type="range" min={0} max={1} step={0.01} value={po32Volume} onChange={(e) => setPo32Volume(Number(e.target.value))} style={{ width: 80, cursor: "pointer", accentColor: T.accent }} />
            <span style={{ fontSize: 14, fontVariantNumeric: "tabular-nums", color: T.green, fontWeight: 700, fontFamily: "'VT323', 'Courier New', monospace", textShadow: "0 0 8px rgba(51,255,102,0.5)", minWidth: 28 }}>{Math.round(po32Volume * 100)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.textDim, fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase" }}>PAD</span>
            <input type="range" min={0} max={1} step={0.01} value={padVolume} onChange={(e) => setPadVolume(Number(e.target.value))} style={{ width: 80, cursor: "pointer", accentColor: T.accent }} />
            <span style={{ fontSize: 14, fontVariantNumeric: "tabular-nums", color: T.green, fontWeight: 700, fontFamily: "'VT323', 'Courier New', monospace", textShadow: "0 0 8px rgba(51,255,102,0.5)", minWidth: 28 }}>{Math.round(padVolume * 100)}</span>
          </div>
        </div>

        {/* Sound selector — 4×4 grid like the real PO-32 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, fontFamily: T.font, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>
            Sound — {sel.name}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 3 }}>
            {PO32_SOUNDS.map((s) => {
              const active = grid[s.id].some(v => v);
              return (
                <button key={s.id} onClick={() => setSelectedSound(s.id)} style={{
                  height: 36, border: `1px solid ${selectedSound === s.id ? s.color : active ? `${s.color}66` : T.border}`,
                  borderRadius: T.radius, cursor: "pointer", padding: 0,
                  background: selectedSound === s.id
                    ? `linear-gradient(180deg, ${s.color}44, ${s.color}22)`
                    : active ? `${s.color}11` : T.surface,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0,
                  boxShadow: selectedSound === s.id ? `0 0 8px ${s.color}44` : "none",
                }}>
                  <span style={{ fontSize: 9, fontWeight: 900, color: selectedSound === s.id ? s.color : T.textDim, fontFamily: T.font }}>{s.short}</span>
                  <span style={{ fontSize: 7, color: T.textMuted, fontFamily: T.font }}>{s.id + 1}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step grid for selected sound */}
        <div style={{ overflowX: "auto" }}>
          {/* Step numbers */}
          <div style={{ display: "flex", gap: 3, marginBottom: 2, paddingLeft: 2 }}>
            {Array.from({ length: 16 }, (_, i) => (
              <div key={i} style={{
                flex: 1, minWidth: 38, textAlign: "center", fontSize: 8, fontWeight: 700,
                color: currentStep === i ? T.green : (i % 4 === 0 ? T.textDim : T.textMuted),
                fontFamily: T.font,
              }}>
                {i + 1}
              </div>
            ))}
          </div>

          {/* Selected sound steps */}
          <div style={{ display: "flex", gap: 3, marginBottom: 4 }}>
            {grid[selectedSound].map((active, i) => (
              <div key={i} onClick={() => toggleStep(selectedSound, i)} style={{
                flex: 1, minWidth: 38, height: 42, borderRadius: T.radius,
                border: `1px solid ${
                  currentStep === i ? T.green
                  : active ? sel.color
                  : i % 4 === 0 ? T.borderHi : T.border
                }`,
                background: active
                  ? `linear-gradient(180deg, ${sel.color}44, ${sel.color}22)`
                  : (i % 8 < 4 ? T.surface : T.surfaceAlt),
                cursor: "pointer", transition: "all 60ms",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: currentStep === i ? `0 0 8px ${T.greenGlow}, inset 0 0 12px ${T.greenGlow}` : active ? `inset 0 0 8px ${sel.color}22` : "none",
              }}>
                {active ? <div style={{ width: 14, height: 14, borderRadius: 2, background: sel.color, boxShadow: `0 0 6px ${sel.color}88` }} /> : null}
              </div>
            ))}
          </div>

          {/* Accent row */}
          <div style={{ display: "flex", gap: 3, marginBottom: 4 }}>
            {accents.map((acc, i) => (
              <div key={i} onClick={() => toggleAccent(i)} title="Accent" style={{
                flex: 1, minWidth: 38, height: 18, borderRadius: 2,
                border: `1px solid ${acc ? T.amber : T.border}`,
                background: acc ? `${T.amber}22` : "transparent",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 8, fontWeight: 900, color: acc ? T.amber : T.textMuted, fontFamily: T.font,
              }}>
                {acc ? "ACC" : "·"}
              </div>
            ))}
          </div>
        </div>

        {/* Compact overview — all 16 tracks */}
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, fontFamily: T.font, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Pattern Overview
          </div>
          {PO32_SOUNDS.map((s) => (
            <div key={s.id}
              onClick={() => setSelectedSound(s.id)}
              style={{
                display: "flex", alignItems: "center", gap: 2, marginBottom: 1,
                cursor: "pointer", opacity: mutedRef.current[s.ch - 1] ? 0.3 : 1,
                background: selectedSound === s.id ? `${s.color}0a` : "transparent",
                borderRadius: 2, padding: "1px 0",
              }}
            >
              <span style={{
                width: 30, fontSize: 7, fontWeight: 700, color: selectedSound === s.id ? s.color : T.textMuted,
                fontFamily: T.font, textAlign: "right", paddingRight: 4, flexShrink: 0,
              }}>{s.short}</span>
              {grid[s.id].map((active, i) => (
                <div key={i} style={{
                  flex: 1, minWidth: 4, height: 8, borderRadius: 1,
                  background: active ? s.color : (currentStep === i ? `${T.green}33` : T.border),
                  opacity: active ? 1 : 0.3,
                }} />
              ))}
            </div>
          ))}
        </div>

        {/* Playback indicator */}
        {playing && (
          <div style={{
            marginTop: 6, height: 4, background: T.surface,
            borderRadius: 2, border: `1px solid ${T.border}`,
            position: "relative", overflow: "hidden",
          }}>
            <div style={{
              position: "absolute", left: `${(currentStep / 16) * 100}%`, width: `${100 / 16}%`,
              top: 0, bottom: 0, background: T.green,
              boxShadow: `0 0 6px ${T.greenGlow}`, transition: "left 50ms",
            }} />
          </div>
        )}
      </Section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        {/* Sound Controls */}
        <Section title={`Sound: ${sel.name}`} icon="🎛">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <button onClick={() => preview(selectedSound)} style={{
              ...btnGhost, height: 30, padding: "0 14px", fontSize: 10,
            }}>
              ▶ Preview
            </button>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: sel.color, boxShadow: `0 0 6px ${sel.color}66` }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: sel.color, fontFamily: T.font, letterSpacing: 1 }}>{sel.name}</span>
          </div>
          <div style={{ display: "flex", gap: 24, justifyContent: "center" }}>
            <RotaryKnob
              label="A · Pitch"
              value={soundParams[selectedSound].pitch}
              onChange={(v) => updateSoundParam(selectedSound, "pitch", v)}
              min={0.25} max={4} step={0.01} size={56}
            />
            <RotaryKnob
              label="B · Morph"
              value={soundParams[selectedSound].morph}
              onChange={(v) => updateSoundParam(selectedSound, "morph", v)}
              min={0} max={1} step={0.01} size={56}
            />
          </div>
        </Section>

        {/* Mixer / Channels */}
        <Section title="Mixer" icon="🎚">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <RotaryKnob label="Swing" value={swing} onChange={setSwing} min={0} max={1} step={0.01} size={48} />
          </div>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, fontFamily: T.font, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>
            Channels
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {[1, 2, 3, 4].map(ch => {
              const chSounds = PO32_SOUNDS.filter(s => s.ch === ch);
              const muted = mutedChannels[ch - 1];
              return (
                <div key={ch} onClick={() => toggleMute(ch - 1)} style={{
                  padding: "6px 10px", borderRadius: T.radius,
                  border: `1px solid ${muted ? T.border : chSounds[0].color + "44"}`,
                  background: muted ? T.surfaceAlt : `${chSounds[0].color}0a`,
                  cursor: "pointer", transition: "all 80ms",
                  opacity: muted ? 0.4 : 1,
                }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: muted ? T.textMuted : T.text, fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 }}>
                    Ch {ch} {muted ? "(Muted)" : ""}
                  </div>
                  <div style={{ fontSize: 8, color: T.textMuted, fontFamily: T.font }}>
                    {chSounds.map(s => s.short).join(" · ")}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      </div>

      {/* My PO-32 Presets */}
      <Section title="My PO-32 Presets" icon="💾" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <input
            value={newPo32PresetName}
            onChange={(e) => setNewPo32PresetName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && savePo32Preset()}
            placeholder="Pattern name…"
            style={{
              flex: 1, height: 36, fontSize: 13, padding: "0 10px",
              background: T.surface, color: T.white,
              border: `1px solid ${T.border}`, borderRadius: 8,
              outline: "none", minWidth: 0, fontFamily: T.font,
            }}
          />
          <button onClick={savePo32Preset} disabled={!newPo32PresetName.trim()} style={{
            ...btnPrimary, height: 34, padding: "0 14px", fontSize: 10,
            opacity: newPo32PresetName.trim() ? 1 : 0.4,
            cursor: newPo32PresetName.trim() ? "pointer" : "not-allowed",
          }}>
            Save
          </button>
        </div>
        {po32Presets.length === 0 ? (
          <div style={{ fontSize: 12, color: T.textMuted, textAlign: "center", padding: "8px 0" }}>
            No saved PO-32 presets yet
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {po32Presets.map((p) => (
              <div key={p.name} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 10px", borderRadius: 2,
                border: `1px solid ${T.border}`,
                background: "linear-gradient(180deg, #2e2820, #1a1510)",
              }}>
                <button onClick={() => loadPo32Preset(p)} style={{
                  flex: 1, background: "none", border: "none",
                  color: T.text, fontSize: 10, fontWeight: 700,
                  cursor: "pointer", textAlign: "left", padding: 0,
                  fontFamily: T.font, letterSpacing: 0.8, textTransform: "uppercase",
                }}>
                  {p.name}
                </button>
                <span style={{ fontSize: 9, color: T.textMuted, fontFamily: T.font }}>{p.tempo}bpm</span>
                <button onClick={() => deletePo32Preset(p.name)} title="Delete" style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: T.textMuted, fontSize: 14, padding: "0 2px", lineHeight: 1,
                }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════
export default function GraphingCalculatorSynthApp() {
  const [page, setPage] = useState("synth"); // "synth" | "draw" | "drums"
  const [drumBpm, setDrumBpm] = useState(120);
  const [drumsPlaying, setDrumsPlaying] = useState(false);
  const [drumSyncStartAt, setDrumSyncStartAt] = useState(0);
  const [drumSyncEpoch, setDrumSyncEpoch] = useState(0);
  const drumMachineRef = useRef(null);
  const po32Ref = useRef(null);
  const [equationInput, setEquationInput] = useState(DEFAULT_EQ);
  const [equation, setEquation] = useState(DEFAULT_EQ);
  const [xScale, setXScale] = useState(1);
  const [yScale, setYScale] = useState(1);
  const [a, setA] = useState(1);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  const [d, setD] = useState(0);
  const [openEffect, setOpenEffect] = useState(null);
  const [fxParams, setFxParams] = useState(() => withFxDefaults());
  const [fxOrder, setFxOrder] = useState(["distortion", "chorus", "delay", "reverb"]);
  const [audioReady, setAudioReady] = useState(false);
  const [midiStatus, setMidiStatus] = useState("No MIDI connected");
  const [activeNotes, setActiveNotes] = useState([]);
  const [masterVolume, setMasterVolume] = useState(0.18);
  const [sampleRate, setSampleRate] = useState(44100);
  const [adsr, setAdsr] = useState({ ...DEFAULT_ADSR });
  const [filter, setFilter] = useState({ ...DEFAULT_FILTER });
  const [add7th, setAdd7th] = useState(false);

  // ── Auth & Cloud Presets ──────────────────────────────────────────
  const [authToken, setAuthToken] = useState(() => localStorage.getItem("wavecraft_token") || null);
  const [authUser, setAuthUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("wavecraft_user") || "null"); } catch { return null; }
  });
  const [authModal, setAuthModal] = useState(null); // null | "login" | "signup"
  const [authForm, setAuthForm] = useState({ email: "", password: "", displayName: "" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [cloudPresets, setCloudPresets] = useState([]);
  const [cloudLoading, setCloudLoading] = useState(false);

  const apiFetch = async (path, opts = {}) => {
    const headers = { "Content-Type": "application/json", ...opts.headers };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    const res = await fetch(path, { ...opts, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  };

  const doLogin = async () => {
    setAuthError(""); setAuthLoading(true);
    try {
      const { token, user } = await apiFetch("/api/login", {
        method: "POST", body: JSON.stringify({ email: authForm.email, password: authForm.password }),
      });
      setAuthToken(token); setAuthUser(user);
      localStorage.setItem("wavecraft_token", token);
      localStorage.setItem("wavecraft_user", JSON.stringify(user));
      setAuthModal(null); setAuthForm({ email: "", password: "", displayName: "" });
      fetchCloudPresets(token);
    } catch (e) { setAuthError(e.message); }
    setAuthLoading(false);
  };

  const doSignup = async () => {
    setAuthError(""); setAuthLoading(true);
    try {
      const { token, user } = await apiFetch("/api/signup", {
        method: "POST", body: JSON.stringify({ email: authForm.email, password: authForm.password, displayName: authForm.displayName }),
      });
      setAuthToken(token); setAuthUser(user);
      localStorage.setItem("wavecraft_token", token);
      localStorage.setItem("wavecraft_user", JSON.stringify(user));
      setAuthModal(null); setAuthForm({ email: "", password: "", displayName: "" });
      fetchCloudPresets(token);
    } catch (e) { setAuthError(e.message); }
    setAuthLoading(false);
  };

  const doLogout = () => {
    setAuthToken(null); setAuthUser(null); setCloudPresets([]);
    localStorage.removeItem("wavecraft_token");
    localStorage.removeItem("wavecraft_user");
  };

  const fetchCloudPresets = async (token) => {
    setCloudLoading(true);
    try {
      const headers = { Authorization: `Bearer ${token || authToken}` };
      const { presets } = await apiFetch("/api/presets", { headers });
      setCloudPresets(presets);
    } catch { /* silently fail — user can retry */ }
    setCloudLoading(false);
  };

  const saveCloudPreset = async (name) => {
    if (!authToken || !name) return;
    const data = {
      eq: equationInput, a, b, c, d, xScale, yScale, masterVolume,
      adsr: { ...DEFAULT_ADSR, ...adsr },
      filter: { ...DEFAULT_FILTER, ...filter },
      fxParams: withFxDefaults(fxParams),
      add7th, lfos: JSON.parse(JSON.stringify(lfos)),
      drawnWave: drawnWaveRef.current ? Array.from(drawnWaveRef.current) : null,
    };
    await apiFetch("/api/presets", { method: "POST", body: JSON.stringify({ name, data }) });
    fetchCloudPresets();
  };

  const loadCloudPreset = async (id) => {
    try {
      const { preset } = await apiFetch(`/api/presets/${id}`);
      loadUserPreset(preset.data);
    } catch { /* ignore */ }
  };

  const deleteCloudPreset = async (id) => {
    await apiFetch(`/api/presets/${id}`, { method: "DELETE" });
    fetchCloudPresets();
  };

  // Fetch cloud presets on mount if logged in
  useEffect(() => {
    if (authToken) fetchCloudPresets();
  }, []);

  // ── LFO state ──────────────────────────────────────────────────────
  const [lfos, setLfos] = useState([
    { ...DEFAULT_LFO },
    { ...DEFAULT_LFO, target: "b" },
    { ...DEFAULT_LFO, target: "cutoff" },
  ]);
  const lfosRef = useRef(lfos);
  lfosRef.current = lfos;
  const lfoPhaseRef = useRef([0, 0, 0]);
  const lfoSHRef = useRef([0, 0, 0]); // sample & hold values
  const lfoOutputRef = useRef([0, 0, 0]); // current LFO output for display
  const lfoBaseRef = useRef({ a: 1, b: 0, c: 0, d: 0, cutoff: 18000, resonance: 0.7, volume: 0.18 });
  const [lfoUiTick, setLfoUiTick] = useState(0);

  const updateLfo = (idx, key, val) => {
    setLfos((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: val };
      return next;
    });
  };

  // Drive knob animation in React UI so LFO movement is visible on dials.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (ts) => {
      raf = requestAnimationFrame(tick);
      if (ts - last < 33) return; // ~30fps UI updates
      last = ts;
      const active = lfosRef.current.some((l) => l.enabled && l.depth !== 0);
      if (active) setLfoUiTick((n) => (n + 1) % 1000000);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const lfoUiMod = useCallback((target) => {
    let mod = 0;
    for (let i = 0; i < lfosRef.current.length; i++) {
      const l = lfosRef.current[i];
      if (!l.enabled || l.depth === 0 || l.target !== target) continue;
      mod += (lfoOutputRef.current[i] || 0) * l.depth;
    }
    return mod;
  }, []);

  const lfoDisplay = useMemo(() => {
    const modA = lfoUiMod("a");
    const modB = lfoUiMod("b");
    const modC = lfoUiMod("c");
    const modD = lfoUiMod("d");
    const modCutoff = lfoUiMod("cutoff");
    const modReso = lfoUiMod("resonance");
    const modVol = lfoUiMod("volume");
    return {
      a: modA,
      b: modB,
      c: modC,
      d: modD,
      // For cutoff, convert the bipolar LFO to an additive offset in Hz
      cutoff: filter.cutoff * (Math.pow(2, modCutoff * 2) - 1),
      resonance: modReso * 10,
      volume: modVol * 0.3,
    };
  }, [a, b, c, d, filter.cutoff, filter.resonance, masterVolume, lfoUiTick, lfoUiMod]);

  // ── User Presets (localStorage) ──────────────────────────────────
  const [userPresets, setUserPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem("wavecraft_presets") || "[]"); } catch { return []; }
  });
  const [newPresetName, setNewPresetName] = useState("");

  const saveUserPreset = () => {
    const name = newPresetName.trim();
    if (!name) return;
    const preset = {
      name,
      eq: equationInput,
      a, b, c, d,
      xScale, yScale,
      masterVolume,
      adsr: { ...DEFAULT_ADSR, ...adsr },
      filter: { ...DEFAULT_FILTER, ...filter },
      fxParams: withFxDefaults(fxParams),
      add7th,
      lfos: JSON.parse(JSON.stringify(lfos)),
      drawnWave: drawnWaveRef.current ? Array.from(drawnWaveRef.current) : null,
    };
    const existing = userPresets.findIndex((p) => p.name === name);
    const next = [...userPresets];
    if (existing >= 0) next[existing] = preset; else next.push(preset);
    setUserPresets(next);
    localStorage.setItem("wavecraft_presets", JSON.stringify(next));
    setNewPresetName("");
  };

  const loadUserPreset = (p) => {
    if (p.drawnWave) {
      drawnWaveRef.current = new Float32Array(p.drawnWave);
      setEquationInput("[drawn wave]"); setEquation("[drawn wave]");
    } else {
      drawnWaveRef.current = null;
      setEquationInput(p.eq); setEquation(p.eq); lastEquationRef.current = p.eq;
      compileEquation(p.eq);
    }
    setA(p.a); setB(p.b); setC(p.c); setD(p.d);
    if (p.xScale != null) setXScale(p.xScale);
    if (p.yScale != null) setYScale(p.yScale);
    if (p.masterVolume != null) setMasterVolume(p.masterVolume);
    setAdsr({ ...DEFAULT_ADSR, ...(p.adsr || {}) });
    setFilter({ ...DEFAULT_FILTER, ...(p.filter || {}) });
    setFxParams(withFxDefaults(p.fxParams || {}));
    if (p.add7th != null) setAdd7th(p.add7th);
    if (p.lfos) setLfos(p.lfos);
  };

  const deleteUserPreset = (name) => {
    const next = userPresets.filter((p) => p.name !== name);
    setUserPresets(next);
    localStorage.setItem("wavecraft_presets", JSON.stringify(next));
  };

  // Recording / playback state
  const [recState, setRecState] = useState("idle"); // idle | countdown | recording | playing
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef(null);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [recordedEvents, setRecordedEvents] = useState([]);
  const [playbackPos, setPlaybackPos] = useState(0);
  const [recDuration, setRecDuration] = useState(0);
  const [audioExporting, setAudioExporting] = useState(false);
  const [trimStart, setTrimStart] = useState(0);   // 0..1 normalized
  const [trimEnd, setTrimEnd] = useState(1);         // 0..1 normalized
  const [trimming, setTrimming] = useState(false);
  const recStartRef = useRef(0);
  const recEventsRef = useRef([]);
  const playTimerRef = useRef(null);
  const playStartRef = useRef(0);
  const playIdxRef = useRef(0);
  const playHeldRef = useRef(new Set());
  const mediaRecRef = useRef(null);
  const mediaChunksRef = useRef([]);
  const recStateRef = useRef("idle");

  const audioCtxRef = useRef(null);
  const processorRef = useRef(null);
  const gainRef = useRef(null);
  const midiAccessRef = useRef(null);
  const heldNotesRef = useRef(new Map());
  const phaseRef = useRef(new Map());
  const lastEquationRef = useRef(DEFAULT_EQ);
  const compiledEqRef = useRef(null);
  const fxNodesRef = useRef(null);
  const filterNodeRef = useRef(null);
  const analyserRef = useRef(null);
  const drawnWaveRef = useRef(null);
  const reverbDecayRef = useRef(2.0);

  // Compile equation once, re-compile only when it changes
  const compileEquation = useCallback((eq) => {
    try { compiledEqRef.current = compile(eq); } catch { compiledEqRef.current = null; }
  }, []);

  // Initial compilation
  if (!compiledEqRef.current) compileEquation(DEFAULT_EQ);

  const params = useMemo(() => ({ a, b, c, d }), [a, b, c, d]);

  // Live params ref for audio thread
  const paramsRef = useRef({ a, b, c, d });
  paramsRef.current = { a, b, c, d };

  const scaleRef = useRef({ x: xScale, y: yScale });
  scaleRef.current = { x: xScale, y: yScale };

  const adsrRef = useRef(adsr);
  adsrRef.current = adsr;

  const buildSampleRef = useRef(null);
  buildSampleRef.current = (t, freq, velocity, note, smoothed) => {
    try {
      const { x: xs, y: ys } = scaleRef.current;
      const x = t * freq * 2 * Math.PI * xs;
      // If a drawn wave is loaded, use wavetable lookup instead of equation
      const dw = drawnWaveRef.current;
      if (dw) {
        const phase = ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const idx = (phase / (Math.PI * 2)) * dw.length;
        const i0 = Math.floor(idx) % dw.length;
        const i1 = (i0 + 1) % dw.length;
        const frac = idx - Math.floor(idx);
        const raw = dw[i0] * (1 - frac) + dw[i1] * frac;
        return Math.tanh(raw * ys);
      }
      const { a: pa, b: pb, c: pc, d: pd } = smoothed || paramsRef.current;
      const eq = compiledEqRef.current;
      if (!eq) return 0;
      const raw = eq.evaluate({
        x, t, freq, note, velocity,
        a: pa, b: pb, c: pc, d: pd,
        pi: Math.PI, e: Math.E,
      });
      if (!Number.isFinite(raw)) return 0;
      return Math.tanh(raw * ys);
    } catch { return 0; }
  };

  // ── Audio engine ──────────────────────────────────────────────────
  const setupAudio = async () => {
    if (audioCtxRef.current) {
      await audioCtxRef.current.resume();
      setAudioReady(true);
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctor();
    const gain = ctx.createGain();
    gain.gain.value = masterVolume;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    gain.connect(analyser);
    analyser.connect(ctx.destination);
    analyserRef.current = analyser;

    // ── Effects chain (reverse order: reverb → delay → chorus → distortion) ──
    const reverbDry = ctx.createGain();  reverbDry.gain.value = 1;
    const reverbWet = ctx.createGain();  reverbWet.gain.value = 0;
    const convolver = ctx.createConvolver();
    convolver.buffer = generateIR(ctx, 2.0);
    const reverbIn = ctx.createGain();
    reverbIn.connect(reverbDry);  reverbIn.connect(convolver);
    convolver.connect(reverbWet);

    const delayDry = ctx.createGain();   delayDry.gain.value = 1;
    const delayWet = ctx.createGain();   delayWet.gain.value = 0;
    const delayNode = ctx.createDelay(2.0);
    delayNode.delayTime.value = 0.35;
    const delayFb = ctx.createGain();    delayFb.gain.value = 0.4;
    const delayIn = ctx.createGain();
    delayIn.connect(delayDry);  delayIn.connect(delayNode);
    delayNode.connect(delayFb);  delayFb.connect(delayNode);
    delayNode.connect(delayWet);

    const chorusDry = ctx.createGain();  chorusDry.gain.value = 1;
    const chorusWet = ctx.createGain();  chorusWet.gain.value = 0;
    const chorusDl = ctx.createDelay(0.05);
    chorusDl.delayTime.value = 0.006;
    const chorusLfo = ctx.createOscillator();
    chorusLfo.type = "sine";  chorusLfo.frequency.value = 1.5;
    const chorusDepth = ctx.createGain();
    chorusDepth.gain.value = 0.003;
    chorusLfo.connect(chorusDepth);
    chorusDepth.connect(chorusDl.delayTime);
    chorusLfo.start();
    const chorusIn = ctx.createGain();
    chorusIn.connect(chorusDry);  chorusIn.connect(chorusDl);
    chorusDl.connect(chorusWet);

    const distNode = ctx.createWaveShaper();
    distNode.oversample = "4x";
    const distDry = ctx.createGain();
    const distWet = ctx.createGain();
    distDry.gain.value = 1;
    distWet.gain.value = 0;
    const distFilter = ctx.createBiquadFilter();
    distFilter.type = "lowpass";
    distFilter.frequency.value = 20000;

    const voiceFilter = ctx.createBiquadFilter();
    voiceFilter.type = "allpass";
    voiceFilter.frequency.value = 18000;
    voiceFilter.Q.value = 0.7;
    const distIn = ctx.createGain();
    distIn.connect(distDry);
    distIn.connect(distNode);
    distNode.connect(distFilter);
    distFilter.connect(distWet);

    fxNodesRef.current = {
      distortion: { in: distIn, node: distNode, filter: distFilter, dry: distDry, wet: distWet },
      chorus:     { in: chorusIn, dry: chorusDry, wet: chorusWet, lfo: chorusLfo, depth: chorusDepth, dl: chorusDl },
      delay:      { in: delayIn, dry: delayDry, wet: delayWet, node: delayNode, fb: delayFb },
      reverb:     { in: reverbIn, dry: reverbDry, wet: reverbWet, conv: convolver },
    };
    filterNodeRef.current = voiceFilter;

    // Wire effects chain based on current order
    rewireFxChain(fxOrder, gain, voiceFilter);

    const processor = ctx.createScriptProcessor(2048, 0, 1);
    // Smooth param interpolation to prevent LFO-induced clicks
    const smoothParams = { a: 1, b: 0, c: 0, d: 0 };
    const paramSmooth = 0.999; // per-sample exponential smoothing coefficient (~20ms at 48kHz)
    processor.onaudioprocess = (ev) => {
      const out = ev.outputBuffer.getChannelData(0);
      const notes = Array.from(heldNotesRef.current.entries());
      for (let i = 0; i < out.length; i++) {
        // Read target params per-sample so LFO changes are tracked smoothly
        const targetParams = paramsRef.current;
        // Per-sample exponential smoothing of equation params
        smoothParams.a += (targetParams.a - smoothParams.a) * (1 - paramSmooth);
        smoothParams.b += (targetParams.b - smoothParams.b) * (1 - paramSmooth);
        smoothParams.c += (targetParams.c - smoothParams.c) * (1 - paramSmooth);
        smoothParams.d += (targetParams.d - smoothParams.d) * (1 - paramSmooth);
        if (!notes.length) { out[i] = 0; continue; }
        let mix = 0;
        for (const [, ns] of notes) {
          const { attack, decay, sustain } = adsrRef.current;
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
          const p = phaseRef.current.get(ns.note) || 0;
          mix += buildSampleRef.current(p / ctx.sampleRate, ns.freq, ns.velocity, ns.note, smoothParams) * 0.28 * ns.envGain * ns.velocity;
          phaseRef.current.set(ns.note, p + 1);
        }
        out[i] = clamp(mix, -1, 1);
      }
      // Clean up finished release envelopes
      for (const [key, ns] of notes) {
        if (ns.stage === "release" && ns.envGain <= 0) {
          heldNotesRef.current.delete(key);
          phaseRef.current.delete(key);
        }
      }
    };
    processor.connect(voiceFilter);

    audioCtxRef.current = ctx;
    processorRef.current = processor;
    gainRef.current = gain;
    setAudioReady(true);
    setSampleRate(ctx.sampleRate);
  };

  const refreshActiveNotes = () => {
    setActiveNotes(
      [...heldNotesRef.current.entries()]
        .filter(([, voice]) => voice.stage !== "release")
        .map(([note]) => note)
        .sort((left, right) => left - right)
    );
  };

  const noteOn = async (note, velocity = 0.8) => {
    if (!audioCtxRef.current) await setupAudio();
    else if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();
    const existing = heldNotesRef.current.get(note);
    if (existing) {
      existing.velocity = velocity;
      existing.stage = "attack";
      existing.releaseStep = 0;
    } else {
      heldNotesRef.current.set(note, {
        note,
        velocity,
        freq: midiToFreq(note),
        envGain: 0,
        stage: "attack",
        releaseStep: 0,
      });
      if (!phaseRef.current.has(note)) phaseRef.current.set(note, 0);
    }
    refreshActiveNotes();
  };

  const noteOff = (note) => {
    const ns = heldNotesRef.current.get(note);
    if (ns) {
      ns.stage = "release";
      ns.releaseStep = Math.max(
        ns.envGain / Math.max(1, adsrRef.current.release * (audioCtxRef.current?.sampleRate || 44100)),
        1e-5
      );
    }
    refreshActiveNotes();
  };

  useEffect(() => { if (gainRef.current) gainRef.current.gain.value = masterVolume; }, [masterVolume]);

  useEffect(() => {
    const filterNode = filterNodeRef.current;
    if (!filterNode) return;
    filterNode.type = filter.type;
    filterNode.frequency.value = filter.cutoff;
    filterNode.Q.value = filter.resonance;
  }, [filter]);

  // ── Sync effect parameters to audio nodes ─────────────────────────
  useEffect(() => {
    const fx = fxNodesRef.current;
    if (!fx) return;
    const ctx = audioCtxRef.current;
    const dp = fxParams.distortion;
    if (dp.enabled) {
      const k = clamp(dp.drive, 1, 30);
      const n = 256;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        const xs = clamp(x + (dp.asym || 0) * (x * x - 0.33), -1.2, 1.2);
        const soft = Math.tanh(k * xs);
        const hard = (2 / Math.PI) * Math.atan((k * 1.8) * xs);
        curve[i] = clamp(soft * 0.72 + hard * 0.28, -1, 1);
      }
      fx.distortion.node.curve = curve;
      fx.distortion.filter.frequency.value = 350 + dp.tone * 18000;
      fx.distortion.wet.gain.value = dp.mix;
      fx.distortion.dry.gain.value = 1 - dp.mix;
    } else {
      fx.distortion.node.curve = null;
      fx.distortion.filter.frequency.value = 20000;
      fx.distortion.wet.gain.value = 0;
      fx.distortion.dry.gain.value = 1;
    }
    const cp = fxParams.chorus;
    fx.chorus.wet.gain.value = cp.enabled ? cp.mix : 0;
    fx.chorus.lfo.frequency.value = cp.rate;
    fx.chorus.depth.gain.value = cp.depth;
    const dl = fxParams.delay;
    fx.delay.wet.gain.value = dl.enabled ? dl.mix : 0;
    fx.delay.node.delayTime.value = dl.time;
    fx.delay.fb.gain.value = dl.feedback;
    const rp = fxParams.reverb;
    fx.reverb.wet.gain.value = rp.enabled ? rp.mix : 0;
  }, [fxParams]);

  useEffect(() => {
    const ctx = audioCtxRef.current;
    const fx = fxNodesRef.current;
    if (!ctx || !fx || fxParams.reverb.decay === reverbDecayRef.current) return;
    reverbDecayRef.current = fxParams.reverb.decay;
    fx.reverb.conv.buffer = generateIR(ctx, fxParams.reverb.decay);
  }, [fxParams.reverb.decay]);

  // ── Rewire effects chain when order changes ───────────────────────
  const rewireFxChain = useCallback((order, masterOverride, vfOverride) => {
    const fx = fxNodesRef.current;
    const vf = vfOverride || filterNodeRef.current;
    const master = masterOverride || gainRef.current;
    if (!fx || !vf || !master) return;
    const ids = ["distortion", "chorus", "delay", "reverb"];
    // Disconnect inter-effect wiring (dry/wet outputs + voiceFilter output)
    vf.disconnect();
    for (const id of ids) { fx[id].dry.disconnect(); fx[id].wet.disconnect(); }
    // Reconnect based on order
    vf.connect(fx[order[0]].in);
    for (let i = 0; i < order.length - 1; i++) {
      fx[order[i]].dry.connect(fx[order[i + 1]].in);
      fx[order[i]].wet.connect(fx[order[i + 1]].in);
    }
    const last = order[order.length - 1];
    fx[last].dry.connect(master);
    fx[last].wet.connect(master);
  }, []);

  useEffect(() => {
    rewireFxChain(fxOrder);
  }, [fxOrder, rewireFxChain]);

  // ── LFO modulation loop ───────────────────────────────────────────
  useEffect(() => {
    let lastTime = performance.now();
    let animId;
    // Smoothing constant for parameter interpolation (avoids zipper noise)
    const smoothTime = 0.03; // ~30ms exponential ramp for filter/gain
    const tick = () => {
      animId = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      const currentLfos = lfosRef.current;
      let anyActive = false;
      // Snapshot base values for modulation targets
      const bases = lfoBaseRef.current;
      // Accumulate modulations per target
      const mods = { a: 0, b: 0, c: 0, d: 0, cutoff: 0, resonance: 0, volume: 0 };
      for (let i = 0; i < 3; i++) {
        const l = currentLfos[i];
        if (!l.enabled || l.depth === 0) { lfoOutputRef.current[i] = 0; continue; }
        anyActive = true;
        lfoPhaseRef.current[i] += l.rate * dt;
        const ph = lfoPhaseRef.current[i];
        // S&H: resample at each cycle
        if (l.shape === "s&h") {
          const prevPh = ph - l.rate * dt;
          if (Math.floor(ph) !== Math.floor(prevPh)) {
            lfoSHRef.current[i] = Math.random() * 2 - 1;
          }
        }
        const val = lfoSample(l.shape, ph, lfoSHRef.current[i]);
        lfoOutputRef.current[i] = val;
        mods[l.target] += val * l.depth;
      }
      if (!anyActive) return;
      // Apply modulations to params ref (audio thread reads these)
      paramsRef.current = {
        a: bases.a + mods.a,
        b: bases.b + mods.b,
        c: bases.c + mods.c,
        d: bases.d + mods.d,
      };
      // Apply filter and gain modulations using setTargetAtTime for click-free smoothing
      const ctx = audioCtxRef.current;
      const t = ctx ? ctx.currentTime : 0;
      const filterNode = filterNodeRef.current;
      if (filterNode && ctx) {
        if (mods.cutoff !== 0) {
          const modded = clamp(bases.cutoff * Math.pow(2, mods.cutoff * 2), 60, 20000);
          filterNode.frequency.setTargetAtTime(modded, t, smoothTime);
        }
        if (mods.resonance !== 0) {
          filterNode.Q.setTargetAtTime(clamp(bases.resonance + mods.resonance * 10, 0.1, 20), t, smoothTime);
        }
      }
      if (gainRef.current && ctx && mods.volume !== 0) {
        gainRef.current.gain.setTargetAtTime(clamp(bases.volume + mods.volume * 0.3, 0, 0.5), t, smoothTime);
      }
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Keep LFO base values in sync with UI state
  useEffect(() => {
    lfoBaseRef.current = { a, b, c, d, cutoff: filter.cutoff, resonance: filter.resonance, volume: masterVolume };
    // Also reset paramsRef when base values change (so non-LFO'd params stay correct)
    paramsRef.current = { a, b, c, d };
  }, [a, b, c, d, filter.cutoff, filter.resonance, masterVolume]);

  // ── MIDI ──────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!navigator.requestMIDIAccess) { if (alive) setMidiStatus("Web MIDI not supported"); return; }
      try {
        const access = await navigator.requestMIDIAccess();
        midiAccessRef.current = access;
        const bind = () => {
          const inputs = Array.from(access.inputs.values());
          if (!inputs.length) { setMidiStatus("No MIDI connected"); return; }
          setMidiStatus(`${inputs.length} MIDI input${inputs.length > 1 ? "s" : ""} ready`);
          inputs.forEach((inp) => {
            inp.onmidimessage = async (msg) => {
              const [st, d1, d2] = msg.data;
              const cmd = st & 0xf0;
              if (cmd === 0x90 && d2 > 0) {
                if (!audioCtxRef.current) await setupAudio();
                recNoteOn(d1);
                noteOn(d1, d2 / 127);
                realNotesRef.current.add(d1);
                updateSeventh();
              } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
                recNoteOff(d1);
                noteOff(d1);
                realNotesRef.current.delete(d1);
                updateSeventh();
              }
            };
          });
        };
        bind();
        access.onstatechange = bind;
      } catch { if (alive) setMidiStatus("MIDI access denied"); }
    })();
    return () => { alive = false; };
  }, []);

  const applyEquation = () => { drawnWaveRef.current = null; lastEquationRef.current = equationInput; compileEquation(equationInput); setEquation(equationInput); };
  const panic = () => { heldNotesRef.current.clear(); phaseRef.current.clear(); realNotesRef.current.clear(); seventhNoteRef.current = null; setActiveNotes([]); };

  // ── Recording / Playback / Loop ─────────────────────────────────
  const startRecording = async () => {
    if (!audioCtxRef.current) await setupAudio();
    panic();
    setRecState("countdown");
    setCountdown(3);
    let count = 3;
    countdownRef.current = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
        setCountdown(0);
        recEventsRef.current = [];
        recStartRef.current = performance.now();
        recStateRef.current = "recording";
        setRecordedEvents([]);
        setRecDuration(0);
        setTrimStart(0);
        setTrimEnd(1);
        setTrimming(false);
        setRecState("recording");
      } else {
        setCountdown(count);
      }
    }, 1000);
  };

  const cancelCountdown = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    setCountdown(0);
    setRecState("idle");
  };

  const stopRecording = () => {
    const dur = (performance.now() - recStartRef.current) / 1000;
    // Add noteOff for any still-held notes
    for (const n of playHeldRef.current) {
      recEventsRef.current.push({ t: dur, type: "off", note: n });
    }
    setRecordedEvents([...recEventsRef.current]);
    setRecDuration(dur);
    recStateRef.current = "idle";
    setRecState("idle");
    panic();
  };

  const recNoteOn = (note) => {
    if (recStateRef.current === "recording") {
      recEventsRef.current.push({ t: (performance.now() - recStartRef.current) / 1000, type: "on", note, velocity: 0.8 });
    }
  };
  const recNoteOff = (note) => {
    if (recStateRef.current === "recording") {
      recEventsRef.current.push({ t: (performance.now() - recStartRef.current) / 1000, type: "off", note });
    }
  };

  const add7thRef = useRef(false);
  add7thRef.current = add7th;
  const realNotesRef = useRef(new Set());    // user-played notes (not auto-7ths)
  const seventhNoteRef = useRef(null);       // MIDI note of the current auto-7th

  // Keep 7th on the lowest real note only
  const updateSeventh = () => {
    if (!add7thRef.current) {
      if (seventhNoteRef.current !== null) {
        if (!realNotesRef.current.has(seventhNoteRef.current)) {
          recNoteOff(seventhNoteRef.current);
          noteOff(seventhNoteRef.current);
        }
        seventhNoteRef.current = null;
      }
      return;
    }
    const target = realNotesRef.current.size > 0
      ? Math.min(...realNotesRef.current) + 10
      : null;
    const cur = seventhNoteRef.current;
    if (cur === target) return;
    if (cur !== null && !realNotesRef.current.has(cur)) {
      recNoteOff(cur); noteOff(cur);
    }
    if (target !== null && !realNotesRef.current.has(target)) {
      const lowest = Math.min(...realNotesRef.current);
      const v = heldNotesRef.current.get(lowest);
      recNoteOn(target); noteOn(target, (v ? v.velocity : 0.8) * 0.7);
    }
    seventhNoteRef.current = target;
  };

  const wrappedNoteOn = async (note, velocity = 0.8) => {
    recNoteOn(note);
    if (!audioCtxRef.current) await setupAudio();
    else if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();
    noteOn(note, velocity);
    realNotesRef.current.add(note);
    updateSeventh();
  };
  const wrappedNoteOff = (note) => {
    recNoteOff(note);
    noteOff(note);
    realNotesRef.current.delete(note);
    updateSeventh();
  };

  const stopPlayback = () => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    playTimerRef.current = null;
    for (const n of playHeldRef.current) noteOff(n);
    playHeldRef.current.clear();
    setRecState("idle");
    setPlaybackPos(0);
  };

  const startPlayback = () => {
    if (!recordedEvents.length) return;
    panic();
    playHeldRef.current.clear();
    playIdxRef.current = 0;
    playStartRef.current = performance.now();
    setRecState("playing");
    setPlaybackPos(0);
    scheduleNextEvent();
  };

  const scheduleNextEvent = () => {
    const events = recordedEvents;
    const idx = playIdxRef.current;
    if (idx >= events.length) {
      // End of sequence
      const remaining = recDuration * 1000 - (performance.now() - playStartRef.current);
      playTimerRef.current = setTimeout(() => {
        for (const n of playHeldRef.current) noteOff(n);
        playHeldRef.current.clear();
        if (loopEnabled) {
          playIdxRef.current = 0;
          playStartRef.current = performance.now();
          setPlaybackPos(0);
          scheduleNextEvent();
        } else {
          setRecState("idle");
          setPlaybackPos(0);
        }
      }, Math.max(0, remaining));
      return;
    }
    const ev = events[idx];
    const elapsed = performance.now() - playStartRef.current;
    const wait = ev.t * 1000 - elapsed;
    playTimerRef.current = setTimeout(() => {
      if (ev.type === "on") {
        noteOn(ev.note, ev.velocity || 0.8);
        playHeldRef.current.add(ev.note);
      } else {
        noteOff(ev.note);
        playHeldRef.current.delete(ev.note);
      }
      setPlaybackPos((performance.now() - playStartRef.current) / 1000);
      playIdxRef.current = idx + 1;
      scheduleNextEvent();
    }, Math.max(0, wait));
  };

  // Audio export as WAV
  const exportAudio = async () => {
    if (!recordedEvents.length || !audioCtxRef.current) return;
    setAudioExporting(true);
    const dest = audioCtxRef.current.createMediaStreamDestination();
    // Temporarily route gain to the recorder destination too
    gainRef.current.connect(dest);
    const recorder = new MediaRecorder(dest.stream, { mimeType: "audio/webm;codecs=opus" });
    mediaChunksRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data.size) mediaChunksRef.current.push(e.data); };
    recorder.onstop = () => {
      gainRef.current.disconnect(dest);
      const blob = new Blob(mediaChunksRef.current, { type: "audio/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `wavecraft-${Date.now()}.webm`; a.click();
      URL.revokeObjectURL(url);
      setAudioExporting(false);
    };
    recorder.start();
    // Play back the sequence while recording audio
    panic();
    playHeldRef.current.clear();
    let i = 0;
    const t0 = performance.now();
    const step = () => {
      if (i >= recordedEvents.length) {
        const rem = recDuration * 1000 - (performance.now() - t0);
        setTimeout(() => {
          for (const n of playHeldRef.current) noteOff(n);
          playHeldRef.current.clear();
          setTimeout(() => recorder.stop(), 200); // brief tail
        }, Math.max(0, rem));
        return;
      }
      const ev = recordedEvents[i];
      const wait = ev.t * 1000 - (performance.now() - t0);
      setTimeout(() => {
        if (ev.type === "on") { noteOn(ev.note, ev.velocity || 0.8); playHeldRef.current.add(ev.note); }
        else { noteOff(ev.note); playHeldRef.current.delete(ev.note); }
        i++;
        step();
      }, Math.max(0, wait));
    };
    step();
  };

  // Trim helpers
  const applyTrim = () => {
    if (!recordedEvents.length || recDuration <= 0) return;
    const tMin = trimStart * recDuration;
    const tMax = trimEnd * recDuration;
    const trimmed = recordedEvents
      .filter(e => e.t >= tMin && e.t <= tMax)
      .map(e => ({ ...e, t: e.t - tMin }));
    const newDur = tMax - tMin;
    setRecordedEvents(trimmed);
    setRecDuration(newDur);
    setTrimStart(0);
    setTrimEnd(1);
    setTrimming(false);
  };

  // Cleanup on unmount
  useEffect(() => () => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  const applyPreset = (p) => {
    drawnWaveRef.current = null; // clear drawn wave when loading a preset
    setEquationInput(p.eq); setEquation(p.eq); lastEquationRef.current = p.eq;
    compileEquation(p.eq);
    setA(p.a); setB(p.b); setC(p.c); setD(p.d);
    setAdsr({ ...DEFAULT_ADSR, ...(p.adsr || {}) });
    setFilter({ ...DEFAULT_FILTER, ...(p.filter || {}) });
    setFxParams(withFxDefaults(p.fxParams || {}));
    if (p.lfos) setLfos(JSON.parse(JSON.stringify(p.lfos)));
    if (p.masterVolume != null) setMasterVolume(p.masterVolume);
    if (p.add7th != null) setAdd7th(p.add7th);
  };
  const updateFx = (effect, key, val) => {
    setFxParams((prev) => ({ ...prev, [effect]: { ...prev[effect], [key]: val } }));
  };

  const onUseWave = useCallback((wave) => {
    drawnWaveRef.current = new Float32Array(wave);
    setEquationInput("[drawn wave]");
    setEquation("[drawn wave]");
    setPage("synth");
  }, []);

  const toggleDrumSync = useCallback(async () => {
    if (drumsPlaying) {
      setDrumsPlaying(false);
      return;
    }
    if (!audioCtxRef.current) await setupAudio();
    else if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    setDrumSyncStartAt(ctx.currentTime + 0.08);
    setDrumSyncEpoch((n) => n + 1);
    setDrumsPlaying(true);
  }, [drumsPlaying, setupAudio]);

  // ── Combined Drum Presets (both machines) ─────────────────────────
  const [combinedDrumPresets, setCombinedDrumPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem("wavecraft_combined_drum_presets") || "[]"); } catch { return []; }
  });
  const [newCombinedDrumName, setNewCombinedDrumName] = useState("");

  const saveCombinedDrumPreset = () => {
    const name = newCombinedDrumName.trim();
    if (!name) return;
    const preset = {
      name,
      bpm: drumBpm,
      vlTone: drumMachineRef.current?.getState() ?? null,
      po32: po32Ref.current?.getState() ?? null,
    };
    const existing = combinedDrumPresets.findIndex(p => p.name === name);
    const next = [...combinedDrumPresets];
    if (existing >= 0) next[existing] = preset; else next.push(preset);
    setCombinedDrumPresets(next);
    localStorage.setItem("wavecraft_combined_drum_presets", JSON.stringify(next));
    setNewCombinedDrumName("");
  };

  const loadCombinedDrumPreset = (p) => {
    if (p.bpm != null) setDrumBpm(p.bpm);
    if (p.vlTone && drumMachineRef.current) drumMachineRef.current.loadState(p.vlTone);
    if (p.po32 && po32Ref.current) po32Ref.current.loadState(p.po32);
  };

  const deleteCombinedDrumPreset = (name) => {
    const next = combinedDrumPresets.filter(p => p.name !== name);
    setCombinedDrumPresets(next);
    localStorage.setItem("wavecraft_combined_drum_presets", JSON.stringify(next));
  };

  // ── Button styles ─────────────────────────────────────────────────
  const btnPrimary = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    height: 38, padding: "0 18px", borderRadius: 3,
    border: "1px solid rgba(255,180,60,0.3)",
    background: "linear-gradient(180deg, #cc6e08 0%, #a05500 100%)",
    color: "#f0e6d2",
    fontSize: 12, fontWeight: 700, cursor: "pointer",
    fontFamily: T.font, textTransform: "uppercase", letterSpacing: 1,
    boxShadow: `0 2px 8px ${T.accentGlow}, inset 0 1px 0 rgba(255,255,255,0.1)`,
    transition: "all 100ms",
  };
  const btnGhost = {
    ...btnPrimary,
    background: "linear-gradient(180deg, #2e2820 0%, #1a1510 100%)",
    color: T.text,
    border: `1px solid ${T.borderHi}`,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 4px rgba(0,0,0,0.3)",
  };

  // ═════════════════════════════════════════════════════════════════
  //  RENDER
  // ═════════════════════════════════════════════════════════════════
  return (
    <div style={{
      minHeight: "100vh", background: T.bg, color: T.text,
      fontFamily: T.font, WebkitFontSmoothing: "antialiased",
    }}>
      {/* CRT scanline overlay */}
      <div className="crt-overlay" />

      {/* ── Auth Modal ──────────────────────────────────────────── */}
      {authModal && (
        <div onClick={() => setAuthModal(null)} style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 340, background: "linear-gradient(180deg, #2a2218, #14110c)",
            border: `2px solid ${T.borderHi}`, borderRadius: 4, padding: 28,
            boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.amber, letterSpacing: 3, textTransform: "uppercase", marginBottom: 20, textAlign: "center" }}>
              {authModal === "login" ? "Sign In" : "Create Account"}
            </div>
            {authError && (
              <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 2, background: "rgba(255,60,60,0.15)", border: "1px solid rgba(255,60,60,0.3)", color: "#ff6b6b", fontSize: 11, fontFamily: T.monoFont }}>
                {authError}
              </div>
            )}
            {authModal === "signup" && (
              <input
                value={authForm.displayName} onChange={(e) => setAuthForm((f) => ({ ...f, displayName: e.target.value }))}
                placeholder="Display name" autoComplete="name"
                style={{ width: "100%", height: 36, fontSize: 13, padding: "0 10px", marginBottom: 10, boxSizing: "border-box", background: T.surface, color: T.white, border: `1px solid ${T.border}`, borderRadius: 2, outline: "none", fontFamily: T.monoFont }}
              />
            )}
            <input
              value={authForm.email} onChange={(e) => setAuthForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="Email" type="email" autoComplete="email"
              style={{ width: "100%", height: 36, fontSize: 13, padding: "0 10px", marginBottom: 10, boxSizing: "border-box", background: T.surface, color: T.white, border: `1px solid ${T.border}`, borderRadius: 2, outline: "none", fontFamily: T.monoFont }}
            />
            <input
              value={authForm.password} onChange={(e) => setAuthForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="Password" type="password" autoComplete={authModal === "login" ? "current-password" : "new-password"}
              onKeyDown={(e) => e.key === "Enter" && (authModal === "login" ? doLogin() : doSignup())}
              style={{ width: "100%", height: 36, fontSize: 13, padding: "0 10px", marginBottom: 16, boxSizing: "border-box", background: T.surface, color: T.white, border: `1px solid ${T.border}`, borderRadius: 2, outline: "none", fontFamily: T.monoFont }}
            />
            <button
              onClick={authModal === "login" ? doLogin : doSignup}
              disabled={authLoading}
              style={{ ...btnPrimary, width: "100%", height: 38, fontSize: 12, marginBottom: 12, opacity: authLoading ? 0.6 : 1 }}
            >
              {authLoading ? "..." : authModal === "login" ? "Sign In" : "Create Account"}
            </button>
            <div style={{ textAlign: "center", fontSize: 11, color: T.textMuted }}>
              {authModal === "login" ? "No account? " : "Already have one? "}
              <span
                onClick={() => { setAuthModal(authModal === "login" ? "signup" : "login"); setAuthError(""); }}
                style={{ color: T.amber, cursor: "pointer", textDecoration: "underline" }}
              >
                {authModal === "login" ? "Sign up" : "Sign in"}
              </span>
            </div>
          </div>
        </div>
      )}
      {/* ── top bar ──────────────────────────────────────────────── */}
      <div style={{
        height: 52, background: "linear-gradient(180deg, #2a2218 0%, #1a1510 100%)",
        borderBottom: `2px solid ${T.borderHi}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", position: "sticky", top: 0, zIndex: 100,
        boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 30, height: 30, borderRadius: 3,
            background: "linear-gradient(135deg, #cc6e08, #ff9922)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, color: "#0d0b08", fontWeight: 900,
            boxShadow: "0 0 10px rgba(232,133,12,0.4)",
          }}>∿</span>
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: T.amber }}>EquationSynth</span>
          <span style={{ fontSize: 10, color: T.textMuted, fontWeight: 500, marginLeft: 4, letterSpacing: 2 }}>v0.1</span>
          <div style={{ display: "flex", marginLeft: 16, gap: 2 }}>
            {[{ id: "synth", label: "SYNTH" }, { id: "draw", label: "DRAW" }, { id: "drums", label: "DRUMS" }].map((tab) => (
              <button key={tab.id} onClick={() => setPage(tab.id)} style={{
                height: 28, padding: "0 14px", fontSize: 11, fontWeight: 700,
                fontFamily: T.font, letterSpacing: 1.5, textTransform: "uppercase",
                border: `1px solid ${page === tab.id ? T.accent : T.borderHi}`,
                borderRadius: 2, cursor: "pointer",
                background: page === tab.id ? "linear-gradient(180deg, #cc6e08, #a05500)" : "linear-gradient(180deg, #2e2820, #1a1510)",
                color: page === tab.id ? "#f0e6d2" : T.textDim,
                boxShadow: page === tab.id ? `0 0 8px ${T.accentGlow}` : "none",
              }}>{tab.label}</button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Pill glow={audioReady}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: audioReady ? T.green : T.textMuted }} />
            {audioReady ? "Engine On" : "Engine Off"}
          </Pill>
          <Pill>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: activeNotes.length ? T.green : T.textMuted }} />
            {midiStatus}
          </Pill>
          {authUser ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10, color: T.green, fontFamily: T.monoFont, letterSpacing: 1, textTransform: "uppercase" }}>
                {authUser.displayName || authUser.email}
              </span>
              <button onClick={doLogout} style={{
                height: 24, padding: "0 10px", fontSize: 9, fontWeight: 700,
                fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase",
                border: `1px solid ${T.border}`, borderRadius: 2, cursor: "pointer",
                background: "linear-gradient(180deg, #2e2820, #1a1510)", color: T.textDim,
              }}>Logout</button>
            </div>
          ) : (
            <button onClick={() => { setAuthModal("login"); setAuthError(""); }} style={{
              height: 28, padding: "0 14px", fontSize: 10, fontWeight: 700,
              fontFamily: T.font, letterSpacing: 1.5, textTransform: "uppercase",
              border: `1px solid ${T.accent}`, borderRadius: 2, cursor: "pointer",
              background: "linear-gradient(180deg, #cc6e08, #a05500)", color: "#f0e6d2",
              boxShadow: `0 0 8px ${T.accentGlow}`,
            }}>Sign In</button>
          )}
        </div>
      </div>

      {/* ── Drum machines (always mounted for persistence) ────── */}
      <div style={{ display: page === "drums" ? "block" : "none" }}>
        <DrumMachine
          ref={drumMachineRef}
          audioCtxRef={audioCtxRef}
          gainRef={gainRef}
          setupAudio={setupAudio}
          tempo={drumBpm}
          onTempoChange={setDrumBpm}
          syncPlaying={drumsPlaying}
          syncStartAt={drumSyncStartAt}
          syncEpoch={drumSyncEpoch}
          onToggleSync={toggleDrumSync}
        />
        <PO32Tonic
          ref={po32Ref}
          audioCtxRef={audioCtxRef}
          gainRef={gainRef}
          setupAudio={setupAudio}
          tempo={drumBpm}
          onTempoChange={setDrumBpm}
          syncPlaying={drumsPlaying}
          syncStartAt={drumSyncStartAt}
          syncEpoch={drumSyncEpoch}
          onToggleSync={toggleDrumSync}
        />

        {/* ── Combined Drum Kit Presets ────────────────────────── */}
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 20px 40px" }}>
          <Section title="Drum Kit Presets" icon="💾">
            <div style={{ fontSize: 10, color: T.textDim, marginBottom: 8, fontFamily: T.font }}>
              Saves both VL-Tone and PO-32 patterns, all dial settings, and BPM together.
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input
                value={newCombinedDrumName}
                onChange={(e) => setNewCombinedDrumName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveCombinedDrumPreset()}
                placeholder="Kit preset name…"
                style={{
                  flex: 1, height: 36, fontSize: 13, padding: "0 10px",
                  background: T.surface, color: T.white,
                  border: `1px solid ${T.border}`, borderRadius: 8,
                  outline: "none", minWidth: 0, fontFamily: T.font,
                }}
              />
              <button onClick={saveCombinedDrumPreset} disabled={!newCombinedDrumName.trim()} style={{
                ...btnPrimary, height: 34, padding: "0 14px", fontSize: 10,
                opacity: newCombinedDrumName.trim() ? 1 : 0.4,
                cursor: newCombinedDrumName.trim() ? "pointer" : "not-allowed",
              }}>
                Save Kit
              </button>
            </div>
            {combinedDrumPresets.length === 0 ? (
              <div style={{ fontSize: 12, color: T.textMuted, textAlign: "center", padding: "8px 0" }}>
                No saved drum kit presets yet
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {combinedDrumPresets.map((p) => (
                  <div key={p.name} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "5px 10px", borderRadius: 2,
                    border: `1px solid ${T.border}`,
                    background: "linear-gradient(180deg, #2e2820, #1a1510)",
                  }}>
                    <button onClick={() => loadCombinedDrumPreset(p)} style={{
                      flex: 1, background: "none", border: "none",
                      color: T.text, fontSize: 10, fontWeight: 700,
                      cursor: "pointer", textAlign: "left", padding: 0,
                      fontFamily: T.font, letterSpacing: 0.8, textTransform: "uppercase",
                    }}>
                      {p.name}
                    </button>
                    <span style={{ fontSize: 9, color: T.textMuted, fontFamily: T.font }}>{p.bpm}bpm</span>
                    <button onClick={() => deleteCombinedDrumPreset(p.name)} title="Delete" style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: T.textMuted, fontSize: 14, padding: "0 2px", lineHeight: 1,
                    }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* ── page content ─────────────────────────────────────────── */}
      {page === "draw" ? (
        <WaveDrawer onUseWave={onUseWave} />
      ) : page === "drums" ? null : (
      <div style={{ maxWidth: 1480, margin: "0 auto", padding: "20px 20px 40px" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "minmax(340px, 440px) 1fr minmax(260px, 320px)",
          gap: 16,
        }}>

          {/* ── LEFT COLUMN: Plot + Equation ─────────────────────── */}
          <div>
            <Section title="Waveform Preview" icon="📈">
              <PlotCanvas equation={equation} params={params} xScale={xScale} yScale={yScale} drawnWave={drawnWaveRef.current} lfoParams={lfoDisplay} />

              {/* equation input */}
              <div style={{ display: "flex", gap: 0, marginTop: 14 }}>
                <div style={{
                  background: "#181208", border: `1px solid ${T.borderHi}`,
                  borderRadius: `${T.radius}px 0 0 ${T.radius}px`,
                  padding: "0 10px", display: "flex", alignItems: "center",
                  fontSize: 11, fontWeight: 700, color: T.amber,
                  textTransform: "uppercase", letterSpacing: 1.5,
                  whiteSpace: "nowrap", fontFamily: T.font,
                }}>
                  f(x) =
                </div>
                <input
                  value={equationInput}
                  onChange={(e) => setEquationInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyEquation()}
                  placeholder="sin(x)"
                  spellCheck={false}
                  style={{
                    flex: 1, height: 40, fontSize: 14, padding: "0 12px",
                    background: "#0a0f0a", color: T.green,
                    border: `1px solid ${T.border}`, borderLeft: "none", borderRight: "none",
                    outline: "none", fontFamily: "'Share Tech Mono', 'Courier New', monospace",
                    minWidth: 0, textShadow: "0 0 6px rgba(51,255,102,0.3)",
                  }}
                />
                <button onClick={applyEquation} style={{
                  ...btnPrimary, borderRadius: 0,
                  height: 40, padding: "0 16px", fontSize: 10, letterSpacing: 1.5,
                }}>
                  APPLY
                </button>
                <button onClick={() => { drawnWaveRef.current = null; setEquationInput(DEFAULT_EQ); setEquation(DEFAULT_EQ); lastEquationRef.current = DEFAULT_EQ; compileEquation(DEFAULT_EQ); }} title="Reset to default" style={{
                  height: 40, padding: "0 12px", fontSize: 14,
                  background: "linear-gradient(180deg, #2e2820, #1a1510)", color: T.textMuted,
                  border: `1px solid ${T.border}`, borderLeft: "none",
                  borderRadius: `0 ${T.radius}px ${T.radius}px 0`,
                  cursor: "pointer", fontFamily: T.font,
                }}>
                  ↺
                </button>
              </div>
            </Section>

            {/* View controls */}
            <Section title="View" icon="🔍" style={{ marginTop: 12 }}>
              <Knob label="X Scale" value={xScale} onChange={setXScale} min={0.1} max={8} step={0.01} compact defaultValue={1} />
              <Knob label="Y Scale" value={yScale} onChange={setYScale} min={0.1} max={8} step={0.01} compact defaultValue={1} />
            </Section>

            {/* Presets */}
            <Section title="Presets" icon="🎨" style={{ marginTop: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                {PRESETS.map((p) => (
                  <button key={p.name} onClick={() => applyPreset(p)} style={{
                    padding: "7px 10px", borderRadius: 2,
                    border: `1px solid ${equation === p.eq ? T.accent : T.border}`,
                    background: equation === p.eq
                      ? "linear-gradient(180deg, #cc6e08, #a05500)"
                      : "linear-gradient(180deg, #2e2820, #1a1510)",
                    color: equation === p.eq ? "#f0e6d2" : T.textDim,
                    fontSize: 10, fontWeight: 700, cursor: "pointer",
                    textAlign: "left", transition: "all 80ms",
                    fontFamily: T.font, letterSpacing: 0.8, textTransform: "uppercase",
                    boxShadow: equation === p.eq ? `0 0 8px ${T.accentGlow}` : "inset 0 1px 0 rgba(255,255,255,0.04)",
                  }}>
                    {p.name}
                  </button>
                ))}
              </div>
            </Section>

            {/* User Presets */}
            <Section title="My Presets" icon="💾" style={{ marginTop: 12 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <input
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveUserPreset()}
                  placeholder="Preset name…"
                  style={{
                    flex: 1, height: 36, fontSize: 13, padding: "0 10px",
                    background: T.surface, color: T.white,
                    border: `1px solid ${T.border}`, borderRadius: 8,
                    outline: "none", minWidth: 0,
                  }}
                />
                <button onClick={() => { saveUserPreset(); if (authToken && newPresetName.trim()) saveCloudPreset(newPresetName.trim()); }} disabled={!newPresetName.trim()} style={{
                  ...btnPrimary, height: 34, padding: "0 14px", fontSize: 10,
                  opacity: newPresetName.trim() ? 1 : 0.4,
                  cursor: newPresetName.trim() ? "pointer" : "not-allowed",
                }}>
                  Save
                </button>
              </div>
              {userPresets.length === 0 ? (
                <div style={{ fontSize: 12, color: T.textMuted, textAlign: "center", padding: "8px 0" }}>
                  No saved presets yet
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {userPresets.map((p) => (
                    <div key={p.name} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "5px 10px", borderRadius: 2,
                      border: `1px solid ${T.border}`,
                      background: "linear-gradient(180deg, #2e2820, #1a1510)",
                    }}>
                      <button onClick={() => loadUserPreset(p)} style={{
                        flex: 1, background: "none", border: "none",
                        color: T.text, fontSize: 10, fontWeight: 700,
                        cursor: "pointer", textAlign: "left", padding: 0,
                        fontFamily: T.font, letterSpacing: 0.8, textTransform: "uppercase",
                      }}>
                        {p.name}
                      </button>
                      <button onClick={() => deleteUserPreset(p.name)} title="Delete" style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: T.textMuted, fontSize: 14, padding: "0 2px", lineHeight: 1,
                      }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Cloud Presets */}
            {authUser && (
              <Section title="Cloud Presets" icon="☁️" style={{ marginTop: 12 }}>
                {cloudLoading ? (
                  <div style={{ fontSize: 11, color: T.textMuted, textAlign: "center", padding: "8px 0", fontFamily: T.monoFont }}>Loading…</div>
                ) : cloudPresets.length === 0 ? (
                  <div style={{ fontSize: 11, color: T.textMuted, textAlign: "center", padding: "8px 0" }}>
                    No cloud presets — save one above while signed in
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {cloudPresets.map((p) => (
                      <div key={p.id} style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "5px 10px", borderRadius: 2,
                        border: `1px solid ${T.border}`,
                        background: "linear-gradient(180deg, #1a2218, #101a10)",
                      }}>
                        <button onClick={() => loadCloudPreset(p.id)} style={{
                          flex: 1, background: "none", border: "none",
                          color: T.green, fontSize: 10, fontWeight: 700,
                          cursor: "pointer", textAlign: "left", padding: 0,
                          fontFamily: T.monoFont, letterSpacing: 0.8, textTransform: "uppercase",
                        }}>
                          ☁ {p.name}
                        </button>
                        <button onClick={() => deleteCloudPreset(p.id)} title="Delete" style={{
                          background: "none", border: "none", cursor: "pointer",
                          color: T.textMuted, fontSize: 14, padding: "0 2px", lineHeight: 1,
                        }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Section title="Audio Engine" icon="🔊">
              <Knob label="Master Volume" value={masterVolume} onChange={setMasterVolume} min={0} max={0.5} step={0.001} defaultValue={0.18} lfoMod={lfoDisplay.volume} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                <Pill>{sampleRate.toLocaleString()} Hz</Pill>
                {activeNotes.length > 0 && (
                  <Pill glow>
                    🎵 {activeNotes.map(noteName).join(", ")}
                  </Pill>
                )}
              </div>
            </Section>

            {/* keyboard */}
            <Section title="Keyboard" icon="🎹">
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <button
                  onClick={() => setAdd7th((v) => !v)}
                  style={{
                    height: 24, padding: "0 10px", fontSize: 9, fontWeight: 700,
                    fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase",
                    border: `1px solid ${add7th ? T.accent : T.border}`,
                    borderRadius: 2, cursor: "pointer",
                    background: add7th ? "linear-gradient(180deg, #cc6e08, #a05500)" : "linear-gradient(180deg, #2e2820, #1a1510)",
                    color: add7th ? "#f0e6d2" : T.textDim,
                    boxShadow: add7th ? `0 0 6px ${T.accentGlow}` : "none",
                  }}
                >
                  +7th
                </button>
              </div>
              <PianoKeyboard activeNotes={activeNotes} onNoteOn={wrappedNoteOn} onNoteOff={wrappedNoteOff} />
              <div style={{ fontSize: 9, color: T.textMuted, marginTop: 6, textAlign: "center", fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase" }}>
                C3 — C5 · Click or use MIDI
              </div>
            </Section>

            {/* Visualizations */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, paddingLeft: 2 }}>Oscilloscope</div>
                <Oscilloscope analyserRef={analyserRef} heldNotesRef={heldNotesRef} audioCtxRef={audioCtxRef} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, paddingLeft: 2 }}>Spectrum</div>
                <Spectrum analyserRef={analyserRef} />
              </div>
            </div>

            {/* Recorder / Looper */}
            <Section title="Recorder" icon="⏺">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {recState === "recording" ? (
                  <button onClick={stopRecording} style={{ ...btnPrimary, background: T.red, boxShadow: `0 2px 12px rgba(239,68,68,0.3)` }}>
                    ■ Stop
                  </button>
                ) : recState === "countdown" ? (
                  <button onClick={cancelCountdown} style={{ ...btnPrimary, background: T.amber, boxShadow: `0 2px 12px rgba(245,158,11,0.3)` }}>
                    ✕ Cancel ({countdown})
                  </button>
                ) : (
                  <button onClick={startRecording} disabled={recState === "playing"} style={{
                    ...btnPrimary, background: recState === "playing" ? T.raised : T.red,
                    boxShadow: recState === "playing" ? "none" : `0 2px 12px rgba(239,68,68,0.3)`,
                    opacity: recState === "playing" ? 0.5 : 1,
                    cursor: recState === "playing" ? "not-allowed" : "pointer",
                  }}>
                    ⏺ Record
                  </button>
                )}
                {recState === "playing" ? (
                  <button onClick={stopPlayback} style={btnGhost}>■ Stop</button>
                ) : (
                  <button onClick={startPlayback} disabled={!recordedEvents.length || recState === "recording" || recState === "countdown"} style={{
                    ...btnGhost,
                    opacity: (!recordedEvents.length || recState === "recording" || recState === "countdown") ? 0.4 : 1,
                    cursor: (!recordedEvents.length || recState === "recording" || recState === "countdown") ? "not-allowed" : "pointer",
                  }}>
                    ▶ Play
                  </button>
                )}
                <div
                  onClick={() => setLoopEnabled(!loopEnabled)}
                  style={{
                    ...btnGhost,
                    background: loopEnabled ? "linear-gradient(180deg, #cc6e08, #a05500)" : "linear-gradient(180deg, #2e2820, #1a1510)",
                    color: loopEnabled ? "#f0e6d2" : T.text,
                    border: `1px solid ${loopEnabled ? "rgba(255,180,60,0.4)" : T.border}`,
                    cursor: "pointer", userSelect: "none",
                  }}
                >
                  🔁 Loop
                </div>
                <button onClick={exportAudio} disabled={!recordedEvents.length || audioExporting} style={{
                  ...btnGhost,
                  opacity: (!recordedEvents.length || audioExporting) ? 0.4 : 1,
                  cursor: (!recordedEvents.length || audioExporting) ? "not-allowed" : "pointer",
                }}>
                  {audioExporting ? "Exporting…" : "⬇ Export"}
                </button>
              </div>

              {/* Status bar */}
              <div style={{
                background: T.surface, borderRadius: 8, padding: "10px 14px",
                border: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: recState === "countdown" ? T.amber
                    : recState === "recording" ? T.red
                    : recState === "playing" ? T.green : T.textMuted,
                  boxShadow: recState === "countdown" ? "0 0 8px rgba(245,158,11,0.5)"
                    : recState === "recording" ? "0 0 8px rgba(239,68,68,0.5)"
                    : recState === "playing" ? `0 0 8px ${T.greenGlow}` : "none",
                  animation: (recState === "recording" || recState === "countdown") ? "pulse 1s ease-in-out infinite" : "none",
                }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: T.text, flex: 1 }}>
                  {recState === "countdown" ? `Starting in ${countdown}…`
                    : recState === "recording" ? "Recording…"
                    : recState === "playing" ? (loopEnabled ? "Looping…" : "Playing…")
                    : recordedEvents.length ? `${recordedEvents.length} events · ${recDuration.toFixed(1)}s` : "No recording"}
                </span>
                {recState === "playing" && recDuration > 0 && (
                  <span style={{ fontSize: 12, color: T.accent, fontVariantNumeric: "tabular-nums" }}>
                    {Math.min(playbackPos, recDuration).toFixed(1)}s / {recDuration.toFixed(1)}s
                  </span>
                )}
                {loopEnabled && <Pill glow>LOOP</Pill>}
              </div>

              {/* Mini timeline */}
              {recordedEvents.length > 0 && recDuration > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div
                    style={{
                      height: 32, background: T.surface,
                      borderRadius: 6, border: `1px solid ${T.border}`,
                      position: "relative", overflow: "hidden",
                    }}
                    onMouseDown={(e) => {
                      if (recState === "recording" || recState === "countdown") return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = (e.clientX - rect.left) / rect.width;
                      // Determine if near a handle
                      const dStart = Math.abs(x - trimStart);
                      const dEnd = Math.abs(x - trimEnd);
                      const threshold = 0.03;
                      let dragging = null;
                      if (dStart < threshold && dStart <= dEnd) dragging = "start";
                      else if (dEnd < threshold) dragging = "end";
                      else if (x > trimStart && x < trimEnd) dragging = x - trimStart < trimEnd - x ? "start" : "end";
                      else dragging = x < trimStart ? "start" : "end";
                      if (!dragging) return;
                      setTrimming(true);
                      const onMove = (ev) => {
                        const nx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
                        if (dragging === "start") setTrimStart(s => Math.min(nx, trimEnd - 0.01));
                        else setTrimEnd(s => Math.max(nx, trimStart + 0.01));
                      };
                      const onUp = () => {
                        window.removeEventListener("mousemove", onMove);
                        window.removeEventListener("mouseup", onUp);
                      };
                      window.addEventListener("mousemove", onMove);
                      window.addEventListener("mouseup", onUp);
                    }}
                  >
                    {/* Dimmed regions outside trim */}
                    {(trimStart > 0 || trimEnd < 1) && (
                      <>
                        <div style={{
                          position: "absolute", left: 0, top: 0, bottom: 0,
                          width: `${trimStart * 100}%`,
                          background: "rgba(0,0,0,0.45)", zIndex: 2,
                        }} />
                        <div style={{
                          position: "absolute", right: 0, top: 0, bottom: 0,
                          width: `${(1 - trimEnd) * 100}%`,
                          background: "rgba(0,0,0,0.45)", zIndex: 2,
                        }} />
                      </>
                    )}
                    {/* Trim handles */}
                    {(trimStart > 0 || trimEnd < 1 || trimming) && (
                      <>
                        <div style={{
                          position: "absolute", left: `${trimStart * 100}%`, top: 0, bottom: 0,
                          width: 3, background: T.amber, zIndex: 3, cursor: "ew-resize",
                          boxShadow: `0 0 6px rgba(245,158,11,0.5)`,
                        }} />
                        <div style={{
                          position: "absolute", left: `${trimEnd * 100}%`, top: 0, bottom: 0,
                          width: 3, background: T.amber, zIndex: 3, cursor: "ew-resize",
                          transform: "translateX(-3px)",
                          boxShadow: `0 0 6px rgba(245,158,11,0.5)`,
                        }} />
                      </>
                    )}
                    {/* event ticks */}
                    {recordedEvents.filter(e => e.type === "on").map((e, i) => (
                      <div key={i} style={{
                        position: "absolute", left: `${(e.t / recDuration) * 100}%`,
                        top: 4, bottom: 4, width: 2, borderRadius: 1,
                        background: T.accent, opacity: 0.5,
                      }} />
                    ))}
                    {/* playhead */}
                    {recState === "playing" && (
                      <div style={{
                        position: "absolute",
                        left: `${(Math.min(playbackPos, recDuration) / recDuration) * 100}%`,
                        top: 0, bottom: 0, width: 2,
                        background: T.green, boxShadow: `0 0 6px ${T.greenGlow}`, zIndex: 4,
                      }} />
                    )}
                  </div>
                  {/* Trim controls */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <button
                      onClick={() => {
                        if (trimStart === 0 && trimEnd === 1) {
                          // Enter trim mode – set initial handles slightly inward
                          setTrimStart(0);
                          setTrimEnd(1);
                          setTrimming(true);
                        } else {
                          // Cancel trim
                          setTrimStart(0);
                          setTrimEnd(1);
                          setTrimming(false);
                        }
                      }}
                      style={{
                        ...btnGhost, fontSize: 12, padding: "4px 10px",
                        background: trimming || (trimStart > 0 || trimEnd < 1)
                          ? "linear-gradient(180deg, #cc6e08, #a05500)" : undefined,
                        color: trimming || (trimStart > 0 || trimEnd < 1) ? "#f0e6d2" : T.text,
                        border: `1px solid ${trimming || (trimStart > 0 || trimEnd < 1) ? "rgba(255,180,60,0.4)" : T.border}`,
                      }}
                    >
                      ✂ Trim
                    </button>
                    {(trimStart > 0 || trimEnd < 1) && (
                      <>
                        <span style={{ fontSize: 11, color: T.textMuted, fontVariantNumeric: "tabular-nums" }}>
                          {(trimStart * recDuration).toFixed(2)}s – {(trimEnd * recDuration).toFixed(2)}s
                        </span>
                        <button
                          onClick={applyTrim}
                          disabled={recState === "playing" || recState === "recording"}
                          style={{
                            ...btnGhost, fontSize: 12, padding: "4px 10px",
                            background: "linear-gradient(180deg, #166534, #14532d)",
                            color: "#bbf7d0",
                            border: "1px solid rgba(34,197,94,0.3)",
                            opacity: (recState === "playing" || recState === "recording") ? 0.4 : 1,
                            cursor: (recState === "playing" || recState === "recording") ? "not-allowed" : "pointer",
                          }}
                        >
                          ✓ Apply
                        </button>
                        <button
                          onClick={() => { setTrimStart(0); setTrimEnd(1); setTrimming(false); }}
                          style={{ ...btnGhost, fontSize: 12, padding: "4px 10px" }}
                        >
                          ✕ Reset
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </Section>

            {/* Effects Chain */}
            <Section title="Effects Chain" icon="✨">
              {(() => {
                const FX_DEFS = {
                  distortion: { label: "Distortion", icon: "🔥", knobs: [
                    { key: "drive", label: "Drive", min: 1, max: 30, step: 0.1 },
                    { key: "tone",  label: "Tone",  min: 0, max: 1,  step: 0.01 },
                    { key: "mix",   label: "Mix",   min: 0, max: 1,  step: 0.01 },
                    { key: "asym",  label: "Asym",  min: 0, max: 0.6, step: 0.01 },
                  ]},
                  chorus: { label: "Chorus", icon: "🌊", knobs: [
                    { key: "mix",   label: "Mix",   min: 0, max: 1,    step: 0.01 },
                    { key: "rate",  label: "Rate",  min: 0.1, max: 8,  step: 0.1 },
                    { key: "depth", label: "Depth", min: 0, max: 0.02, step: 0.001 },
                  ]},
                  delay: { label: "Delay", icon: "🔁", knobs: [
                    { key: "mix",      label: "Mix",      min: 0, max: 1,   step: 0.01 },
                    { key: "time",     label: "Time",     min: 0.05, max: 1, step: 0.01 },
                    { key: "feedback", label: "Feedback", min: 0, max: 0.9, step: 0.01 },
                  ]},
                  reverb: { label: "Reverb", icon: "🏛", knobs: [
                    { key: "mix",   label: "Mix",   min: 0, max: 1,   step: 0.01 },
                    { key: "decay", label: "Decay", min: 0.2, max: 5, step: 0.1 },
                  ]},
                };
                return fxOrder.map((id, idx) => {
                  const def = FX_DEFS[id];
                  const fp = fxParams[id];
                  const isOpen = openEffect === id;
                  return (
                    <div
                      key={id}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", idx.toString()); e.currentTarget.style.opacity = "0.5"; }}
                      onDragEnd={(e) => { e.currentTarget.style.opacity = "1"; }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; e.currentTarget.style.borderTop = `2px solid ${T.accent}`; }}
                      onDragLeave={(e) => { e.currentTarget.style.borderTop = ""; }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.borderTop = "";
                        const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
                        if (isNaN(from) || from === idx) return;
                        setFxOrder((prev) => {
                          const next = [...prev];
                          const [moved] = next.splice(from, 1);
                          next.splice(idx, 0, moved);
                          return next;
                        });
                      }}
                      style={{
                        marginBottom: 4, borderRadius: T.radius,
                        border: `1px solid ${fp.enabled ? "rgba(255,180,60,0.25)" : T.border}`,
                        background: fp.enabled ? T.accentSoft : T.surface,
                        overflow: "hidden", transition: "background 100ms, border-color 100ms",
                      }}
                    >
                      <div
                        onClick={() => setOpenEffect(isOpen ? null : id)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "8px 12px", cursor: "pointer", userSelect: "none",
                        }}
                      >
                        <span style={{ cursor: "grab", fontSize: 11, color: T.textMuted, lineHeight: 1, letterSpacing: 1 }} title="Drag to reorder">⠿</span>
                        <span style={{ fontSize: 12 }}>{def.icon}</span>
                        <span style={{ flex: 1, fontSize: 10, fontWeight: 700, color: T.text, fontFamily: T.font, textTransform: "uppercase", letterSpacing: 1 }}>{def.label}</span>
                      <div
                        onClick={(e) => { e.stopPropagation(); updateFx(id, "enabled", !fp.enabled); }}
                        style={{
                          width: 32, height: 16, borderRadius: 2, padding: 2,
                          background: fp.enabled ? T.accent : "#181208",
                          border: `1px solid ${fp.enabled ? T.accent : T.borderHi}`,
                          cursor: "pointer", transition: "all 100ms",
                          display: "flex", alignItems: "center",
                          justifyContent: fp.enabled ? "flex-end" : "flex-start",
                          boxShadow: fp.enabled ? `0 0 6px ${T.accentGlow}` : "none",
                        }}
                      >
                        <div style={{
                          width: 10, height: 10, borderRadius: 1,
                          background: fp.enabled ? "#f0e6d2" : T.textMuted, transition: "all 100ms",
                        }} />
                      </div>
                      <span style={{
                        fontSize: 14, color: T.textDim,
                        transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                        transition: "transform 100ms",
                      }}>›</span>
                    </div>
                    {isOpen && (
                      <div style={{
                        padding: "8px 14px 16px",
                        borderTop: `1px solid ${T.border}`,
                        display: "flex", justifyContent: "center", gap: 20, flexWrap: "wrap",
                      }}>
                        {def.knobs.map((k) => (
                          <RotaryKnob
                            key={k.key}
                            label={k.label}
                            value={fp[k.key]}
                            onChange={(v) => updateFx(id, k.key, v)}
                            min={k.min}
                            max={k.max}
                            step={k.step}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              });
              })()}
            </Section>

          </div>

          {/* ── RIGHT COLUMN: Parameters ─────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Section title="Parameters" icon="🎛">
              <Knob label="a" value={a} onChange={setA} defaultValue={1} lfoMod={lfoDisplay.a} />
              <Knob label="b" value={b} onChange={setB} defaultValue={0} lfoMod={lfoDisplay.b} />
              <Knob label="c" value={c} onChange={setC} defaultValue={0} lfoMod={lfoDisplay.c} />
              <Knob label="d" value={d} onChange={setD} defaultValue={0} lfoMod={lfoDisplay.d} />
            </Section>

            <Section title="Envelope" icon="📦">
              <AdsrGraph adsr={adsr} />
              <div style={{ display: "flex", justifyContent: "center", gap: 18, flexWrap: "wrap" }}>
                <RotaryKnob
                  label="Attack"
                  value={adsr.attack}
                  onChange={(value) => setAdsr((prev) => ({ ...prev, attack: value }))}
                  min={0.001}
                  max={1.5}
                  step={0.001}
                  defaultValue={0.01}
                />
                <RotaryKnob
                  label="Decay"
                  value={adsr.decay}
                  onChange={(value) => setAdsr((prev) => ({ ...prev, decay: value }))}
                  min={0.01}
                  max={2}
                  step={0.01}
                  defaultValue={0.1}
                />
                <RotaryKnob
                  label="Sustain"
                  value={adsr.sustain}
                  onChange={(value) => setAdsr((prev) => ({ ...prev, sustain: value }))}
                  min={0}
                  max={1}
                  step={0.01}
                  defaultValue={0.7}
                />
                <RotaryKnob
                  label="Release"
                  value={adsr.release}
                  onChange={(value) => setAdsr((prev) => ({ ...prev, release: value }))}
                  min={0.02}
                  max={3}
                  step={0.01}
                  defaultValue={0.3}
                />
              </div>
            </Section>

            <Section title="Filter" icon="🜁">
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                  Mode
                </div>
                <select
                  value={filter.type}
                  onChange={(e) => setFilter((prev) => ({ ...prev, type: e.target.value }))}
                  style={{
                    width: "100%",
                    height: 40,
                    borderRadius: T.radius,
                    border: `1px solid ${T.border}`,
                    background: T.surface,
                    color: T.text,
                    padding: "0 12px",
                    outline: "none",
                  }}
                >
                  {FILTER_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 18, flexWrap: "wrap" }}>
                <RotaryKnob
                  label="Cutoff"
                  value={filter.cutoff}
                  onChange={(value) => setFilter((prev) => ({ ...prev, cutoff: value }))}
                  min={60}
                  max={20000}
                  step={1}
                  defaultValue={18000}
                  lfoMod={lfoDisplay.cutoff}
                />
                <RotaryKnob
                  label="Reso"
                  value={filter.resonance}
                  onChange={(value) => setFilter((prev) => ({ ...prev, resonance: value }))}
                  min={0.1}
                  max={20}
                  step={0.1}
                  defaultValue={0.7}
                  lfoMod={lfoDisplay.resonance}
                />
              </div>
            </Section>

            <Section title="Quick Reference" icon="📖">
              <div style={{ fontSize: 10, lineHeight: 2, color: T.textDim, fontFamily: T.font }}>
                <div><b style={{ color: T.amber }}>x</b> — waveform phase input</div>
                <div><b style={{ color: T.amber }}>t</b> — time in seconds</div>
                <div><b style={{ color: T.amber }}>freq</b> — note frequency (Hz)</div>
                <div><b style={{ color: T.amber }}>note</b> — MIDI note number</div>
                <div><b style={{ color: T.amber }}>velocity</b> — key velocity (0–1)</div>
                <div><b style={{ color: T.amber }}>a b c d</b> — slider parameters</div>
              </div>
              <div style={{
                marginTop: 12, padding: 10, borderRadius: 3,
                background: "#0a0f0a", border: `1px solid ${T.border}`,
                fontSize: 12, color: T.textDim, lineHeight: 1.8,
                fontFamily: "'Share Tech Mono', 'Courier New', monospace",
              }}>
                <div style={{ color: T.textMuted, fontSize: 9, fontWeight: 700, marginBottom: 4, fontFamily: T.font, textTransform: "uppercase", letterSpacing: 1.5 }}>
                  Try these
                </div>
                <div style={{ color: T.green, textShadow: "0 0 6px rgba(51,255,102,0.3)" }}>sin(x)</div>
                <div style={{ color: T.green, textShadow: "0 0 6px rgba(51,255,102,0.3)" }}>sin(a*x) + 0.2*sin(3*x)</div>
                <div style={{ color: T.green, textShadow: "0 0 6px rgba(51,255,102,0.3)" }}>tanh(sin(x) + b*sin(2*x))</div>
                <div style={{ color: T.green, textShadow: "0 0 6px rgba(51,255,102,0.3)" }}>sin(x) * exp(-0.001*t)</div>
              </div>
            </Section>

            <Section title="LFO Modulation" icon="〰">
              {lfos.map((lfo, i) => (
                <div key={i} style={{
                  marginBottom: i < 2 ? 8 : 0, borderRadius: T.radius,
                  border: `1px solid ${lfo.enabled ? "rgba(255,180,60,0.25)" : T.border}`,
                  background: lfo.enabled ? T.accentSoft : T.surface,
                  overflow: "hidden", transition: "all 100ms",
                }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 10px",
                  }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: T.amber, fontFamily: T.font, letterSpacing: 1 }}>
                      LFO {i + 1}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 9, color: T.textDim, fontFamily: T.font }}>
                      → {LFO_TARGETS.find(t => t.value === lfo.target)?.label}
                    </span>
                    <div
                      onClick={() => updateLfo(i, "enabled", !lfo.enabled)}
                      style={{
                        width: 32, height: 16, borderRadius: 2, padding: 2,
                        background: lfo.enabled ? T.accent : "#181208",
                        border: `1px solid ${lfo.enabled ? T.accent : T.borderHi}`,
                        cursor: "pointer", transition: "all 100ms",
                        display: "flex", alignItems: "center",
                        justifyContent: lfo.enabled ? "flex-end" : "flex-start",
                        boxShadow: lfo.enabled ? `0 0 6px ${T.accentGlow}` : "none",
                      }}
                    >
                      <div style={{
                        width: 10, height: 10, borderRadius: 1,
                        background: lfo.enabled ? "#f0e6d2" : T.textMuted, transition: "all 100ms",
                      }} />
                    </div>
                  </div>
                  {lfo.enabled && (
                    <div style={{ padding: "4px 10px 10px", borderTop: `1px solid ${T.border}` }}>
                      <LfoScope shape={lfo.shape} rate={lfo.rate} lfoOutputRef={lfoOutputRef} index={i} />
                      <div style={{ display: "flex", gap: 4, marginTop: 6, marginBottom: 6 }}>
                        {LFO_SHAPES.map((s) => (
                          <button key={s} onClick={() => updateLfo(i, "shape", s)} style={{
                            flex: 1, height: 22, fontSize: 8, fontWeight: 700,
                            fontFamily: T.font, letterSpacing: 0.8, textTransform: "uppercase",
                            border: `1px solid ${lfo.shape === s ? T.accent : T.border}`,
                            borderRadius: 2, cursor: "pointer",
                            background: lfo.shape === s ? "linear-gradient(180deg, #cc6e08, #a05500)" : "linear-gradient(180deg, #2e2820, #1a1510)",
                            color: lfo.shape === s ? "#f0e6d2" : T.textDim,
                            padding: 0,
                          }}>
                            {s === "s&h" ? "S&H" : s.slice(0, 3).toUpperCase()}
                          </button>
                        ))}
                      </div>
                      <div style={{ marginBottom: 4 }}>
                        <select
                          value={lfo.target}
                          onChange={(e) => updateLfo(i, "target", e.target.value)}
                          style={{
                            width: "100%", height: 26, borderRadius: 2, fontSize: 9,
                            border: `1px solid ${T.border}`, background: "#181208",
                            color: T.text, padding: "0 6px", outline: "none",
                            fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase",
                          }}
                        >
                          {LFO_TARGETS.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                        <RotaryKnob label="Rate" value={lfo.rate} onChange={(v) => updateLfo(i, "rate", v)}
                          min={0.05} max={10} step={0.05} size={44} log />
                        <RotaryKnob label="Depth" value={lfo.depth} onChange={(v) => updateLfo(i, "depth", v)}
                          min={0} max={5} step={0.01} size={44} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </Section>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

import React, { useState, useRef, useCallback, useEffect } from "react";
import { clamp, T } from "../../engine";
import { WAVE_SHAPES } from "../../presets";
import { Section } from "../shared";

const WAVE_RES = 256;

export function WaveDrawer({ onUseWave }) {
  const canvasRef = useRef(null);
  const [wave, setWave] = useState(() => {
    const w = new Float32Array(WAVE_RES);
    for (let i = 0; i < WAVE_RES; i++) w[i] = Math.sin((i / WAVE_RES) * Math.PI * 2);
    return w;
  });
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState("draw");

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
        <div className="crt-screen" style={{ width: "100%", height: 300, cursor: "crosshair", borderRadius: T.radius }}>
          <canvas
            ref={canvasRef}
            width={800}
            height={300}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{
              width: "100%", height: "100%", borderRadius: T.radius,
              border: `1px solid ${T.border}`,
              touchAction: "none",
            }}
          />
        </div>
      </Section>

      <Section title="Load Shape" icon="📐" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {WAVE_SHAPES.map((s) => (
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

import React, { useRef, useEffect, useState } from "react";
import { compile } from "mathjs";
import { T } from "../../engine/themes.js";
import { clamp } from "../../engine/types.js";

export function PlotCanvas({ equation, params, xScale, yScale, drawnWave, lfoParams }) {
  const ref = useRef(null);
  const [error, setError] = useState("");
  const hasLfoMod = lfoParams && (lfoParams.a !== 0 || lfoParams.b !== 0 || lfoParams.c !== 0 || lfoParams.d !== 0);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const W = c.width, H = c.height;

    ctx.fillStyle = T.plotBg;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = T.plotGrid;
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 8; i++) {
      const g = (i / 8) * W;
      ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(W, g); ctx.stroke();
    }

    ctx.strokeStyle = T.plotAxis;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();

    try {
      setError("");

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

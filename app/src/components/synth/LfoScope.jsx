import React, { useRef, useEffect } from "react";
import { T } from "../../engine/themes.js";
import { lfoSample } from "../../engine/lfo.js";
import { clamp } from "../../engine/types.js";

export function LfoScope({ shape, rate, lfoOutputRef, index }) {
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
      ctx.strokeStyle = T.border;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
      ctx.strokeStyle = T.amber;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = "rgba(255,170,0,0.4)";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      for (let px = 0; px < w; px++) {
        const phase = (px / w) * 2;
        const val = lfoSample(shape, phase, 0);
        const py = (1 - val) * h / 2;
        px === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
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

import React, { useRef, useEffect } from "react";
import { T } from "../../engine/themes.js";

export function Spectrum({ analyserRef }) {
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

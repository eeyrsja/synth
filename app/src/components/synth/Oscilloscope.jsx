import React, { useRef, useEffect } from "react";
import { T } from "../../engine/themes.js";
import { midiToFreq } from "../../engine/types.js";

export function Oscilloscope({ analyserRef, heldNotesRef, audioCtxRef }) {
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

      let peak = 0;
      for (let i = 0; i < bufLen; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
      peak = Math.max(peak, 0.01);
      const prev = smoothPeakRef.current;
      smoothPeakRef.current = peak > prev ? peak : prev * 0.95 + peak * 0.05;
      const scale = smoothPeakRef.current;

      let periodSamples = bufLen;
      const sr = audioCtxRef.current ? audioCtxRef.current.sampleRate : 44100;
      const notes = heldNotesRef.current;
      if (notes && notes.size > 0) {
        const lowestNote = Math.min(...notes);
        const lowestFreq = midiToFreq(lowestNote);
        if (lowestFreq > 0) {
          periodSamples = Math.round(sr / lowestFreq);
        }
      }

      const displaySamples = Math.min(periodSamples * 2, bufLen - 1);

      let triggerIdx = 0;
      const searchEnd = Math.min(bufLen - displaySamples, periodSamples * 2);
      for (let i = 1; i < searchEnd; i++) {
        if (data[i - 1] <= 0 && data[i] > 0) { triggerIdx = i; break; }
      }

      ctx.fillStyle = T.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = T.borderHi;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
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

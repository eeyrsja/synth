import React, { useRef, useEffect } from "react";
import { T } from "../../engine/themes.js";

export function AdsrGraph({ adsr }) {
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

    ctx.beginPath();
    ctx.moveTo(x0, yBot);
    ctx.lineTo(x0 + aW, yTop);
    ctx.lineTo(x0 + aW + dW, ySus);
    ctx.lineTo(x0 + aW + dW + sW, ySus);
    ctx.lineTo(x0 + aW + dW + sW + rW, yBot);
    ctx.closePath();
    ctx.fillStyle = "rgba(51,255,102,0.08)";
    ctx.fill();

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

    [
      [x0, yBot], [x0 + aW, yTop], [x0 + aW + dW, ySus],
      [x0 + aW + dW + sW, ySus], [x0 + aW + dW + sW + rW, yBot],
    ].forEach(([dx, dy]) => {
      ctx.beginPath(); ctx.arc(dx, dy, 3, 0, Math.PI * 2);
      ctx.fillStyle = T.green; ctx.fill();
    });

    ctx.font = `9px ${T.font}`;
    ctx.fillStyle = T.textMuted;
    ctx.textAlign = "center";
    ["A", "D", "S", "R"].forEach((l, i) => {
      const cx = [x0 + aW / 2, x0 + aW + dW / 2, x0 + aW + dW + sW / 2, x0 + aW + dW + sW + rW / 2][i];
      ctx.fillText(l, cx, H - 2);
    });

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

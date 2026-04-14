import React, { useRef } from "react";
import { T } from "../../engine/themes.js";
import { clamp } from "../../engine/types.js";

export function RotaryKnob({ label, value, onChange, min = 0, max = 1, step = 0.01, size = 52, defaultValue, lfoMod, log }) {
  const dragRef = useRef(null);
  const hasLfo = lfoMod != null && lfoMod !== 0;
  const modulated = hasLfo ? clamp(value + lfoMod, min, max) : value;
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
      <div style={{ position: "relative", width: size, height: size, cursor: "grab", touchAction: "none" }} onPointerDown={onDown}>
        <svg width={size} height={size} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}>
          <path d={arcD(-135, 135, tr)} fill="none" stroke={T.border} strokeWidth={2.5} strokeLinecap="round" />
          {norm > 0.005 && <path d={arcD(-135, angle, tr)} fill="none" stroke={T.accent} strokeWidth={2.5} strokeLinecap="round" />}
          {hasLfo && modAngle !== angle && (
            <path
              d={arcD(Math.min(angle, modAngle), Math.max(angle, modAngle), tr + 0.5)}
              fill="none" stroke={T.accent} strokeWidth={5} strokeLinecap="round"
              opacity={0.3}
            />
          )}
        </svg>
        <div className="knob-3d" style={{
          position: "absolute",
          top: r - ir, left: r - ir,
          width: ir * 2, height: ir * 2,
          transform: `rotate(${angle}deg)`,
          pointerEvents: "none"
        }}>
          <div className="knob-3d-tick" />
        </div>
        <svg width={size} height={size} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}>
          {hasLfo && (
            <circle cx={mpx} cy={mpy} r={3} fill={T.accent} opacity={0.85}>
              <animate attributeName="opacity" values="0.85;0.4;0.85" dur="0.6s" repeatCount="indefinite" />
            </circle>
          )}
        </svg>
      </div>
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

import React from "react";
import { T } from "../../engine/themes.js";
import { clamp } from "../../engine/types.js";

export function Knob({ label, value, onChange, min = -5, max = 5, step = 0.001, compact = false, defaultValue, lfoMod }) {
  const showReset = defaultValue !== undefined && value !== defaultValue;
  const hasLfo = lfoMod != null && lfoMod !== 0;
  const modulated = hasLfo ? clamp(value + lfoMod, min, max) : value;
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

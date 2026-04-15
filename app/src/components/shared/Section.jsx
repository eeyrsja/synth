import React from "react";
import { T } from "../../engine/themes.js";

export function Pill({ children, glow = false }) {
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

export function Section({ title, icon, children, style: outerStyle }) {
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

export function FeaturePlaceholder({ label, description }) {
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

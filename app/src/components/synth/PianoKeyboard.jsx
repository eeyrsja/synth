import React, { useRef, useEffect } from "react";
import { T } from "../../engine/themes.js";

const BLACK_SET = new Set([1, 3, 6, 8, 10]);
const KB_LO = 48, KB_HI = 72;
const KB_WHITES = (() => { let c = 0; for (let i = KB_LO; i <= KB_HI; i++) if (!BLACK_SET.has(i % 12)) c++; return c; })();

function whitesBefore(note) {
  let c = 0;
  for (let i = KB_LO; i < note; i++) if (!BLACK_SET.has(i % 12)) c++;
  return c;
}

export function PianoKeyboard({ activeNotes, onNoteOn, onNoteOff }) {
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

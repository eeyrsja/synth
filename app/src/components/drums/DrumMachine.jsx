import React, { useState, useRef, useCallback, useEffect } from "react";
import { T } from "../../engine";
import { VL_PATTERNS, DEFAULT_DRUM_PARAMS } from "../../presets";
import { Section } from "../shared";
import { RotaryKnob } from "../shared";
import { DRUM_SOUNDS, triggerDrumSound } from "./drum-sounds.js";

const DrumMachine = React.forwardRef(function DrumMachine({ audioCtxRef, gainRef, setupAudio, tempo: sharedTempo, onTempoChange, syncPlaying, syncStartAt, syncEpoch, onToggleSync }, ref) {
  const [steps, setSteps] = useState({
    po:  Array(16).fill(0),
    pi:  Array(16).fill(0),
    sha: Array(16).fill(0),
  });
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [localTempo, setLocalTempo] = useState(120);
  const tempo = sharedTempo ?? localTempo;
  const setTempo = onTempoChange ?? setLocalTempo;
  const [drumParams, setDrumParams] = useState({
    po:  { pitch: 150, decay: 0.03, volume: 0.8 },
    pi:  { pitch: 1000, decay: 0.02, volume: 0.6 },
    sha: { pitch: 6000, decay: 0.16, volume: 0.5 },
  });

  React.useImperativeHandle(ref, () => ({
    getState: () => ({
      steps: { po: [...steps.po], pi: [...steps.pi], sha: [...steps.sha] },
      drumParams: JSON.parse(JSON.stringify(drumParams)),
      drumVolume, padVolume,
    }),
    loadState: (s) => {
      if (s.steps) setSteps({ po: [...s.steps.po], pi: [...s.steps.pi], sha: [...s.steps.sha] });
      if (s.drumParams) setDrumParams(JSON.parse(JSON.stringify(s.drumParams)));
      if (s.drumVolume != null) setDrumVolume(s.drumVolume);
      if (s.padVolume != null) setPadVolume(s.padVolume);
    },
  }));

  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;
  const drumParamsRef = useRef(drumParams);
  drumParamsRef.current = drumParams;
  const currentStepRef = useRef(-1);
  const nextStepTimeRef = useRef(0);
  const timerRef = useRef(null);
  const noiseBufferRef = useRef(null);
  const drumGainRef = useRef(null);
  const [drumVolume, setDrumVolume] = useState(0.8);
  const [padVolume, setPadVolume] = useState(0.85);

  useEffect(() => {
    if (drumGainRef.current) drumGainRef.current.gain.value = drumVolume;
  }, [drumVolume]);

  const ensureNoiseBuf = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return null;
    if (!noiseBufferRef.current) {
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      noiseBufferRef.current = buf;
    }
    return noiseBufferRef.current;
  }, [audioCtxRef]);

  const getDrumDest = useCallback(() => {
    if (drumGainRef.current) return drumGainRef.current;
    const ctx = audioCtxRef.current;
    if (!ctx || !gainRef.current) return null;
    const g = ctx.createGain();
    g.gain.value = 1.0;
    g.connect(gainRef.current);
    drumGainRef.current = g;
    return g;
  }, [audioCtxRef, gainRef]);

  const triggerSound = useCallback((type, time, level = 1) => {
    const ctx = audioCtxRef.current;
    const baseDest = getDrumDest();
    if (!ctx || !baseDest) return;
    const hitGain = ctx.createGain();
    hitGain.gain.value = level;
    hitGain.connect(baseDest);
    triggerDrumSound(ctx, hitGain, time, type, drumParamsRef.current[type], ensureNoiseBuf());
  }, [audioCtxRef, getDrumDest, ensureNoiseBuf]);

  const scheduler = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    while (nextStepTimeRef.current < ctx.currentTime + 0.1) {
      const step = currentStepRef.current;
      const s = stepsRef.current;
      const time = nextStepTimeRef.current;
      if (s.po[step]) triggerSound("po", time);
      if (s.pi[step]) triggerSound("pi", time);
      if (s.sha[step]) triggerSound("sha", time);
      const secondsPerStep = 60.0 / tempoRef.current / 4;
      nextStepTimeRef.current += secondsPerStep;
      currentStepRef.current = (currentStepRef.current + 1) % 16;
      setCurrentStep(currentStepRef.current);
    }
  }, [audioCtxRef, triggerSound]);

  const startSequencerAt = useCallback((startAt) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (timerRef.current) clearInterval(timerRef.current);
    currentStepRef.current = 0;
    nextStepTimeRef.current = startAt ?? (ctx.currentTime + 0.05);
    setCurrentStep(0);
    setPlaying(true);
    timerRef.current = setInterval(scheduler, 25);
  }, [audioCtxRef, scheduler]);

  const stopSequencer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setPlaying(false);
    setCurrentStep(-1);
    currentStepRef.current = -1;
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (syncPlaying) startSequencerAt(syncStartAt);
    else stopSequencer();
  }, [syncPlaying, syncStartAt, syncEpoch, startSequencerAt, stopSequencer]);

  const toggleStep = (sound, idx) => {
    setSteps(prev => {
      const next = { ...prev };
      next[sound] = [...prev[sound]];
      next[sound][idx] = next[sound][idx] ? 0 : 1;
      return next;
    });
  };

  const loadPattern = (pattern) => {
    setSteps({
      po:  [...pattern.steps.po],
      pi:  [...pattern.steps.pi],
      sha: [...pattern.steps.sha],
    });
    setTempo(pattern.tempo);
  };

  const clearPattern = () => {
    setSteps({
      po:  Array(16).fill(0),
      pi:  Array(16).fill(0),
      sha: Array(16).fill(0),
    });
  };

  const preview = async (type) => {
    if (!audioCtxRef.current) await setupAudio();
    else if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();
    triggerSound(type, audioCtxRef.current.currentTime, padVolume);
  };

  const updateParam = (sound, key, val) => {
    setDrumParams(prev => ({
      ...prev,
      [sound]: { ...prev[sound], [key]: val },
    }));
  };

  // ── Drum User Presets (localStorage) ──────────────────────────
  const [drumPresets, setDrumPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem("wavecraft_drum_presets") || "[]"); } catch { return []; }
  });
  const [newDrumPresetName, setNewDrumPresetName] = useState("");

  const saveDrumPreset = () => {
    const name = newDrumPresetName.trim();
    if (!name) return;
    const preset = {
      name,
      steps: { po: [...steps.po], pi: [...steps.pi], sha: [...steps.sha] },
      tempo,
      drumParams: JSON.parse(JSON.stringify(drumParams)),
    };
    const existing = drumPresets.findIndex((p) => p.name === name);
    const next = [...drumPresets];
    if (existing >= 0) next[existing] = preset; else next.push(preset);
    setDrumPresets(next);
    localStorage.setItem("wavecraft_drum_presets", JSON.stringify(next));
    setNewDrumPresetName("");
  };

  const loadDrumPreset = (p) => {
    setSteps({ po: [...p.steps.po], pi: [...p.steps.pi], sha: [...p.steps.sha] });
    setTempo(p.tempo);
    if (p.drumParams) setDrumParams(JSON.parse(JSON.stringify(p.drumParams)));
  };

  const deleteDrumPreset = (name) => {
    const next = drumPresets.filter((p) => p.name !== name);
    setDrumPresets(next);
    localStorage.setItem("wavecraft_drum_presets", JSON.stringify(next));
  };

  const btnPrimary = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    height: 38, padding: "0 18px", borderRadius: 3,
    border: "1px solid rgba(255,180,60,0.3)",
    background: "linear-gradient(180deg, #cc6e08 0%, #a05500 100%)",
    color: "#f0e6d2",
    fontSize: 12, fontWeight: 700, cursor: "pointer",
    fontFamily: T.font, textTransform: "uppercase", letterSpacing: 1,
    boxShadow: `0 2px 8px ${T.accentGlow}, inset 0 1px 0 rgba(255,255,255,0.1)`,
  };
  const btnGhost = {
    ...btnPrimary,
    background: "linear-gradient(180deg, #2e2820 0%, #1a1510 100%)",
    color: T.text,
    border: `1px solid ${T.borderHi}`,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 4px rgba(0,0,0,0.3)",
  };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 20px 40px" }}>
      {/* Transport & Tempo */}
      <Section title="VL-Tone Drum Machine" icon="🥁">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <button
            onClick={onToggleSync}
            style={{
              ...btnPrimary,
              background: playing
                ? `linear-gradient(180deg, ${T.red}, #881a00)`
                : "linear-gradient(180deg, #cc6e08, #a05500)",
              boxShadow: playing
                ? "0 2px 12px rgba(204,51,0,0.4)"
                : `0 2px 8px ${T.accentGlow}`,
            }}
          >
            {playing ? "■ Stop" : "▶ Play"}
          </button>
          <button onClick={clearPattern} style={btnGhost}>Clear</button>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.textDim, fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase" }}>BPM</span>
            <input
              type="range" min={60} max={240} step={1} value={tempo}
              onChange={(e) => setTempo(Number(e.target.value))}
              style={{ width: 120, cursor: "pointer", accentColor: T.accent }}
            />
            <span style={{
              fontSize: 14, fontVariantNumeric: "tabular-nums", color: T.green,
              fontWeight: 700, fontFamily: "'VT323', 'Courier New', monospace",
              textShadow: "0 0 8px rgba(51,255,102,0.5)", minWidth: 32,
            }}>
              {tempo}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.textDim, fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase" }}>VOL</span>
            <input
              type="range" min={0} max={1} step={0.01} value={drumVolume}
              onChange={(e) => setDrumVolume(Number(e.target.value))}
              style={{ width: 80, cursor: "pointer", accentColor: T.accent }}
            />
            <span style={{
              fontSize: 14, fontVariantNumeric: "tabular-nums", color: T.green,
              fontWeight: 700, fontFamily: "'VT323', 'Courier New', monospace",
              textShadow: "0 0 8px rgba(51,255,102,0.5)", minWidth: 28,
            }}>
              {Math.round(drumVolume * 100)}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.textDim, fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase" }}>PAD</span>
            <input
              type="range" min={0} max={1} step={0.01} value={padVolume}
              onChange={(e) => setPadVolume(Number(e.target.value))}
              style={{ width: 80, cursor: "pointer", accentColor: T.accent }}
            />
            <span style={{
              fontSize: 14, fontVariantNumeric: "tabular-nums", color: T.green,
              fontWeight: 700, fontFamily: "'VT323', 'Courier New', monospace",
              textShadow: "0 0 8px rgba(51,255,102,0.5)", minWidth: 28,
            }}>
              {Math.round(padVolume * 100)}
            </span>
          </div>
        </div>

        {/* Step Sequencer Grid */}
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "flex", gap: 3, marginBottom: 4, paddingLeft: 64 }}>
            {Array.from({ length: 16 }, (_, i) => (
              <div key={i} style={{
                width: 42, textAlign: "center", fontSize: 8, fontWeight: 700,
                color: currentStep === i ? T.green : (i % 4 === 0 ? T.textDim : T.textMuted),
                fontFamily: T.font, letterSpacing: 0.5,
              }}>
                {i + 1}
              </div>
            ))}
          </div>

          {DRUM_SOUNDS.map((sound) => (
            <div key={sound.id} style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 3 }}>
              <button
                onClick={() => preview(sound.id)}
                title={`Preview ${sound.label}`}
                style={{
                  width: 60, height: 42, border: `1px solid ${T.border}`,
                  borderRadius: T.radius, cursor: "pointer",
                  background: "linear-gradient(180deg, #2e2820, #1a1510)",
                  display: "flex", flexDirection: "column", alignItems: "center",
                  justifyContent: "center", gap: 1, padding: 0,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 900, color: sound.color, fontFamily: T.font }}>
                  {sound.label}
                </span>
                <span style={{ fontSize: 7, color: T.textMuted, fontFamily: T.font, letterSpacing: 0.5, textTransform: "uppercase" }}>
                  {sound.desc}
                </span>
              </button>

              {steps[sound.id].map((active, i) => (
                <div
                  key={i}
                  onClick={() => toggleStep(sound.id, i)}
                  style={{
                    width: 42, height: 42, borderRadius: T.radius,
                    border: `1px solid ${
                      currentStep === i ? T.green
                      : active ? sound.color
                      : i % 4 === 0 ? T.borderHi : T.border
                    }`,
                    background: active
                      ? `linear-gradient(180deg, ${sound.color}33, ${sound.color}18)`
                      : (i % 8 < 4 ? T.surface : T.surfaceAlt),
                    cursor: "pointer",
                    transition: "all 60ms",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: currentStep === i
                      ? `0 0 8px ${T.greenGlow}, inset 0 0 12px ${T.greenGlow}`
                      : active ? `inset 0 0 8px ${sound.color}22` : "none",
                  }}
                >
                  {active ? (
                    <div style={{
                      width: 14, height: 14, borderRadius: 2,
                      background: sound.color,
                      boxShadow: `0 0 6px ${sound.color}88`,
                    }} />
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>

        {playing && (
          <div style={{
            marginTop: 8, height: 4, background: T.surface,
            borderRadius: 2, border: `1px solid ${T.border}`,
            position: "relative", overflow: "hidden",
          }}>
            <div style={{
              position: "absolute",
              left: `${(currentStep / 16) * 100}%`,
              width: `${100 / 16}%`,
              top: 0, bottom: 0,
              background: T.green,
              boxShadow: `0 0 6px ${T.greenGlow}`,
              transition: "left 50ms",
            }} />
          </div>
        )}
      </Section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <Section title="VL-1 Rhythm Presets" icon="🎵">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {VL_PATTERNS.map((p) => (
              <button
                key={p.name}
                onClick={() => loadPattern(p)}
                style={{
                  padding: "8px 10px", borderRadius: 2,
                  border: `1px solid ${T.border}`,
                  background: "linear-gradient(180deg, #2e2820, #1a1510)",
                  color: T.textDim,
                  fontSize: 10, fontWeight: 700, cursor: "pointer",
                  textAlign: "left", transition: "all 80ms",
                  fontFamily: T.font, letterSpacing: 0.8, textTransform: "uppercase",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                }}
              >
                <span style={{ color: T.text }}>{p.name}</span>
                <span style={{ marginLeft: 6, fontSize: 9, color: T.textMuted }}>{p.tempo}bpm</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Sound Controls" icon="🎛">
          {DRUM_SOUNDS.map((sound) => {
            const p = drumParams[sound.id];
            return (
              <div key={sound.id} style={{
                marginBottom: 12, borderRadius: T.radius,
                border: `1px solid ${T.border}`, background: T.surface,
                padding: "10px 12px",
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: sound.color,
                  fontFamily: T.font, letterSpacing: 1.5, textTransform: "uppercase",
                  marginBottom: 8,
                }}>
                  {sound.label} — {sound.desc}
                </div>
                <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
                  <RotaryKnob
                    label="Pitch"
                    value={p.pitch}
                    onChange={(v) => updateParam(sound.id, "pitch", v)}
                    min={sound.id === "sha" ? 1000 : 40}
                    max={sound.id === "sha" ? 12000 : (sound.id === "pi" ? 4000 : 500)}
                    step={sound.id === "sha" ? 100 : 1}
                    size={44}
                  />
                  <RotaryKnob
                    label="Decay"
                    value={p.decay}
                    onChange={(v) => updateParam(sound.id, "decay", v)}
                    min={0.005}
                    max={sound.id === "sha" ? 0.5 : 0.15}
                    step={0.001}
                    size={44}
                  />
                  <RotaryKnob
                    label="Volume"
                    value={p.volume}
                    onChange={(v) => updateParam(sound.id, "volume", v)}
                    min={0}
                    max={1}
                    step={0.01}
                    size={44}
                  />
                </div>
              </div>
            );
          })}
        </Section>
      </div>

      {/* My Drum Presets */}
      <Section title="My Drum Presets" icon="💾" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <input
            value={newDrumPresetName}
            onChange={(e) => setNewDrumPresetName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveDrumPreset()}
            placeholder="Pattern name…"
            style={{
              flex: 1, height: 36, fontSize: 13, padding: "0 10px",
              background: T.surface, color: T.white,
              border: `1px solid ${T.border}`, borderRadius: 8,
              outline: "none", minWidth: 0, fontFamily: T.font,
            }}
          />
          <button onClick={saveDrumPreset} disabled={!newDrumPresetName.trim()} style={{
            ...btnPrimary, height: 34, padding: "0 14px", fontSize: 10,
            opacity: newDrumPresetName.trim() ? 1 : 0.4,
            cursor: newDrumPresetName.trim() ? "pointer" : "not-allowed",
          }}>
            Save
          </button>
        </div>
        {drumPresets.length === 0 ? (
          <div style={{ fontSize: 12, color: T.textMuted, textAlign: "center", padding: "8px 0" }}>
            No saved drum presets yet
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {drumPresets.map((p) => (
              <div key={p.name} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 10px", borderRadius: 2,
                border: `1px solid ${T.border}`,
                background: "linear-gradient(180deg, #2e2820, #1a1510)",
              }}>
                <button onClick={() => loadDrumPreset(p)} style={{
                  flex: 1, background: "none", border: "none",
                  color: T.text, fontSize: 10, fontWeight: 700,
                  cursor: "pointer", textAlign: "left", padding: 0,
                  fontFamily: T.font, letterSpacing: 0.8, textTransform: "uppercase",
                }}>
                  {p.name}
                </button>
                <span style={{ fontSize: 9, color: T.textMuted, fontFamily: T.font }}>{p.tempo}bpm</span>
                <button onClick={() => deleteDrumPreset(p.name)} title="Delete" style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: T.textMuted, fontSize: 14, padding: "0 2px", lineHeight: 1,
                }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="About" icon="📖" style={{ marginTop: 12 }}>
        <div style={{ fontSize: 10, lineHeight: 2, color: T.textDim, fontFamily: T.font }}>
          <div>Inspired by the <b style={{ color: T.amber }}>Casio VL-Tone VL-1</b> (1979–1984)</div>
          <div>Three internal drum sounds: <b style={{ color: T.accent }}>Po</b> (bass, 30ms), <b style={{ color: T.green }}>Pi</b> (click, 20ms), <b style={{ color: T.amber }}>Sha</b> (noise, 160ms)</div>
          <div>Used in 10 built-in rhythm patterns — famously heard on Trio's "Da Da Da"</div>
        </div>
      </Section>
    </div>
  );
});

export { DrumMachine };

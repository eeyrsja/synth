import React, { useState, useRef, useCallback, useEffect } from "react";
import { T } from "../../engine";
import { Section, RotaryKnob } from "../shared";
import { PO32_SOUNDS, PO32_TEMPO_PRESETS, triggerPO32Sound } from "./drum-sounds.js";

const PO32Tonic = React.forwardRef(function PO32Tonic({ audioCtxRef, gainRef, setupAudio, tempo: sharedTempo, onTempoChange, syncPlaying, syncStartAt, syncEpoch, onToggleSync }, ref) {
  const emptyGrid = () => Array.from({ length: 16 }, () => Array(16).fill(0));
  const [grid, setGrid] = useState(emptyGrid);
  const [accents, setAccents] = useState(() => Array(16).fill(0));
  const [selectedSound, setSelectedSound] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [localTempo, setLocalTempo] = useState(120);
  const tempo = sharedTempo ?? localTempo;
  const setTempo = onTempoChange ?? setLocalTempo;
  const [swing, setSwing] = useState(0);
  const [soundParams, setSoundParams] = useState(() =>
    Array.from({ length: 16 }, () => ({ pitch: 1.0, morph: 0.5 }))
  );
  const [mutedChannels, setMutedChannels] = useState([false, false, false, false]);

  React.useImperativeHandle(ref, () => ({
    getState: () => ({
      grid: grid.map(r => [...r]),
      accents: [...accents],
      swing,
      soundParams: JSON.parse(JSON.stringify(soundParams)),
      mutedChannels: [...mutedChannels],
      po32Volume, padVolume,
    }),
    loadState: (s) => {
      if (s.grid) setGrid(s.grid.map(r => [...r]));
      if (s.accents) setAccents([...s.accents]);
      if (s.swing != null) setSwing(s.swing);
      if (s.soundParams) setSoundParams(JSON.parse(JSON.stringify(s.soundParams)));
      if (s.mutedChannels) setMutedChannels([...s.mutedChannels]);
      if (s.po32Volume != null) setPo32Volume(s.po32Volume);
      if (s.padVolume != null) setPadVolume(s.padVolume);
    },
  }));

  const gridRef = useRef(grid);       gridRef.current = grid;
  const accentsRef = useRef(accents);  accentsRef.current = accents;
  const tempoRef = useRef(tempo);      tempoRef.current = tempo;
  const swingRef = useRef(swing);      swingRef.current = swing;
  const soundParamsRef = useRef(soundParams); soundParamsRef.current = soundParams;
  const mutedRef = useRef(mutedChannels);     mutedRef.current = mutedChannels;
  const currentStepRef = useRef(-1);
  const nextStepTimeRef = useRef(0);
  const timerRef = useRef(null);
  const noiseBufferRef = useRef(null);
  const po32GainRef = useRef(null);
  const stepCountRef = useRef(0);
  const [po32Volume, setPo32Volume] = useState(0.8);
  const [padVolume, setPadVolume] = useState(0.85);

  useEffect(() => {
    if (po32GainRef.current) po32GainRef.current.gain.value = po32Volume;
  }, [po32Volume]);

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

  const getDest = useCallback(() => {
    if (po32GainRef.current) return po32GainRef.current;
    const ctx = audioCtxRef.current;
    if (!ctx || !gainRef.current) return null;
    const g = ctx.createGain(); g.gain.value = 1.0;
    g.connect(gainRef.current);
    po32GainRef.current = g;
    return g;
  }, [audioCtxRef, gainRef]);

  const triggerSound = useCallback((soundId, time, accent, level = 1) => {
    const ctx = audioCtxRef.current;
    const dest = getDest();
    if (!ctx || !dest) return;
    const ch = PO32_SOUNDS[soundId].ch;
    if (mutedRef.current[ch - 1]) return;
    const p = soundParamsRef.current[soundId];
    const hitGain = ctx.createGain();
    hitGain.gain.value = (accent ? 1.3 : 0.8) * level;
    hitGain.connect(dest);
    triggerPO32Sound(ctx, hitGain, time, soundId, p, ensureNoiseBuf());
  }, [audioCtxRef, getDest, ensureNoiseBuf]);

  const scheduler = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    while (nextStepTimeRef.current < ctx.currentTime + 0.1) {
      const step = currentStepRef.current;
      const g = gridRef.current;
      const acc = accentsRef.current;
      const time = nextStepTimeRef.current;
      for (let s = 0; s < 16; s++) {
        if (g[s][step]) triggerSound(s, time, acc[step]);
      }
      const baseInterval = 60.0 / tempoRef.current / 4;
      const swingAmt = swingRef.current;
      const isEven = stepCountRef.current % 2 === 0;
      const interval = isEven
        ? baseInterval * (1 + swingAmt * 0.33)
        : baseInterval * (1 - swingAmt * 0.33);
      nextStepTimeRef.current += interval;
      stepCountRef.current++;
      currentStepRef.current = (currentStepRef.current + 1) % 16;
      setCurrentStep(currentStepRef.current);
    }
  }, [audioCtxRef, triggerSound]);

  const startSequencerAt = useCallback((startAt) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (timerRef.current) clearInterval(timerRef.current);
    currentStepRef.current = 0;
    stepCountRef.current = 0;
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

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  useEffect(() => {
    if (syncPlaying) startSequencerAt(syncStartAt);
    else stopSequencer();
  }, [syncPlaying, syncStartAt, syncEpoch, startSequencerAt, stopSequencer]);

  const toggleStep = (sound, idx) => {
    setGrid(prev => {
      const next = prev.map(r => [...r]);
      next[sound][idx] = next[sound][idx] ? 0 : 1;
      return next;
    });
  };

  const toggleAccent = (idx) => {
    setAccents(prev => {
      const next = [...prev];
      next[idx] = next[idx] ? 0 : 1;
      return next;
    });
  };

  const toggleMute = (ch) => {
    setMutedChannels(prev => {
      const next = [...prev];
      next[ch] = !next[ch];
      return next;
    });
  };

  const clearPattern = () => {
    setGrid(emptyGrid());
    setAccents(Array(16).fill(0));
  };

  const preview = async (soundId) => {
    if (!audioCtxRef.current) await setupAudio();
    else if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();
    triggerSound(soundId, audioCtxRef.current.currentTime, false, padVolume);
  };

  const updateSoundParam = (soundId, key, val) => {
    setSoundParams(prev => {
      const next = [...prev];
      next[soundId] = { ...next[soundId], [key]: val };
      return next;
    });
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

  const sel = PO32_SOUNDS[selectedSound];

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 20px 40px" }}>
      <Section title="PO-32 Tonic" icon="🔲">
        {/* Transport */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <button
            onClick={onToggleSync}
            style={{
              ...btnPrimary,
              background: playing ? `linear-gradient(180deg, ${T.red}, #881a00)` : "linear-gradient(180deg, #cc6e08, #a05500)",
              boxShadow: playing ? "0 2px 12px rgba(204,51,0,0.4)" : `0 2px 8px ${T.accentGlow}`,
            }}
          >
            {playing ? "■ Stop" : "▶ Play"}
          </button>
          <button onClick={clearPattern} style={btnGhost}>Clear</button>

          <div style={{ display: "flex", gap: 3 }}>
            {PO32_TEMPO_PRESETS.map(tp => (
              <button key={tp.name} onClick={() => setTempo(tp.bpm)} style={{
                height: 28, padding: "0 10px", fontSize: 9, fontWeight: 700,
                fontFamily: T.font, letterSpacing: 0.8, textTransform: "uppercase",
                border: `1px solid ${tempo === tp.bpm ? T.accent : T.border}`,
                borderRadius: 2, cursor: "pointer",
                background: tempo === tp.bpm ? "linear-gradient(180deg, #cc6e08, #a05500)" : "linear-gradient(180deg, #2e2820, #1a1510)",
                color: tempo === tp.bpm ? "#f0e6d2" : T.textDim,
              }}>
                {tp.name}
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.textDim, fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase" }}>BPM</span>
            <input type="range" min={60} max={240} step={1} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} style={{ width: 100, cursor: "pointer", accentColor: T.accent }} />
            <span style={{ fontSize: 14, fontVariantNumeric: "tabular-nums", color: T.green, fontWeight: 700, fontFamily: "'VT323', 'Courier New', monospace", textShadow: "0 0 8px rgba(51,255,102,0.5)", minWidth: 32 }}>{tempo}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.textDim, fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase" }}>VOL</span>
            <input type="range" min={0} max={1} step={0.01} value={po32Volume} onChange={(e) => setPo32Volume(Number(e.target.value))} style={{ width: 80, cursor: "pointer", accentColor: T.accent }} />
            <span style={{ fontSize: 14, fontVariantNumeric: "tabular-nums", color: T.green, fontWeight: 700, fontFamily: "'VT323', 'Courier New', monospace", textShadow: "0 0 8px rgba(51,255,102,0.5)", minWidth: 28 }}>{Math.round(po32Volume * 100)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 707, color: T.textDim, fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase" }}>PAD</span>
            <input type="range" min={0} max={1} step={0.01} value={padVolume} onChange={(e) => setPadVolume(Number(e.target.value))} style={{ width: 80, cursor: "pointer", accentColor: T.accent }} />
            <span style={{ fontSize: 14, fontVariantNumeric: "tabular-nums", color: T.green, fontWeight: 700, fontFamily: "'VT323', 'Courier New', monospace", textShadow: "0 0 8px rgba(51,255,102,0.5)", minWidth: 28 }}>{Math.round(padVolume * 100)}</span>
          </div>
        </div>

        {/* Sound selector — 4×4 grid like the real PO-32 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, fontFamily: T.font, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>
            Sound — {sel.name}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 3 }}>
            {PO32_SOUNDS.map((s) => {
              const active = grid[s.id].some(v => v);
              return (
                <button key={s.id} onClick={() => setSelectedSound(s.id)} style={{
                  height: 36, border: `1px solid ${selectedSound === s.id ? s.color : active ? `${s.color}66` : T.border}`,
                  borderRadius: T.radius, cursor: "pointer", padding: 0,
                  background: selectedSound === s.id
                    ? `linear-gradient(180deg, ${s.color}44, ${s.color}22)`
                    : active ? `${s.color}11` : T.surface,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0,
                  boxShadow: selectedSound === s.id ? `0 0 8px ${s.color}44` : "none",
                }}>
                  <span style={{ fontSize: 9, fontWeight: 900, color: selectedSound === s.id ? s.color : T.textDim, fontFamily: T.font }}>{s.short}</span>
                  <span style={{ fontSize: 7, color: T.textMuted, fontFamily: T.font }}>{s.id + 1}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step grid for selected sound */}
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "flex", gap: 3, marginBottom: 2, paddingLeft: 2 }}>
            {Array.from({ length: 16 }, (_, i) => (
              <div key={i} style={{
                flex: 1, minWidth: 38, textAlign: "center", fontSize: 8, fontWeight: 700,
                color: currentStep === i ? T.green : (i % 4 === 0 ? T.textDim : T.textMuted),
                fontFamily: T.font,
              }}>
                {i + 1}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 3, marginBottom: 4 }}>
            {grid[selectedSound].map((active, i) => (
              <div key={i} onClick={() => toggleStep(selectedSound, i)} style={{
                flex: 1, minWidth: 38, height: 42, borderRadius: T.radius,
                border: `1px solid ${
                  currentStep === i ? T.green
                  : active ? sel.color
                  : i % 4 === 0 ? T.borderHi : T.border
                }`,
                background: active
                  ? `linear-gradient(180deg, ${sel.color}44, ${sel.color}22)`
                  : (i % 8 < 4 ? T.surface : T.surfaceAlt),
                cursor: "pointer", transition: "all 60ms",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: currentStep === i ? `0 0 8px ${T.greenGlow}, inset 0 0 12px ${T.greenGlow}` : active ? `inset 0 0 8px ${sel.color}22` : "none",
              }}>
                {active ? <div style={{ width: 14, height: 14, borderRadius: 2, background: sel.color, boxShadow: `0 0 6px ${sel.color}88` }} /> : null}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 3, marginBottom: 4 }}>
            {accents.map((acc, i) => (
              <div key={i} onClick={() => toggleAccent(i)} title="Accent" style={{
                flex: 1, minWidth: 38, height: 18, borderRadius: 2,
                border: `1px solid ${acc ? T.amber : T.border}`,
                background: acc ? `${T.amber}22` : "transparent",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 8, fontWeight: 900, color: acc ? T.amber : T.textMuted, fontFamily: T.font,
              }}>
                {acc ? "ACC" : "·"}
              </div>
            ))}
          </div>
        </div>

        {/* Compact overview */}
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, fontFamily: T.font, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Pattern Overview
          </div>
          {PO32_SOUNDS.map((s) => (
            <div key={s.id}
              onClick={() => setSelectedSound(s.id)}
              style={{
                display: "flex", alignItems: "center", gap: 2, marginBottom: 1,
                cursor: "pointer", opacity: mutedRef.current[s.ch - 1] ? 0.3 : 1,
                background: selectedSound === s.id ? `${s.color}0a` : "transparent",
                borderRadius: 2, padding: "1px 0",
              }}
            >
              <span style={{
                width: 30, fontSize: 7, fontWeight: 700, color: selectedSound === s.id ? s.color : T.textMuted,
                fontFamily: T.font, textAlign: "right", paddingRight: 4, flexShrink: 0,
              }}>{s.short}</span>
              {grid[s.id].map((active, i) => (
                <div key={i} style={{
                  flex: 1, minWidth: 4, height: 8, borderRadius: 1,
                  background: active ? s.color : (currentStep === i ? `${T.green}33` : T.border),
                  opacity: active ? 1 : 0.3,
                }} />
              ))}
            </div>
          ))}
        </div>

        {playing && (
          <div style={{
            marginTop: 6, height: 4, background: T.surface,
            borderRadius: 2, border: `1px solid ${T.border}`,
            position: "relative", overflow: "hidden",
          }}>
            <div style={{
              position: "absolute", left: `${(currentStep / 16) * 100}%`, width: `${100 / 16}%`,
              top: 0, bottom: 0, background: T.green,
              boxShadow: `0 0 6px ${T.greenGlow}`, transition: "left 50ms",
            }} />
          </div>
        )}
      </Section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <Section title={`Sound: ${sel.name}`} icon="🎛">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <button onClick={() => preview(selectedSound)} style={{
              ...btnGhost, height: 30, padding: "0 14px", fontSize: 10,
            }}>
              ▶ Preview
            </button>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: sel.color, boxShadow: `0 0 6px ${sel.color}66` }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: sel.color, fontFamily: T.font, letterSpacing: 1 }}>{sel.name}</span>
          </div>
          <div style={{ display: "flex", gap: 24, justifyContent: "center" }}>
            <RotaryKnob
              label="A · Pitch"
              value={soundParams[selectedSound].pitch}
              onChange={(v) => updateSoundParam(selectedSound, "pitch", v)}
              min={0.25} max={4} step={0.01} size={56}
            />
            <RotaryKnob
              label="B · Morph"
              value={soundParams[selectedSound].morph}
              onChange={(v) => updateSoundParam(selectedSound, "morph", v)}
              min={0} max={1} step={0.01} size={56}
            />
          </div>
        </Section>

        <Section title="Mixer" icon="🎚">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <RotaryKnob label="Swing" value={swing} onChange={setSwing} min={0} max={1} step={0.01} size={48} />
          </div>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, fontFamily: T.font, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>
            Channels
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {[1, 2, 3, 4].map(ch => {
              const chSounds = PO32_SOUNDS.filter(s => s.ch === ch);
              const muted = mutedChannels[ch - 1];
              return (
                <div key={ch} onClick={() => toggleMute(ch - 1)} style={{
                  padding: "6px 10px", borderRadius: T.radius,
                  border: `1px solid ${muted ? T.border : chSounds[0].color + "44"}`,
                  background: muted ? T.surfaceAlt : `${chSounds[0].color}0a`,
                  cursor: "pointer", transition: "all 80ms",
                  opacity: muted ? 0.4 : 1,
                }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: muted ? T.textMuted : T.text, fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 }}>
                    Ch {ch} {muted ? "(Muted)" : ""}
                  </div>
                  <div style={{ fontSize: 8, color: T.textMuted, fontFamily: T.font }}>
                    {chSounds.map(s => s.short).join(" · ")}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
});

export { PO32Tonic };

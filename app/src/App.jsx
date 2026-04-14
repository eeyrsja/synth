import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";

// ── Engine modules ──────────────────────────────────────────────────
import {
  DEFAULT_EQ, DEFAULT_ADSR, DEFAULT_FILTER, DEFAULT_LFO,
  LFO_SHAPES, LFO_TARGETS, FILTER_TYPES,
  withFxDefaults, clamp, midiToFreq, noteName,
} from "./engine/types.js";
import { T } from "./engine/themes.js";
import { compileEquation } from "./engine/equation.js";
import { rewireFxChain, syncFxParams, updateReverbDecay } from "./engine/effects.js";
import { lfoSample } from "./engine/lfo.js";
import {
  createEngineRefs, setupAudio as engineSetupAudio,
  noteOn as engineNoteOn, noteOff as engineNoteOff, panic as enginePanic,
  sendParams, sendScale, sendAdsr, sendEquation, sendDrawnWave,
} from "./engine/synth-engine.js";

// ── Presets ─────────────────────────────────────────────────────────
import { PRESETS } from "./presets/synth-presets.js";

// ── UI Components ───────────────────────────────────────────────────
import { Knob, RotaryKnob, Pill, Section } from "./components/shared";
import { PlotCanvas, PianoKeyboard, AdsrGraph, Oscilloscope, Spectrum, LfoScope } from "./components/synth";
import { WaveDrawer } from "./components/draw";
import { DrumMachine, PO32Tonic } from "./components/drums";

// ── API ─────────────────────────────────────────────────────────────
import { apiFetch, loginApi, signupApi, fetchCloudPresetsApi, saveCloudPresetApi, deleteCloudPresetApi, checkoutApi, refreshTokenApi } from "./api/client.js";

// ═══════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════
export default function GraphingCalculatorSynthApp() {
  const [page, setPage] = useState("synth"); // "synth" | "draw" | "drums"
  const [drumBpm, setDrumBpm] = useState(120);
  const [drumsPlaying, setDrumsPlaying] = useState(false);
  const [drumSyncStartAt, setDrumSyncStartAt] = useState(0);
  const [drumSyncEpoch, setDrumSyncEpoch] = useState(0);
  const drumMachineRef = useRef(null);
  const po32Ref = useRef(null);
  const [equationInput, setEquationInput] = useState(DEFAULT_EQ);
  const [equation, setEquation] = useState(DEFAULT_EQ);
  const [xScale, setXScale] = useState(1);
  const [yScale, setYScale] = useState(1);
  const [a, setA] = useState(1);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  const [d, setD] = useState(0);
  const [openEffect, setOpenEffect] = useState(null);
  const [fxParams, setFxParams] = useState(() => withFxDefaults());
  const [fxOrder, setFxOrder] = useState(["distortion", "chorus", "delay", "reverb"]);
  const [audioReady, setAudioReady] = useState(false);
  const [midiStatus, setMidiStatus] = useState("No MIDI connected");
  const [activeNotes, setActiveNotes] = useState([]);
  const [masterVolume, setMasterVolume] = useState(0.18);
  const [sampleRate, setSampleRate] = useState(44100);
  const [adsr, setAdsr] = useState({ ...DEFAULT_ADSR });
  const [filter, setFilter] = useState({ ...DEFAULT_FILTER });
  const [add7th, setAdd7th] = useState(false);

  // ── Auth & Cloud Presets ──────────────────────────────────────────
  const [authToken, setAuthToken] = useState(() => localStorage.getItem("wavecraft_token") || null);
  const [authUser, setAuthUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("wavecraft_user") || "null"); } catch { return null; }
  });
  const [authModal, setAuthModal] = useState(null);
  const [authForm, setAuthForm] = useState({ email: "", password: "", displayName: "" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [cloudPresets, setCloudPresets] = useState([]);
  const [cloudLoading, setCloudLoading] = useState(false);

  const doLogin = async () => {
    setAuthError(""); setAuthLoading(true);
    try {
      const { token, user } = await loginApi(authForm.email, authForm.password);
      setAuthToken(token); setAuthUser(user);
      localStorage.setItem("wavecraft_token", token);
      localStorage.setItem("wavecraft_user", JSON.stringify(user));
      setAuthModal(null); setAuthForm({ email: "", password: "", displayName: "" });
      fetchCloudPresets(token);
    } catch (e) { setAuthError(e.message); }
    setAuthLoading(false);
  };

  const doSignup = async () => {
    setAuthError(""); setAuthLoading(true);
    try {
      const { token, user } = await signupApi(authForm.email, authForm.password, authForm.displayName);
      setAuthToken(token); setAuthUser(user);
      localStorage.setItem("wavecraft_token", token);
      localStorage.setItem("wavecraft_user", JSON.stringify(user));
      setAuthModal(null); setAuthForm({ email: "", password: "", displayName: "" });
      fetchCloudPresets(token);
    } catch (e) { setAuthError(e.message); }
    setAuthLoading(false);
  };

  const doLogout = () => {
    setAuthToken(null); setAuthUser(null); setCloudPresets([]);
    localStorage.removeItem("wavecraft_token");
    localStorage.removeItem("wavecraft_user");
  };

  const fetchCloudPresets = async (token) => {
    setCloudLoading(true);
    try {
      const { presets } = await fetchCloudPresetsApi(token || authToken);
      setCloudPresets(presets);
    } catch { /* silently fail */ }
    setCloudLoading(false);
  };

  const saveCloudPreset = async (name) => {
    if (!authToken || !name) return;
    const data = {
      eq: equationInput, a, b, c, d, xScale, yScale, masterVolume,
      adsr: { ...DEFAULT_ADSR, ...adsr },
      filter: { ...DEFAULT_FILTER, ...filter },
      fxParams: withFxDefaults(fxParams),
      add7th, lfos: JSON.parse(JSON.stringify(lfos)),
      drawnWave: drawnWaveRef.current ? Array.from(drawnWaveRef.current) : null,
    };
    await saveCloudPresetApi(name, data, authToken);
    fetchCloudPresets();
  };

  const loadCloudPreset = async (id) => {
    try {
      const res = await apiFetch(`/api/presets/${id}`, {}, authToken);
      loadUserPreset(res.preset.data);
    } catch { /* ignore */ }
  };

  const deleteCloudPreset = async (id) => {
    await deleteCloudPresetApi(id, authToken);
    fetchCloudPresets();
  };

  useEffect(() => { if (authToken) fetchCloudPresets(); }, []);

  // ── Payment flow ──────────────────────────────────────────────────
  const [paymentStatus, setPaymentStatus] = useState(null); // "success" | "cancelled" | null

  const doCheckout = async () => {
    if (!authToken) { setAuthModal("login"); setAuthError(""); return; }
    try {
      const { url } = await checkoutApi(authToken);
      window.location.href = url;
    } catch (e) {
      setPaymentStatus("error");
      setTimeout(() => setPaymentStatus(null), 5000);
    }
  };

  // Detect payment return and refresh token
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    if (payment === "success" || payment === "cancelled") {
      setPaymentStatus(payment);
      // Clean URL
      const url = new URL(window.location);
      url.searchParams.delete("payment");
      window.history.replaceState({}, "", url.pathname);

      if (payment === "success" && authToken) {
        // Refresh token to get updated tier
        refreshTokenApi(authToken).then(({ token, user }) => {
          setAuthToken(token);
          setAuthUser(user);
          localStorage.setItem("wavecraft_token", token);
          localStorage.setItem("wavecraft_user", JSON.stringify(user));
        }).catch(() => {});
      }

      // Auto-dismiss after 5s
      setTimeout(() => setPaymentStatus(null), 5000);
    }
  }, []);

  // ── LFO state ──────────────────────────────────────────────────────
  const [lfos, setLfos] = useState([
    { ...DEFAULT_LFO },
    { ...DEFAULT_LFO, target: "b" },
    { ...DEFAULT_LFO, target: "cutoff" },
  ]);
  const lfosRef = useRef(lfos);
  lfosRef.current = lfos;
  const lfoPhaseRef = useRef([0, 0, 0]);
  const lfoSHRef = useRef([0, 0, 0]);
  const lfoOutputRef = useRef([0, 0, 0]);
  const lfoBaseRef = useRef({ a: 1, b: 0, c: 0, d: 0, cutoff: 18000, resonance: 0.7, volume: 0.18 });
  const [lfoUiTick, setLfoUiTick] = useState(0);

  const updateLfo = (idx, key, val) => {
    setLfos((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: val };
      return next;
    });
  };

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (ts) => {
      raf = requestAnimationFrame(tick);
      if (ts - last < 33) return;
      last = ts;
      const active = lfosRef.current.some((l) => l.enabled && l.depth !== 0);
      if (active) setLfoUiTick((n) => (n + 1) % 1000000);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const lfoUiMod = useCallback((target) => {
    let mod = 0;
    for (let i = 0; i < lfosRef.current.length; i++) {
      const l = lfosRef.current[i];
      if (!l.enabled || l.depth === 0 || l.target !== target) continue;
      mod += (lfoOutputRef.current[i] || 0) * l.depth;
    }
    return mod;
  }, []);

  const lfoDisplay = useMemo(() => {
    const modA = lfoUiMod("a");
    const modB = lfoUiMod("b");
    const modC = lfoUiMod("c");
    const modD = lfoUiMod("d");
    const modCutoff = lfoUiMod("cutoff");
    const modReso = lfoUiMod("resonance");
    const modVol = lfoUiMod("volume");
    return {
      a: modA, b: modB, c: modC, d: modD,
      cutoff: filter.cutoff * (Math.pow(2, modCutoff * 2) - 1),
      resonance: modReso * 10,
      volume: modVol * 0.3,
    };
  }, [a, b, c, d, filter.cutoff, filter.resonance, masterVolume, lfoUiTick, lfoUiMod]);

  // ── User Presets (localStorage) ──────────────────────────────────
  const [userPresets, setUserPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem("wavecraft_presets") || "[]"); } catch { return []; }
  });
  const [newPresetName, setNewPresetName] = useState("");

  const saveUserPreset = () => {
    const name = newPresetName.trim();
    if (!name) return;
    const preset = {
      name, eq: equationInput, a, b, c, d, xScale, yScale, masterVolume,
      adsr: { ...DEFAULT_ADSR, ...adsr },
      filter: { ...DEFAULT_FILTER, ...filter },
      fxParams: withFxDefaults(fxParams),
      add7th,
      lfos: JSON.parse(JSON.stringify(lfos)),
      drawnWave: drawnWaveRef.current ? Array.from(drawnWaveRef.current) : null,
    };
    const existing = userPresets.findIndex((p) => p.name === name);
    const next = [...userPresets];
    if (existing >= 0) next[existing] = preset; else next.push(preset);
    setUserPresets(next);
    localStorage.setItem("wavecraft_presets", JSON.stringify(next));
    setNewPresetName("");
  };

  const loadUserPreset = (p) => {
    const engine = engineRef.current;
    if (p.drawnWave) {
      drawnWaveRef.current = new Float32Array(p.drawnWave);
      setEquationInput("[drawn wave]"); setEquation("[drawn wave]");
      if (engine) sendDrawnWave(engine, p.drawnWave);
    } else {
      drawnWaveRef.current = null;
      setEquationInput(p.eq); setEquation(p.eq); lastEquationRef.current = p.eq;
      compileEquation(p.eq);
      if (engine) { sendEquation(engine, p.eq); sendDrawnWave(engine, null); }
    }
    setA(p.a); setB(p.b); setC(p.c); setD(p.d);
    if (p.xScale != null) setXScale(p.xScale);
    if (p.yScale != null) setYScale(p.yScale);
    if (p.masterVolume != null) setMasterVolume(p.masterVolume);
    setAdsr({ ...DEFAULT_ADSR, ...(p.adsr || {}) });
    setFilter({ ...DEFAULT_FILTER, ...(p.filter || {}) });
    setFxParams(withFxDefaults(p.fxParams || {}));
    if (p.add7th != null) setAdd7th(p.add7th);
    if (p.lfos) setLfos(p.lfos);
  };

  const deleteUserPreset = (name) => {
    const next = userPresets.filter((p) => p.name !== name);
    setUserPresets(next);
    localStorage.setItem("wavecraft_presets", JSON.stringify(next));
  };

  // ── Recording / playback state ────────────────────────────────────
  const [recState, setRecState] = useState("idle");
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef(null);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [recordedEvents, setRecordedEvents] = useState([]);
  const [playbackPos, setPlaybackPos] = useState(0);
  const [recDuration, setRecDuration] = useState(0);
  const [audioExporting, setAudioExporting] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(1);
  const [trimming, setTrimming] = useState(false);
  const recStartRef = useRef(0);
  const recEventsRef = useRef([]);
  const playTimerRef = useRef(null);
  const playStartRef = useRef(0);
  const playIdxRef = useRef(0);
  const playHeldRef = useRef(new Set());
  const mediaRecRef = useRef(null);
  const mediaChunksRef = useRef([]);
  const recStateRef = useRef("idle");

  // ── Audio refs ────────────────────────────────────────────────────
  const engineRef = useRef(null);
  const audioCtxRef = useRef(null);
  const gainRef = useRef(null);
  const midiAccessRef = useRef(null);
  const heldNotesRef = useRef(new Set());
  const lastEquationRef = useRef(DEFAULT_EQ);
  const fxNodesRef = useRef(null);
  const filterNodeRef = useRef(null);
  const analyserRef = useRef(null);
  const drawnWaveRef = useRef(null);
  const reverbDecayRef = useRef(2.0);

  const params = useMemo(() => ({ a, b, c, d }), [a, b, c, d]);

  // ── Audio engine ──────────────────────────────────────────────────
  const audioStartingRef = useRef(false);
  const setupAudio = async () => {
    if (audioCtxRef.current) {
      await audioCtxRef.current.resume();
      setAudioReady(true);
      return;
    }
    if (audioStartingRef.current) return;
    audioStartingRef.current = true;
    try {
      if (!engineRef.current) {
        engineRef.current = createEngineRefs();
      }
      const engine = engineRef.current;

      const ctx = await engineSetupAudio(engine, {
        masterVolume,
        fxOrder,
        adsr: { ...adsr },
        params: { a, b, c, d },
        scale: { x: xScale, y: yScale },
        onReady: () => setAudioReady(true),
        onSampleRate: (sr) => setSampleRate(sr),
      });

      if (!ctx) return;

      // Store node refs for effects/LFO/visualizer access
      audioCtxRef.current = engine.audioCtx;
      gainRef.current = engine.gain;
      analyserRef.current = engine.analyser;
      fxNodesRef.current = engine.fxNodes;
      filterNodeRef.current = engine.filterNode;

      // Send current equation to worklet
      const eqStr = drawnWaveRef.current ? null : lastEquationRef.current;
      if (eqStr) sendEquation(engine, eqStr);
      if (drawnWaveRef.current) sendDrawnWave(engine, drawnWaveRef.current);
    } finally {
      audioStartingRef.current = false;
    }
  };

  const refreshActiveNotes = () => {
    const engine = engineRef.current;
    if (!engine) { setActiveNotes([]); return; }
    setActiveNotes([...engine.heldNotes].sort((left, right) => left - right));
  };

  const noteOn = async (note, velocity = 0.8) => {
    if (!audioCtxRef.current) await setupAudio();
    else if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();
    const engine = engineRef.current;
    if (engine) engineNoteOn(engine, note, velocity);
    refreshActiveNotes();
  };

  const noteOff = (note) => {
    const engine = engineRef.current;
    if (engine) engineNoteOff(engine, note);
    refreshActiveNotes();
  };

  // Keep stable refs so the MIDI handler (mounted once) always calls the latest versions
  const setupAudioRef = useRef(setupAudio);
  setupAudioRef.current = setupAudio;
  const noteOnRef = useRef(noteOn);
  noteOnRef.current = noteOn;
  const noteOffRef = useRef(noteOff);
  noteOffRef.current = noteOff;

  useEffect(() => { if (gainRef.current) gainRef.current.gain.value = masterVolume; }, [masterVolume]);

  useEffect(() => {
    const filterNode = filterNodeRef.current;
    if (!filterNode) return;
    filterNode.type = filter.type;
    filterNode.frequency.value = filter.cutoff;
    filterNode.Q.value = filter.resonance;
  }, [filter]);

  // ── Sync effect parameters to audio nodes ─────────────────────────
  useEffect(() => {
    syncFxParams(fxNodesRef.current, fxParams);
  }, [fxParams]);

  useEffect(() => {
    const ctx = audioCtxRef.current;
    const fx = fxNodesRef.current;
    if (!ctx || !fx || fxParams.reverb.decay === reverbDecayRef.current) return;
    reverbDecayRef.current = fxParams.reverb.decay;
    updateReverbDecay(ctx, fx, fxParams.reverb.decay);
  }, [fxParams.reverb.decay]);

  // ── Rewire effects chain when order changes ───────────────────────
  const doRewire = useCallback((order, masterOverride, vfOverride) => {
    const fx = fxNodesRef.current;
    const vf = vfOverride || filterNodeRef.current;
    const master = masterOverride || gainRef.current;
    rewireFxChain(fx, order, master, vf);
  }, []);

  useEffect(() => { doRewire(fxOrder); }, [fxOrder, doRewire]);

  // ── LFO modulation loop ───────────────────────────────────────────
  useEffect(() => {
    let lastTime = performance.now();
    let animId;
    const smoothTime = 0.03;
    const tick = () => {
      animId = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      const currentLfos = lfosRef.current;
      let anyActive = false;
      const bases = lfoBaseRef.current;
      const mods = { a: 0, b: 0, c: 0, d: 0, cutoff: 0, resonance: 0, volume: 0 };
      for (let i = 0; i < 3; i++) {
        const l = currentLfos[i];
        if (!l.enabled || l.depth === 0) { lfoOutputRef.current[i] = 0; continue; }
        anyActive = true;
        lfoPhaseRef.current[i] += l.rate * dt;
        const ph = lfoPhaseRef.current[i];
        if (l.shape === "s&h") {
          const prevPh = ph - l.rate * dt;
          if (Math.floor(ph) !== Math.floor(prevPh)) {
            lfoSHRef.current[i] = Math.random() * 2 - 1;
          }
        }
        const val = lfoSample(l.shape, ph, lfoSHRef.current[i]);
        lfoOutputRef.current[i] = val;
        mods[l.target] += val * l.depth;
      }
      if (!anyActive) return;
      // Send LFO-modulated params to worklet
      const engine = engineRef.current;
      if (engine) {
        sendParams(engine, {
          a: bases.a + mods.a,
          b: bases.b + mods.b,
          c: bases.c + mods.c,
          d: bases.d + mods.d,
        });
      }
      const ctx = audioCtxRef.current;
      const t = ctx ? ctx.currentTime : 0;
      const filterNode = filterNodeRef.current;
      if (filterNode && ctx) {
        if (mods.cutoff !== 0) {
          const modded = clamp(bases.cutoff * Math.pow(2, mods.cutoff * 2), 60, 20000);
          filterNode.frequency.setTargetAtTime(modded, t, smoothTime);
        }
        if (mods.resonance !== 0) {
          filterNode.Q.setTargetAtTime(clamp(bases.resonance + mods.resonance * 10, 0.1, 20), t, smoothTime);
        }
      }
      if (gainRef.current && ctx && mods.volume !== 0) {
        gainRef.current.gain.setTargetAtTime(clamp(bases.volume + mods.volume * 0.3, 0, 0.5), t, smoothTime);
      }
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, []);

  useEffect(() => {
    lfoBaseRef.current = { a, b, c, d, cutoff: filter.cutoff, resonance: filter.resonance, volume: masterVolume };
    // Send base params to worklet when they change (no LFO active = direct update)
    const engine = engineRef.current;
    if (engine) sendParams(engine, { a, b, c, d });
  }, [a, b, c, d, filter.cutoff, filter.resonance, masterVolume]);

  // ── Send scale/adsr to worklet on changes ─────────────────────────
  useEffect(() => {
    const engine = engineRef.current;
    if (engine) sendScale(engine, xScale, yScale);
  }, [xScale, yScale]);

  useEffect(() => {
    const engine = engineRef.current;
    if (engine) sendAdsr(engine, adsr);
  }, [adsr]);

  // ── MIDI ──────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!navigator.requestMIDIAccess) { if (alive) setMidiStatus("Web MIDI not supported"); return; }
      try {
        const access = await navigator.requestMIDIAccess();
        midiAccessRef.current = access;
        const bind = () => {
          const inputs = Array.from(access.inputs.values());
          if (!inputs.length) { setMidiStatus("No MIDI connected"); return; }
          setMidiStatus(`${inputs.length} MIDI input${inputs.length > 1 ? "s" : ""} ready`);
          inputs.forEach((inp) => {
            inp.onmidimessage = async (msg) => {
              const [st, d1, d2] = msg.data;
              const cmd = st & 0xf0;
              if (cmd === 0x90 && d2 > 0) {
                if (!audioCtxRef.current) await setupAudioRef.current();
                recNoteOn(d1);
                noteOnRef.current(d1, d2 / 127);
                realNotesRef.current.add(d1);
                updateSeventh();
              } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
                recNoteOff(d1);
                noteOffRef.current(d1);
                realNotesRef.current.delete(d1);
                updateSeventh();
              }
            };
          });
        };
        bind();
        access.onstatechange = bind;
      } catch { if (alive) setMidiStatus("MIDI access denied"); }
    })();
    return () => { alive = false; };
  }, []);

  const applyEquation = () => {
    drawnWaveRef.current = null;
    lastEquationRef.current = equationInput;
    compileEquation(equationInput);
    setEquation(equationInput);
    // Send transpiled equation to worklet
    const engine = engineRef.current;
    if (engine) {
      sendEquation(engine, equationInput);
      sendDrawnWave(engine, null);
    }
  };
  const panic = () => {
    const engine = engineRef.current;
    if (engine) enginePanic(engine);
    realNotesRef.current.clear();
    seventhNoteRef.current = null;
    setActiveNotes([]);
  };

  // ── Recording / Playback / Loop ─────────────────────────────────
  const startRecording = async () => {
    if (!audioCtxRef.current) await setupAudio();
    panic();
    setRecState("countdown");
    setCountdown(3);
    let count = 3;
    countdownRef.current = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
        setCountdown(0);
        recEventsRef.current = [];
        recStartRef.current = performance.now();
        recStateRef.current = "recording";
        setRecordedEvents([]);
        setRecDuration(0);
        setTrimStart(0); setTrimEnd(1); setTrimming(false);
        setRecState("recording");
      } else {
        setCountdown(count);
      }
    }, 1000);
  };

  const cancelCountdown = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    setCountdown(0);
    setRecState("idle");
  };

  const stopRecording = () => {
    const dur = (performance.now() - recStartRef.current) / 1000;
    for (const n of playHeldRef.current) {
      recEventsRef.current.push({ t: dur, type: "off", note: n });
    }
    setRecordedEvents([...recEventsRef.current]);
    setRecDuration(dur);
    recStateRef.current = "idle";
    setRecState("idle");
    panic();
  };

  const recNoteOn = (note) => {
    if (recStateRef.current === "recording") {
      recEventsRef.current.push({ t: (performance.now() - recStartRef.current) / 1000, type: "on", note, velocity: 0.8 });
    }
  };
  const recNoteOff = (note) => {
    if (recStateRef.current === "recording") {
      recEventsRef.current.push({ t: (performance.now() - recStartRef.current) / 1000, type: "off", note });
    }
  };

  const add7thRef = useRef(false);
  add7thRef.current = add7th;
  const realNotesRef = useRef(new Set());
  const seventhNoteRef = useRef(null);

  const updateSeventh = () => {
    if (!add7thRef.current) {
      if (seventhNoteRef.current !== null) {
        if (!realNotesRef.current.has(seventhNoteRef.current)) {
          recNoteOff(seventhNoteRef.current);
          noteOff(seventhNoteRef.current);
        }
        seventhNoteRef.current = null;
      }
      return;
    }
    const target = realNotesRef.current.size > 0 ? Math.min(...realNotesRef.current) + 10 : null;
    const cur = seventhNoteRef.current;
    if (cur === target) return;
    if (cur !== null && !realNotesRef.current.has(cur)) { recNoteOff(cur); noteOff(cur); }
    if (target !== null && !realNotesRef.current.has(target)) {
      recNoteOn(target); noteOn(target, 0.7 * 0.8);
    }
    seventhNoteRef.current = target;
  };

  const wrappedNoteOn = async (note, velocity = 0.8) => {
    recNoteOn(note);
    if (!audioCtxRef.current) await setupAudio();
    else if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();
    noteOn(note, velocity);
    realNotesRef.current.add(note);
    updateSeventh();
  };
  const wrappedNoteOff = (note) => {
    recNoteOff(note);
    noteOff(note);
    realNotesRef.current.delete(note);
    updateSeventh();
  };

  const stopPlayback = () => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    playTimerRef.current = null;
    for (const n of playHeldRef.current) noteOff(n);
    playHeldRef.current.clear();
    setRecState("idle");
    setPlaybackPos(0);
  };

  const startPlayback = () => {
    if (!recordedEvents.length) return;
    panic();
    playHeldRef.current.clear();
    playIdxRef.current = 0;
    playStartRef.current = performance.now();
    setRecState("playing");
    setPlaybackPos(0);
    scheduleNextEvent();
  };

  const scheduleNextEvent = () => {
    const events = recordedEvents;
    const idx = playIdxRef.current;
    if (idx >= events.length) {
      const remaining = recDuration * 1000 - (performance.now() - playStartRef.current);
      playTimerRef.current = setTimeout(() => {
        for (const n of playHeldRef.current) noteOff(n);
        playHeldRef.current.clear();
        if (loopEnabled) {
          playIdxRef.current = 0;
          playStartRef.current = performance.now();
          setPlaybackPos(0);
          scheduleNextEvent();
        } else {
          setRecState("idle");
          setPlaybackPos(0);
        }
      }, Math.max(0, remaining));
      return;
    }
    const ev = events[idx];
    const elapsed = performance.now() - playStartRef.current;
    const wait = ev.t * 1000 - elapsed;
    playTimerRef.current = setTimeout(() => {
      if (ev.type === "on") { noteOn(ev.note, ev.velocity || 0.8); playHeldRef.current.add(ev.note); }
      else { noteOff(ev.note); playHeldRef.current.delete(ev.note); }
      setPlaybackPos((performance.now() - playStartRef.current) / 1000);
      playIdxRef.current = idx + 1;
      scheduleNextEvent();
    }, Math.max(0, wait));
  };

  const exportAudio = async () => {
    if (!recordedEvents.length || !audioCtxRef.current) return;
    setAudioExporting(true);
    const dest = audioCtxRef.current.createMediaStreamDestination();
    gainRef.current.connect(dest);
    const recorder = new MediaRecorder(dest.stream, { mimeType: "audio/webm;codecs=opus" });
    mediaChunksRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data.size) mediaChunksRef.current.push(e.data); };
    recorder.onstop = () => {
      gainRef.current.disconnect(dest);
      const blob = new Blob(mediaChunksRef.current, { type: "audio/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `wavecraft-${Date.now()}.webm`; a.click();
      URL.revokeObjectURL(url);
      setAudioExporting(false);
    };
    recorder.start();
    panic();
    playHeldRef.current.clear();
    let i = 0;
    const t0 = performance.now();
    const step = () => {
      if (i >= recordedEvents.length) {
        const rem = recDuration * 1000 - (performance.now() - t0);
        setTimeout(() => {
          for (const n of playHeldRef.current) noteOff(n);
          playHeldRef.current.clear();
          setTimeout(() => recorder.stop(), 200);
        }, Math.max(0, rem));
        return;
      }
      const ev = recordedEvents[i];
      const wait = ev.t * 1000 - (performance.now() - t0);
      setTimeout(() => {
        if (ev.type === "on") { noteOn(ev.note, ev.velocity || 0.8); playHeldRef.current.add(ev.note); }
        else { noteOff(ev.note); playHeldRef.current.delete(ev.note); }
        i++;
        step();
      }, Math.max(0, wait));
    };
    step();
  };

  const applyTrim = () => {
    if (!recordedEvents.length || recDuration <= 0) return;
    const tMin = trimStart * recDuration;
    const tMax = trimEnd * recDuration;
    const trimmed = recordedEvents
      .filter(e => e.t >= tMin && e.t <= tMax)
      .map(e => ({ ...e, t: e.t - tMin }));
    setRecordedEvents(trimmed);
    setRecDuration(tMax - tMin);
    setTrimStart(0); setTrimEnd(1); setTrimming(false);
  };

  useEffect(() => () => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  const applyPreset = (p) => {
    drawnWaveRef.current = null;
    setEquationInput(p.eq); setEquation(p.eq); lastEquationRef.current = p.eq;
    compileEquation(p.eq);
    setA(p.a); setB(p.b); setC(p.c); setD(p.d);
    setAdsr({ ...DEFAULT_ADSR, ...(p.adsr || {}) });
    setFilter({ ...DEFAULT_FILTER, ...(p.filter || {}) });
    setFxParams(withFxDefaults(p.fxParams || {}));
    if (p.lfos) setLfos(JSON.parse(JSON.stringify(p.lfos)));
    if (p.masterVolume != null) setMasterVolume(p.masterVolume);
    if (p.add7th != null) setAdd7th(p.add7th);
    // Send to worklet
    const engine = engineRef.current;
    if (engine) {
      sendEquation(engine, p.eq);
      sendDrawnWave(engine, null);
    }
  };

  const updateFx = (effect, key, val) => {
    setFxParams((prev) => ({ ...prev, [effect]: { ...prev[effect], [key]: val } }));
  };

  const onUseWave = useCallback((wave) => {
    drawnWaveRef.current = new Float32Array(wave);
    setEquationInput("[drawn wave]");
    setEquation("[drawn wave]");
    setPage("synth");
    // Send drawn wave to worklet
    const engine = engineRef.current;
    if (engine) sendDrawnWave(engine, wave);
  }, []);

  const toggleDrumSync = useCallback(async () => {
    if (drumsPlaying) { setDrumsPlaying(false); return; }
    if (!audioCtxRef.current) await setupAudio();
    else if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    setDrumSyncStartAt(ctx.currentTime + 0.08);
    setDrumSyncEpoch((n) => n + 1);
    setDrumsPlaying(true);
  }, [drumsPlaying, setupAudio]);

  // ── Combined Drum Presets ─────────────────────────────────────────
  const [combinedDrumPresets, setCombinedDrumPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem("wavecraft_combined_drum_presets") || "[]"); } catch { return []; }
  });
  const [newCombinedDrumName, setNewCombinedDrumName] = useState("");

  const saveCombinedDrumPreset = () => {
    const name = newCombinedDrumName.trim();
    if (!name) return;
    const preset = {
      name, bpm: drumBpm,
      vlTone: drumMachineRef.current?.getState() ?? null,
      po32: po32Ref.current?.getState() ?? null,
    };
    const existing = combinedDrumPresets.findIndex(p => p.name === name);
    const next = [...combinedDrumPresets];
    if (existing >= 0) next[existing] = preset; else next.push(preset);
    setCombinedDrumPresets(next);
    localStorage.setItem("wavecraft_combined_drum_presets", JSON.stringify(next));
    setNewCombinedDrumName("");
  };

  const loadCombinedDrumPreset = (p) => {
    if (p.bpm != null) setDrumBpm(p.bpm);
    if (p.vlTone && drumMachineRef.current) drumMachineRef.current.loadState(p.vlTone);
    if (p.po32 && po32Ref.current) po32Ref.current.loadState(p.po32);
  };

  const deleteCombinedDrumPreset = (name) => {
    const next = combinedDrumPresets.filter(p => p.name !== name);
    setCombinedDrumPresets(next);
    localStorage.setItem("wavecraft_combined_drum_presets", JSON.stringify(next));
  };

  // ── Button styles ─────────────────────────────────────────────────
  const btnPrimary = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    height: 38, padding: "0 18px", borderRadius: 3,
    border: "1px solid rgba(255,180,60,0.3)",
    background: "linear-gradient(180deg, #cc6e08 0%, #a05500 100%)",
    color: "#f0e6d2",
    fontSize: 12, fontWeight: 700, cursor: "pointer",
    fontFamily: T.font, textTransform: "uppercase", letterSpacing: 1,
    boxShadow: `0 2px 8px ${T.accentGlow}, inset 0 1px 0 rgba(255,255,255,0.1)`,
    transition: "all 100ms",
  };
  const btnGhost = {
    ...btnPrimary,
    background: "linear-gradient(180deg, #2e2820 0%, #1a1510 100%)",
    color: T.text,
    border: `1px solid ${T.borderHi}`,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 4px rgba(0,0,0,0.3)",
  };

  // ═════════════════════════════════════════════════════════════════
  //  RENDER
  // ═════════════════════════════════════════════════════════════════
  return (
    <div style={{
      minHeight: "100vh", background: T.bg, color: T.text,
      fontFamily: T.font, WebkitFontSmoothing: "antialiased",
    }}>
      <div className="crt-overlay" />

      {/* ── Auth Modal ──────────────────────────────────────────── */}
      {authModal && (
        <div onClick={() => setAuthModal(null)} style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 340, background: "linear-gradient(180deg, #2a2218, #14110c)",
            border: `2px solid ${T.borderHi}`, borderRadius: 4, padding: 28,
            boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.amber, letterSpacing: 3, textTransform: "uppercase", marginBottom: 20, textAlign: "center" }}>
              {authModal === "login" ? "Sign In" : "Create Account"}
            </div>
            {authError && (
              <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 2, background: "rgba(255,60,60,0.15)", border: "1px solid rgba(255,60,60,0.3)", color: "#ff6b6b", fontSize: 11, fontFamily: T.monoFont }}>
                {authError}
              </div>
            )}
            {authModal === "signup" && (
              <input
                value={authForm.displayName} onChange={(e) => setAuthForm((f) => ({ ...f, displayName: e.target.value }))}
                placeholder="Display name" autoComplete="name"
                style={{ width: "100%", height: 36, fontSize: 13, padding: "0 10px", marginBottom: 10, boxSizing: "border-box", background: T.surface, color: T.white, border: `1px solid ${T.border}`, borderRadius: 2, outline: "none", fontFamily: T.monoFont }}
              />
            )}
            <input
              value={authForm.email} onChange={(e) => setAuthForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="Email" type="email" autoComplete="email"
              style={{ width: "100%", height: 36, fontSize: 13, padding: "0 10px", marginBottom: 10, boxSizing: "border-box", background: T.surface, color: T.white, border: `1px solid ${T.border}`, borderRadius: 2, outline: "none", fontFamily: T.monoFont }}
            />
            <input
              value={authForm.password} onChange={(e) => setAuthForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="Password" type="password" autoComplete={authModal === "login" ? "current-password" : "new-password"}
              onKeyDown={(e) => e.key === "Enter" && (authModal === "login" ? doLogin() : doSignup())}
              style={{ width: "100%", height: 36, fontSize: 13, padding: "0 10px", marginBottom: 16, boxSizing: "border-box", background: T.surface, color: T.white, border: `1px solid ${T.border}`, borderRadius: 2, outline: "none", fontFamily: T.monoFont }}
            />
            <button
              onClick={authModal === "login" ? doLogin : doSignup}
              disabled={authLoading}
              style={{ ...btnPrimary, width: "100%", height: 38, fontSize: 12, marginBottom: 12, opacity: authLoading ? 0.6 : 1 }}
            >
              {authLoading ? "..." : authModal === "login" ? "Sign In" : "Create Account"}
            </button>
            <div style={{ textAlign: "center", fontSize: 11, color: T.textMuted }}>
              {authModal === "login" ? "No account? " : "Already have one? "}
              <span
                onClick={() => { setAuthModal(authModal === "login" ? "signup" : "login"); setAuthError(""); }}
                style={{ color: T.amber, cursor: "pointer", textDecoration: "underline" }}
              >
                {authModal === "login" ? "Sign up" : "Sign in"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Top Bar ──────────────────────────────────────────────── */}
      <div style={{
        height: 52, background: "linear-gradient(180deg, #2a2218 0%, #1a1510 100%)",
        borderBottom: `2px solid ${T.borderHi}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", position: "sticky", top: 0, zIndex: 100,
        boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 30, height: 30, borderRadius: 3,
            background: "linear-gradient(135deg, #cc6e08, #ff9922)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, color: "#0d0b08", fontWeight: 900,
            boxShadow: "0 0 10px rgba(232,133,12,0.4)",
          }}>∿</span>
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: T.amber }}>EquationSynth</span>
          <span style={{ fontSize: 10, color: T.textMuted, fontWeight: 500, marginLeft: 4, letterSpacing: 2 }}>v0.1</span>
          <div style={{ display: "flex", marginLeft: 16, gap: 4 }}>
            {[{ id: "synth", label: "SYNTH" }, { id: "draw", label: "DRAW" }, { id: "drums", label: "DRUMS" }, { id: "guide", label: "GUIDE" }].map((tab) => (
              <button key={tab.id} onClick={() => { setPage(tab.id); window.scrollTo(0,0); }} style={{
                height: 28, padding: "0 14px", fontSize: 11, fontWeight: 700,
                fontFamily: T.font, letterSpacing: 1.5, textTransform: "uppercase",
                border: `1px solid ${page === tab.id ? T.accent : T.borderHi}`,
                borderRadius: 2, cursor: "pointer",
                background: page === tab.id ? "linear-gradient(180deg, #881100, #440000)" : "linear-gradient(180deg, #333333, #222222)",
                color: page === tab.id ? T.white : T.textDim,
                boxShadow: page === tab.id ? `0 0 8px ${T.accentGlow}, inset 0 1px 1px rgba(255,255,255,0.2)` : "inset 0 1px 1px rgba(255,255,255,0.1), 0 2px 4px rgba(0,0,0,0.5)",
              }}>{tab.label}</button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Pill glow={audioReady}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: audioReady ? T.green : T.textMuted }} />
            {audioReady ? "Engine On" : "Engine Off"}
          </Pill>
          <Pill>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: activeNotes.length ? T.green : T.textMuted }} />
            {midiStatus}
          </Pill>
          {authUser ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10, color: T.green, fontFamily: T.monoFont, letterSpacing: 1, textTransform: "uppercase" }}>
                {authUser.displayName || authUser.email}
              </span>
              {authUser.tier !== "paid" && (
                <button onClick={doCheckout} style={{
                  height: 24, padding: "0 10px", fontSize: 9, fontWeight: 700,
                  fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase",
                  border: "1px solid #22cc44", borderRadius: 2, cursor: "pointer",
                  background: "linear-gradient(180deg, #1a4d1a, #0d260d)", color: T.green,
                  boxShadow: "0 0 8px rgba(34,204,68,0.3)",
                }}>Upgrade — $2</button>
              )}
              <button onClick={doLogout} style={{
                height: 24, padding: "0 10px", fontSize: 9, fontWeight: 700,
                fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase",
                border: `1px solid ${T.border}`, borderRadius: 2, cursor: "pointer",
                background: "linear-gradient(180deg, #2e2820, #1a1510)", color: T.textDim,
              }}>Logout</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => { setAuthModal("login"); setAuthError(""); }} style={{
                height: 28, padding: "0 14px", fontSize: 10, fontWeight: 700,
                fontFamily: T.font, letterSpacing: 1.5, textTransform: "uppercase",
                border: `1px solid ${T.accent}`, borderRadius: 2, cursor: "pointer",
                background: "linear-gradient(180deg, #cc6e08, #a05500)", color: "#f0e6d2",
                boxShadow: `0 0 8px ${T.accentGlow}`,
              }}>Sign In</button>
            </div>
          )}
        </div>
      </div>

      {/* ── Payment toast ────────────────────────────────────── */}
      {paymentStatus && (
        <div style={{
          position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, padding: "10px 24px", borderRadius: 4,
          background: paymentStatus === "success" ? "linear-gradient(180deg, #1a4d1a, #0d260d)" : "linear-gradient(180deg, #4d1a1a, #260d0d)",
          border: `1px solid ${paymentStatus === "success" ? "#22cc44" : "#cc4444"}`,
          color: paymentStatus === "success" ? T.green : "#ff6666",
          fontSize: 12, fontWeight: 700, fontFamily: T.font, letterSpacing: 1,
          boxShadow: `0 4px 20px rgba(0,0,0,0.5)`,
        }}>
          {paymentStatus === "success" ? "Payment successful — you're now upgraded!" : "Payment cancelled"}
          <button onClick={() => setPaymentStatus(null)} style={{
            marginLeft: 16, background: "none", border: "none", color: T.textMuted,
            cursor: "pointer", fontSize: 14, lineHeight: 1,
          }}>✕</button>
        </div>
      )}

      {/* ── User Guide ─────────────────────────────────────── */}
      <div id="section-guide" className="hardware-module" style={{ display: page === "guide" ? "block" : "none", maxWidth: 960, margin: "0 auto", padding: "20px 20px 60px" }}>
        <Section title="User Guide" icon="📖">
          <div style={{ fontSize: 12, lineHeight: 1.9, color: T.text, fontFamily: T.font }}>

            {/* Getting Started */}
            <h3 style={{ color: T.amber, fontSize: 14, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", margin: "0 0 8px", borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>Getting Started</h3>
            <p style={{ color: T.textDim, margin: "0 0 6px" }}>
              Click any key on the piano keyboard or press a key on your computer keyboard (A-L row = white keys, W-E-T-Y-U row = black keys) to hear sound.
              If no sound plays, click anywhere on the page first — browsers require a user gesture to start audio.
            </p>
            <p style={{ color: T.textDim, margin: "0 0 16px" }}>
              Connect a MIDI controller and it will be detected automatically. Velocity, pitch bend, and mod wheel are supported.
            </p>

            {/* Equation System */}
            <h3 style={{ color: T.amber, fontSize: 14, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", margin: "0 0 8px", borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>Equation System</h3>
            <p style={{ color: T.textDim, margin: "0 0 8px" }}>
              Type any math expression into the equation bar to define your waveform. The expression is evaluated per-sample in a high-performance AudioWorklet.
            </p>
            <div style={{ margin: "0 0 12px", padding: 12, borderRadius: 3, background: "#0a0f0a", border: `1px solid ${T.border}`, fontFamily: "'Share Tech Mono', 'Courier New', monospace" }}>
              <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 700, marginBottom: 6, fontFamily: T.font, textTransform: "uppercase", letterSpacing: 1.5 }}>Available Variables</div>
              <div style={{ fontSize: 11, lineHeight: 2.2, color: T.textDim }}>
                <div><b style={{ color: T.amber }}>x</b> — waveform phase (0 → 2π per cycle)</div>
                <div><b style={{ color: T.amber }}>t</b> — time in seconds since note started</div>
                <div><b style={{ color: T.amber }}>freq</b> — note frequency in Hz</div>
                <div><b style={{ color: T.amber }}>note</b> — MIDI note number (0–127)</div>
                <div><b style={{ color: T.amber }}>velocity</b> — key velocity (0–1)</div>
                <div><b style={{ color: T.amber }}>a, b, c, d</b> — slider parameters (adjust with the four knobs)</div>
              </div>
            </div>
            <div style={{ margin: "0 0 16px", padding: 12, borderRadius: 3, background: "#0a0f0a", border: `1px solid ${T.border}`, fontFamily: "'Share Tech Mono', 'Courier New', monospace" }}>
              <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 700, marginBottom: 6, fontFamily: T.font, textTransform: "uppercase", letterSpacing: 1.5 }}>Example Equations</div>
              <div style={{ fontSize: 11, lineHeight: 2, color: T.green, textShadow: "0 0 6px rgba(51,255,102,0.3)" }}>
                <div>sin(x) <span style={{ color: T.textMuted, fontSize: 9 }}>— pure sine wave</span></div>
                <div>sin(a*x) + 0.2*sin(3*x) <span style={{ color: T.textMuted, fontSize: 9 }}>— harmonic mix with slider control</span></div>
                <div>tanh(sin(x) + b*sin(2*x)) <span style={{ color: T.textMuted, fontSize: 9 }}>— soft-clipped harmonics</span></div>
                <div>sin(x) * exp(-0.001*t) <span style={{ color: T.textMuted, fontSize: 9 }}>— decaying sine</span></div>
                <div>(x / pi - 1) <span style={{ color: T.textMuted, fontSize: 9 }}>— sawtooth wave</span></div>
                <div>sign(sin(x)) <span style={{ color: T.textMuted, fontSize: 9 }}>— square wave</span></div>
                <div>sin(x) * sin(a * t) <span style={{ color: T.textMuted, fontSize: 9 }}>— tremolo effect</span></div>
                <div>sin(x + b * sin(c * x)) <span style={{ color: T.textMuted, fontSize: 9 }}>— FM synthesis</span></div>
              </div>
            </div>

            {/* Synth Controls */}
            <h3 style={{ color: T.amber, fontSize: 14, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", margin: "0 0 8px", borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>Synth Controls</h3>
            <div style={{ color: T.textDim, margin: "0 0 16px" }}>
              <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>ADSR Envelope</b> — shapes how each note's volume evolves: Attack (fade in), Decay (drop to sustain), Sustain (hold level), Release (fade out after key up).</div>
              <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>A / B / C / D Sliders</b> — parameter knobs mapped to variables in your equation. Twist them to morph the waveform in real time.</div>
              <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>Gain</b> — master output volume. Watch the level meter to avoid clipping.</div>
              <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>Scale</b> — constrains the keyboard to a musical scale (chromatic, major, minor, pentatonic, blues, etc.).</div>
              <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>Root Note</b> — sets the tonal center for the selected scale.</div>
              <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>Octave</b> — shifts the keyboard range up or down.</div>
            </div>

            {/* Effects */}
            <h3 style={{ color: T.amber, fontSize: 14, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", margin: "0 0 8px", borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>Effects Chain</h3>
            <div style={{ color: T.textDim, margin: "0 0 16px" }}>
              <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>Filter</b> — lowpass, highpass, bandpass, or notch filter with cutoff frequency and resonance controls.</div>
              <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>Reverb</b> — adds space and ambience. Adjust the decay time to go from tight room to vast cathedral.</div>
              <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>Delay</b> — echo effect with time and feedback controls.</div>
              <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>Chorus</b> — thickens the sound by layering detuned copies.</div>
              <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>Distortion</b> — waveshaping distortion from subtle warmth to heavy crunch.</div>
            </div>

            {/* LFO */}
            <h3 style={{ color: T.amber, fontSize: 14, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", margin: "0 0 8px", borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>LFO Modulation</h3>
            <div style={{ color: T.textDim, margin: "0 0 16px" }}>
              <div style={{ marginBottom: 4 }}>Three independent LFOs can modulate parameters like filter cutoff, resonance, gain, and the A/B/C/D sliders.</div>
              <div style={{ marginBottom: 4 }}>Each LFO has rate, depth, and shape (sine, triangle, square, saw, random) controls.</div>
              <div style={{ marginBottom: 4 }}>Use LFOs to create movement — wobble bass, filter sweeps, tremolo, and evolving textures.</div>
            </div>

            {/* Pages */}
            <h3 style={{ color: T.amber, fontSize: 14, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", margin: "0 0 8px", borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>Pages</h3>
            <div style={{ color: T.textDim, margin: "0 0 16px" }}>
              <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>SYNTH</b> — the main equation synthesizer with keyboard, effects, visualizations, and presets.</div>
              <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>DRAW</b> — draw a custom waveform by hand and send it to the synth engine.</div>
              <div style={{ marginBottom: 4 }}><b style={{ color: T.text }}>DRUMS</b> — two drum machines (VL-Tone and PO-32 Tonic style) with pattern sequencing and kit presets.</div>
            </div>

            {/* Keyboard Shortcuts */}
            <h3 style={{ color: T.amber, fontSize: 14, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", margin: "0 0 8px", borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>Keyboard Shortcuts</h3>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px", fontSize: 11, margin: "0 0 16px" }}>
              <span style={{ color: T.amber, fontFamily: "'Share Tech Mono', monospace" }}>A S D F G H J K L</span><span style={{ color: T.textDim }}>White keys (bottom row)</span>
              <span style={{ color: T.amber, fontFamily: "'Share Tech Mono', monospace" }}>W E T Y U O P</span><span style={{ color: T.textDim }}>Black keys (top row)</span>
              <span style={{ color: T.amber, fontFamily: "'Share Tech Mono', monospace" }}>Z / X</span><span style={{ color: T.textDim }}>Octave down / up</span>
            </div>

            {/* Presets & Cloud */}
            <h3 style={{ color: T.amber, fontSize: 14, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", margin: "0 0 8px", borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>Presets</h3>
            <div style={{ color: T.textDim, margin: "0 0 8px" }}>
              <div style={{ marginBottom: 4 }}>Built-in factory presets are available from the preset dropdown. Select one to instantly load its equation, ADSR, effects, and slider values.</div>
              <div style={{ marginBottom: 4 }}>Save your own presets locally, or log in to sync them to the cloud.</div>
            </div>
          </div>
        </Section>
      </div>

      {/* ── Drum machines (always mounted) ────────────────────── */}
      <div id="section-drums" className="hardware-module" style={{ display: page === "drums" ? "block" : "none" }}>
        <DrumMachine
          ref={drumMachineRef}
          audioCtxRef={audioCtxRef}
          gainRef={gainRef}
          setupAudio={setupAudio}
          tempo={drumBpm}
          onTempoChange={setDrumBpm}
          syncPlaying={drumsPlaying}
          syncStartAt={drumSyncStartAt}
          syncEpoch={drumSyncEpoch}
          onToggleSync={toggleDrumSync}
        />
        <PO32Tonic
          ref={po32Ref}
          audioCtxRef={audioCtxRef}
          gainRef={gainRef}
          setupAudio={setupAudio}
          tempo={drumBpm}
          onTempoChange={setDrumBpm}
          syncPlaying={drumsPlaying}
          syncStartAt={drumSyncStartAt}
          syncEpoch={drumSyncEpoch}
          onToggleSync={toggleDrumSync}
        />

        {/* ── Combined Drum Kit Presets ────────────────────────── */}
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 20px 40px" }}>
          <Section title="Drum Kit Presets" icon="💾">
            <div style={{ fontSize: 10, color: T.textDim, marginBottom: 8, fontFamily: T.font }}>
              Saves both VL-Tone and PO-32 patterns, all dial settings, and BPM together.
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input
                value={newCombinedDrumName}
                onChange={(e) => setNewCombinedDrumName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveCombinedDrumPreset()}
                placeholder="Kit preset name…"
                style={{
                  flex: 1, height: 36, fontSize: 13, padding: "0 10px",
                  background: T.surface, color: T.white,
                  border: `1px solid ${T.border}`, borderRadius: 8,
                  outline: "none", minWidth: 0, fontFamily: T.font,
                }}
              />
              <button onClick={saveCombinedDrumPreset} disabled={!newCombinedDrumName.trim()} style={{
                ...btnPrimary, height: 34, padding: "0 14px", fontSize: 10,
                opacity: newCombinedDrumName.trim() ? 1 : 0.4,
                cursor: newCombinedDrumName.trim() ? "pointer" : "not-allowed",
              }}>
                Save Kit
              </button>
            </div>
            {combinedDrumPresets.length === 0 ? (
              <div style={{ fontSize: 12, color: T.textMuted, textAlign: "center", padding: "8px 0" }}>
                No saved drum kit presets yet
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {combinedDrumPresets.map((p) => (
                  <div key={p.name} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "5px 10px", borderRadius: 2,
                    border: `1px solid ${T.border}`,
                    background: "linear-gradient(180deg, #2e2820, #1a1510)",
                  }}>
                    <button onClick={() => loadCombinedDrumPreset(p)} style={{
                      flex: 1, background: "none", border: "none",
                      color: T.text, fontSize: 10, fontWeight: 700,
                      cursor: "pointer", textAlign: "left", padding: 0,
                      fontFamily: T.font, letterSpacing: 0.8, textTransform: "uppercase",
                    }}>
                      {p.name}
                    </button>
                    <span style={{ fontSize: 9, color: T.textMuted, fontFamily: T.font }}>{p.bpm}bpm</span>
                    <button onClick={() => deleteCombinedDrumPreset(p.name)} title="Delete" style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: T.textMuted, fontSize: 14, padding: "0 2px", lineHeight: 1,
                    }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* ── Draw module (always mounted) ──────────────────────── */}
      <div id="section-draw" className="hardware-module" style={{ display: page === "draw" ? "block" : "none" }}>
        <WaveDrawer onUseWave={onUseWave} />
      </div>

      {/* ── Synth module (always mounted) ─────────────────────── */}
      <div id="section-synth" className="hardware-module" style={{ display: page === "synth" ? "block" : "none", maxWidth: 1480, margin: "0 auto", padding: "20px 20px 40px" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "minmax(340px, 440px) 1fr minmax(260px, 320px)",
          gap: 16,
        }}>

          {/* ── LEFT COLUMN: Plot + Equation ─────────────────────── */}
          <div>
            <Section title="Waveform Preview" icon="📈">
              <div className="crt-screen">
                <PlotCanvas equation={equation} params={params} xScale={xScale} yScale={yScale} drawnWave={drawnWaveRef.current} lfoParams={lfoDisplay} />
              </div>
              <div style={{ display: "flex", gap: 0, marginTop: 14 }}>
                <div style={{
                  background: "#181208", border: `1px solid ${T.borderHi}`,
                  borderRadius: `${T.radius}px 0 0 ${T.radius}px`,
                  padding: "0 10px", display: "flex", alignItems: "center",
                  fontSize: 11, fontWeight: 700, color: T.amber,
                  textTransform: "uppercase", letterSpacing: 1.5,
                  whiteSpace: "nowrap", fontFamily: T.font,
                }}>
                  f(x) =
                </div>
                <input
                  value={equationInput}
                  onChange={(e) => setEquationInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyEquation()}
                  placeholder="sin(x)"
                  spellCheck={false}
                  style={{
                    flex: 1, height: 40, fontSize: 14, padding: "0 12px",
                    background: "#0a0f0a", color: T.green,
                    border: `1px solid ${T.border}`, borderLeft: "none", borderRight: "none",
                    outline: "none", fontFamily: "'Share Tech Mono', 'Courier New', monospace",
                    minWidth: 0, textShadow: "0 0 6px rgba(51,255,102,0.3)",
                  }}
                />
                <button onClick={applyEquation} style={{
                  ...btnPrimary, borderRadius: 0, height: 40, padding: "0 16px", fontSize: 10, letterSpacing: 1.5,
                }}>APPLY</button>
                <button onClick={() => { drawnWaveRef.current = null; setEquationInput(DEFAULT_EQ); setEquation(DEFAULT_EQ); lastEquationRef.current = DEFAULT_EQ; compileEquation(DEFAULT_EQ); }} title="Reset to default" style={{
                  height: 40, padding: "0 12px", fontSize: 14,
                  background: "linear-gradient(180deg, #2e2820, #1a1510)", color: T.textMuted,
                  border: `1px solid ${T.border}`, borderLeft: "none",
                  borderRadius: `0 ${T.radius}px ${T.radius}px 0`,
                  cursor: "pointer", fontFamily: T.font,
                }}>↺</button>
              </div>
            </Section>

            <Section title="View" icon="🔍" style={{ marginTop: 12 }}>
              <Knob label="X Scale" value={xScale} onChange={setXScale} min={0.1} max={8} step={0.01} compact defaultValue={1} />
              <Knob label="Y Scale" value={yScale} onChange={setYScale} min={0.1} max={8} step={0.01} compact defaultValue={1} />
            </Section>

            <Section title="Presets" icon="🎨" style={{ marginTop: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                {PRESETS.map((p) => (
                  <button key={p.name} onClick={() => applyPreset(p)} style={{
                    padding: "7px 10px", borderRadius: 2,
                    border: `1px solid ${equation === p.eq ? T.accent : T.border}`,
                    background: equation === p.eq
                      ? "linear-gradient(180deg, #cc6e08, #a05500)"
                      : "linear-gradient(180deg, #2e2820, #1a1510)",
                    color: equation === p.eq ? "#f0e6d2" : T.textDim,
                    fontSize: 10, fontWeight: 700, cursor: "pointer",
                    textAlign: "left", transition: "all 80ms",
                    fontFamily: T.font, letterSpacing: 0.8, textTransform: "uppercase",
                    boxShadow: equation === p.eq ? `0 0 8px ${T.accentGlow}` : "inset 0 1px 0 rgba(255,255,255,0.04)",
                  }}>
                    {p.name}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="My Presets" icon="💾" style={{ marginTop: 12 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <input
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveUserPreset()}
                  placeholder="Preset name…"
                  style={{
                    flex: 1, height: 36, fontSize: 13, padding: "0 10px",
                    background: T.surface, color: T.white,
                    border: `1px solid ${T.border}`, borderRadius: 8,
                    outline: "none", minWidth: 0,
                  }}
                />
                <button onClick={() => { saveUserPreset(); if (authToken && newPresetName.trim()) saveCloudPreset(newPresetName.trim()); }} disabled={!newPresetName.trim()} style={{
                  ...btnPrimary, height: 34, padding: "0 14px", fontSize: 10,
                  opacity: newPresetName.trim() ? 1 : 0.4,
                  cursor: newPresetName.trim() ? "pointer" : "not-allowed",
                }}>Save</button>
              </div>
              {userPresets.length === 0 ? (
                <div style={{ fontSize: 12, color: T.textMuted, textAlign: "center", padding: "8px 0" }}>No saved presets yet</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {userPresets.map((p) => (
                    <div key={p.name} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "5px 10px", borderRadius: 2,
                      border: `1px solid ${T.border}`,
                      background: "linear-gradient(180deg, #2e2820, #1a1510)",
                    }}>
                      <button onClick={() => loadUserPreset(p)} style={{
                        flex: 1, background: "none", border: "none",
                        color: T.text, fontSize: 10, fontWeight: 700,
                        cursor: "pointer", textAlign: "left", padding: 0,
                        fontFamily: T.font, letterSpacing: 0.8, textTransform: "uppercase",
                      }}>{p.name}</button>
                      <button onClick={() => deleteUserPreset(p.name)} title="Delete" style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: T.textMuted, fontSize: 14, padding: "0 2px", lineHeight: 1,
                      }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {authUser && (
              <Section title="Cloud Presets" icon="☁️" style={{ marginTop: 12 }}>
                {cloudLoading ? (
                  <div style={{ fontSize: 11, color: T.textMuted, textAlign: "center", padding: "8px 0", fontFamily: T.monoFont }}>Loading…</div>
                ) : cloudPresets.length === 0 ? (
                  <div style={{ fontSize: 11, color: T.textMuted, textAlign: "center", padding: "8px 0" }}>
                    No cloud presets — save one above while signed in
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {cloudPresets.map((p) => (
                      <div key={p.id} style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "5px 10px", borderRadius: 2,
                        border: `1px solid ${T.border}`,
                        background: "linear-gradient(180deg, #1a2218, #101a10)",
                      }}>
                        <button onClick={() => loadCloudPreset(p.id)} style={{
                          flex: 1, background: "none", border: "none",
                          color: T.green, fontSize: 10, fontWeight: 700,
                          cursor: "pointer", textAlign: "left", padding: 0,
                          fontFamily: T.monoFont, letterSpacing: 0.8, textTransform: "uppercase",
                        }}>☁ {p.name}</button>
                        <button onClick={() => deleteCloudPreset(p.id)} title="Delete" style={{
                          background: "none", border: "none", cursor: "pointer",
                          color: T.textMuted, fontSize: 14, padding: "0 2px", lineHeight: 1,
                        }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            )}
          </div>

          {/* ── CENTER COLUMN ────────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Section title="Audio Engine" icon="🔊">
              <Knob label="Master Volume" value={masterVolume} onChange={setMasterVolume} min={0} max={0.5} step={0.001} defaultValue={0.18} lfoMod={lfoDisplay.volume} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                <Pill>{sampleRate.toLocaleString()} Hz</Pill>
                {activeNotes.length > 0 && (
                  <Pill glow>🎵 {activeNotes.map(noteName).join(", ")}</Pill>
                )}
              </div>
            </Section>

            <Section title="Keyboard" icon="🎹">
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <button
                  onClick={() => setAdd7th((v) => !v)}
                  style={{
                    height: 24, padding: "0 10px", fontSize: 9, fontWeight: 700,
                    fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase",
                    border: `1px solid ${add7th ? T.accent : T.border}`,
                    borderRadius: 2, cursor: "pointer",
                    background: add7th ? "linear-gradient(180deg, #cc6e08, #a05500)" : "linear-gradient(180deg, #2e2820, #1a1510)",
                    color: add7th ? "#f0e6d2" : T.textDim,
                    boxShadow: add7th ? `0 0 6px ${T.accentGlow}` : "none",
                  }}
                >+7th</button>
              </div>
              <PianoKeyboard activeNotes={activeNotes} onNoteOn={wrappedNoteOn} onNoteOff={wrappedNoteOff} />
              <div style={{ fontSize: 9, color: T.textMuted, marginTop: 6, textAlign: "center", fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase" }}>
                C3 — C5 · Click or use MIDI
              </div>
            </Section>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, paddingLeft: 2 }}>Oscilloscope</div>
                <div className="crt-screen">
                  <Oscilloscope analyserRef={analyserRef} heldNotesRef={heldNotesRef} audioCtxRef={audioCtxRef} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, paddingLeft: 2 }}>Spectrum</div>
                <div className="crt-screen">
                  <Spectrum analyserRef={analyserRef} />
                </div>
              </div>
            </div>

            {/* Recorder / Looper */}
            <Section title="Recorder" icon="⏺">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {recState === "recording" ? (
                  <button onClick={stopRecording} style={{ ...btnPrimary, background: T.red, boxShadow: `0 2px 12px rgba(239,68,68,0.3)` }}>■ Stop</button>
                ) : recState === "countdown" ? (
                  <button onClick={cancelCountdown} style={{ ...btnPrimary, background: T.amber, boxShadow: `0 2px 12px rgba(245,158,11,0.3)` }}>✕ Cancel ({countdown})</button>
                ) : (
                  <button onClick={startRecording} disabled={recState === "playing"} style={{
                    ...btnPrimary, background: recState === "playing" ? T.raised : T.red,
                    boxShadow: recState === "playing" ? "none" : `0 2px 12px rgba(239,68,68,0.3)`,
                    opacity: recState === "playing" ? 0.5 : 1,
                    cursor: recState === "playing" ? "not-allowed" : "pointer",
                  }}>⏺ Record</button>
                )}
                {recState === "playing" ? (
                  <button onClick={stopPlayback} style={btnGhost}>■ Stop</button>
                ) : (
                  <button onClick={startPlayback} disabled={!recordedEvents.length || recState === "recording" || recState === "countdown"} style={{
                    ...btnGhost,
                    opacity: (!recordedEvents.length || recState === "recording" || recState === "countdown") ? 0.4 : 1,
                    cursor: (!recordedEvents.length || recState === "recording" || recState === "countdown") ? "not-allowed" : "pointer",
                  }}>▶ Play</button>
                )}
                <div
                  onClick={() => setLoopEnabled(!loopEnabled)}
                  style={{
                    ...btnGhost,
                    background: loopEnabled ? "linear-gradient(180deg, #cc6e08, #a05500)" : "linear-gradient(180deg, #2e2820, #1a1510)",
                    color: loopEnabled ? "#f0e6d2" : T.text,
                    border: `1px solid ${loopEnabled ? "rgba(255,180,60,0.4)" : T.border}`,
                    cursor: "pointer", userSelect: "none",
                  }}
                >🔁 Loop</div>
                <button onClick={exportAudio} disabled={!recordedEvents.length || audioExporting} style={{
                  ...btnGhost,
                  opacity: (!recordedEvents.length || audioExporting) ? 0.4 : 1,
                  cursor: (!recordedEvents.length || audioExporting) ? "not-allowed" : "pointer",
                }}>
                  {audioExporting ? "Exporting…" : "⬇ Export"}
                </button>
              </div>

              <div style={{
                background: T.surface, borderRadius: 8, padding: "10px 14px",
                border: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: recState === "countdown" ? T.amber
                    : recState === "recording" ? T.red
                    : recState === "playing" ? T.green : T.textMuted,
                  boxShadow: recState === "countdown" ? "0 0 8px rgba(245,158,11,0.5)"
                    : recState === "recording" ? "0 0 8px rgba(239,68,68,0.5)"
                    : recState === "playing" ? `0 0 8px ${T.greenGlow}` : "none",
                  animation: (recState === "recording" || recState === "countdown") ? "pulse 1s ease-in-out infinite" : "none",
                }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: T.text, flex: 1 }}>
                  {recState === "countdown" ? `Starting in ${countdown}…`
                    : recState === "recording" ? "Recording…"
                    : recState === "playing" ? (loopEnabled ? "Looping…" : "Playing…")
                    : recordedEvents.length ? `${recordedEvents.length} events · ${recDuration.toFixed(1)}s` : "No recording"}
                </span>
                {recState === "playing" && recDuration > 0 && (
                  <span style={{ fontSize: 12, color: T.accent, fontVariantNumeric: "tabular-nums" }}>
                    {Math.min(playbackPos, recDuration).toFixed(1)}s / {recDuration.toFixed(1)}s
                  </span>
                )}
                {loopEnabled && <Pill glow>LOOP</Pill>}
              </div>

              {recordedEvents.length > 0 && recDuration > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div
                    style={{
                      height: 32, background: T.surface,
                      borderRadius: 6, border: `1px solid ${T.border}`,
                      position: "relative", overflow: "hidden",
                    }}
                    onMouseDown={(e) => {
                      if (recState === "recording" || recState === "countdown") return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = (e.clientX - rect.left) / rect.width;
                      const dStart = Math.abs(x - trimStart);
                      const dEnd = Math.abs(x - trimEnd);
                      const threshold = 0.03;
                      let dragging = null;
                      if (dStart < threshold && dStart <= dEnd) dragging = "start";
                      else if (dEnd < threshold) dragging = "end";
                      else if (x > trimStart && x < trimEnd) dragging = x - trimStart < trimEnd - x ? "start" : "end";
                      else dragging = x < trimStart ? "start" : "end";
                      if (!dragging) return;
                      setTrimming(true);
                      const onMove = (ev) => {
                        const nx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
                        if (dragging === "start") setTrimStart(s => Math.min(nx, trimEnd - 0.01));
                        else setTrimEnd(s => Math.max(nx, trimStart + 0.01));
                      };
                      const onUp = () => {
                        window.removeEventListener("mousemove", onMove);
                        window.removeEventListener("mouseup", onUp);
                      };
                      window.addEventListener("mousemove", onMove);
                      window.addEventListener("mouseup", onUp);
                    }}
                  >
                    {(trimStart > 0 || trimEnd < 1) && (
                      <>
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${trimStart * 100}%`, background: "rgba(0,0,0,0.45)", zIndex: 2 }} />
                        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${(1 - trimEnd) * 100}%`, background: "rgba(0,0,0,0.45)", zIndex: 2 }} />
                      </>
                    )}
                    {(trimStart > 0 || trimEnd < 1 || trimming) && (
                      <>
                        <div style={{ position: "absolute", left: `${trimStart * 100}%`, top: 0, bottom: 0, width: 3, background: T.amber, zIndex: 3, cursor: "ew-resize", boxShadow: `0 0 6px rgba(245,158,11,0.5)` }} />
                        <div style={{ position: "absolute", left: `${trimEnd * 100}%`, top: 0, bottom: 0, width: 3, background: T.amber, zIndex: 3, cursor: "ew-resize", transform: "translateX(-3px)", boxShadow: `0 0 6px rgba(245,158,11,0.5)` }} />
                      </>
                    )}
                    {recordedEvents.filter(e => e.type === "on").map((e, i) => (
                      <div key={i} style={{ position: "absolute", left: `${(e.t / recDuration) * 100}%`, top: 4, bottom: 4, width: 2, borderRadius: 1, background: T.accent, opacity: 0.5 }} />
                    ))}
                    {recState === "playing" && (
                      <div style={{ position: "absolute", left: `${(Math.min(playbackPos, recDuration) / recDuration) * 100}%`, top: 0, bottom: 0, width: 2, background: T.green, boxShadow: `0 0 6px ${T.greenGlow}`, zIndex: 4 }} />
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <button
                      onClick={() => {
                        if (trimStart === 0 && trimEnd === 1) { setTrimStart(0); setTrimEnd(1); setTrimming(true); }
                        else { setTrimStart(0); setTrimEnd(1); setTrimming(false); }
                      }}
                      style={{
                        ...btnGhost, fontSize: 12, padding: "4px 10px",
                        background: trimming || (trimStart > 0 || trimEnd < 1) ? "linear-gradient(180deg, #cc6e08, #a05500)" : undefined,
                        color: trimming || (trimStart > 0 || trimEnd < 1) ? "#f0e6d2" : T.text,
                        border: `1px solid ${trimming || (trimStart > 0 || trimEnd < 1) ? "rgba(255,180,60,0.4)" : T.border}`,
                      }}
                    >✂ Trim</button>
                    {(trimStart > 0 || trimEnd < 1) && (
                      <>
                        <span style={{ fontSize: 11, color: T.textMuted, fontVariantNumeric: "tabular-nums" }}>
                          {(trimStart * recDuration).toFixed(2)}s – {(trimEnd * recDuration).toFixed(2)}s
                        </span>
                        <button
                          onClick={applyTrim}
                          disabled={recState === "playing" || recState === "recording"}
                          style={{
                            ...btnGhost, fontSize: 12, padding: "4px 10px",
                            background: "linear-gradient(180deg, #166534, #14532d)",
                            color: "#bbf7d0", border: "1px solid rgba(34,197,94,0.3)",
                            opacity: (recState === "playing" || recState === "recording") ? 0.4 : 1,
                            cursor: (recState === "playing" || recState === "recording") ? "not-allowed" : "pointer",
                          }}
                        >✓ Apply</button>
                        <button onClick={() => { setTrimStart(0); setTrimEnd(1); setTrimming(false); }} style={{ ...btnGhost, fontSize: 12, padding: "4px 10px" }}>✕ Reset</button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </Section>

            {/* Effects Chain */}
            <Section title="Effects Chain" icon="✨">
              {(() => {
                const FX_DEFS = {
                  distortion: { label: "Distortion", icon: "🔥", knobs: [
                    { key: "drive", label: "Drive", min: 1, max: 30, step: 0.1 },
                    { key: "tone",  label: "Tone",  min: 0, max: 1,  step: 0.01 },
                    { key: "mix",   label: "Mix",   min: 0, max: 1,  step: 0.01 },
                    { key: "asym",  label: "Asym",  min: 0, max: 0.6, step: 0.01 },
                  ]},
                  chorus: { label: "Chorus", icon: "🌊", knobs: [
                    { key: "mix",   label: "Mix",   min: 0, max: 1,    step: 0.01 },
                    { key: "rate",  label: "Rate",  min: 0.1, max: 8,  step: 0.1 },
                    { key: "depth", label: "Depth", min: 0, max: 0.02, step: 0.001 },
                  ]},
                  delay: { label: "Delay", icon: "🔁", knobs: [
                    { key: "mix",      label: "Mix",      min: 0, max: 1,   step: 0.01 },
                    { key: "time",     label: "Time",     min: 0.05, max: 1, step: 0.01 },
                    { key: "feedback", label: "Feedback", min: 0, max: 0.9, step: 0.01 },
                  ]},
                  reverb: { label: "Reverb", icon: "🏛", knobs: [
                    { key: "mix",   label: "Mix",   min: 0, max: 1,   step: 0.01 },
                    { key: "decay", label: "Decay", min: 0.2, max: 5, step: 0.1 },
                  ]},
                };
                return fxOrder.map((id, idx) => {
                  const def = FX_DEFS[id];
                  const fp = fxParams[id];
                  const isOpen = openEffect === id;
                  return (
                    <div
                      key={id}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", idx.toString()); e.currentTarget.style.opacity = "0.5"; }}
                      onDragEnd={(e) => { e.currentTarget.style.opacity = "1"; }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; e.currentTarget.style.borderTop = `2px solid ${T.accent}`; }}
                      onDragLeave={(e) => { e.currentTarget.style.borderTop = ""; }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.borderTop = "";
                        const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
                        if (isNaN(from) || from === idx) return;
                        setFxOrder((prev) => {
                          const next = [...prev];
                          const [moved] = next.splice(from, 1);
                          next.splice(idx, 0, moved);
                          return next;
                        });
                      }}
                      style={{
                        marginBottom: 4, borderRadius: T.radius,
                        border: `1px solid ${fp.enabled ? "rgba(255,180,60,0.25)" : T.border}`,
                        background: fp.enabled ? T.accentSoft : T.surface,
                        overflow: "hidden", transition: "background 100ms, border-color 100ms",
                      }}
                    >
                      <div
                        onClick={() => setOpenEffect(isOpen ? null : id)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "8px 12px", cursor: "pointer", userSelect: "none",
                        }}
                      >
                        <span style={{ cursor: "grab", fontSize: 11, color: T.textMuted, lineHeight: 1, letterSpacing: 1 }} title="Drag to reorder">⠿</span>
                        <span style={{ fontSize: 12 }}>{def.icon}</span>
                        <span style={{ flex: 1, fontSize: 10, fontWeight: 700, color: T.text, fontFamily: T.font, textTransform: "uppercase", letterSpacing: 1 }}>{def.label}</span>
                        <div
                          onClick={(e) => { e.stopPropagation(); updateFx(id, "enabled", !fp.enabled); }}
                          style={{
                            width: 32, height: 16, borderRadius: 2, padding: 2,
                            background: fp.enabled ? T.accent : "#181208",
                            border: `1px solid ${fp.enabled ? T.accent : T.borderHi}`,
                            cursor: "pointer", transition: "all 100ms",
                            display: "flex", alignItems: "center",
                            justifyContent: fp.enabled ? "flex-end" : "flex-start",
                            boxShadow: fp.enabled ? `0 0 6px ${T.accentGlow}` : "none",
                          }}
                        >
                          <div style={{ width: 10, height: 10, borderRadius: 1, background: fp.enabled ? "#f0e6d2" : T.textMuted, transition: "all 100ms" }} />
                        </div>
                        <span style={{ fontSize: 14, color: T.textDim, transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 100ms" }}>›</span>
                      </div>
                      {isOpen && (
                        <div style={{
                          padding: "8px 14px 16px", borderTop: `1px solid ${T.border}`,
                          display: "flex", justifyContent: "center", gap: 20, flexWrap: "wrap",
                        }}>
                          {def.knobs.map((k) => (
                            <RotaryKnob key={k.key} label={k.label} value={fp[k.key]} onChange={(v) => updateFx(id, k.key, v)} min={k.min} max={k.max} step={k.step} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </Section>
          </div>

          {/* ── RIGHT COLUMN: Parameters ─────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Section title="Parameters" icon="🎛">
              <Knob label="a" value={a} onChange={setA} defaultValue={1} lfoMod={lfoDisplay.a} />
              <Knob label="b" value={b} onChange={setB} defaultValue={0} lfoMod={lfoDisplay.b} />
              <Knob label="c" value={c} onChange={setC} defaultValue={0} lfoMod={lfoDisplay.c} />
              <Knob label="d" value={d} onChange={setD} defaultValue={0} lfoMod={lfoDisplay.d} />
            </Section>

            <Section title="Envelope" icon="📦">
              <AdsrGraph adsr={adsr} />
              <div style={{ display: "flex", justifyContent: "center", gap: 18, flexWrap: "wrap" }}>
                <RotaryKnob label="Attack" value={adsr.attack} onChange={(value) => setAdsr((prev) => ({ ...prev, attack: value }))} min={0.001} max={1.5} step={0.001} defaultValue={0.01} />
                <RotaryKnob label="Decay" value={adsr.decay} onChange={(value) => setAdsr((prev) => ({ ...prev, decay: value }))} min={0.01} max={2} step={0.01} defaultValue={0.1} />
                <RotaryKnob label="Sustain" value={adsr.sustain} onChange={(value) => setAdsr((prev) => ({ ...prev, sustain: value }))} min={0} max={1} step={0.01} defaultValue={0.7} />
                <RotaryKnob label="Release" value={adsr.release} onChange={(value) => setAdsr((prev) => ({ ...prev, release: value }))} min={0.02} max={3} step={0.01} defaultValue={0.3} />
              </div>
            </Section>

            <Section title="Filter" icon="🜁">
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Mode</div>
                <select
                  value={filter.type}
                  onChange={(e) => setFilter((prev) => ({ ...prev, type: e.target.value }))}
                  style={{
                    width: "100%", height: 40, borderRadius: T.radius,
                    border: `1px solid ${T.border}`, background: T.surface,
                    color: T.text, padding: "0 12px", outline: "none",
                  }}
                >
                  {FILTER_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 18, flexWrap: "wrap" }}>
                <RotaryKnob label="Cutoff" value={filter.cutoff} onChange={(value) => setFilter((prev) => ({ ...prev, cutoff: value }))} min={60} max={20000} step={1} defaultValue={18000} lfoMod={lfoDisplay.cutoff} />
                <RotaryKnob label="Reso" value={filter.resonance} onChange={(value) => setFilter((prev) => ({ ...prev, resonance: value }))} min={0.1} max={20} step={0.1} defaultValue={0.7} lfoMod={lfoDisplay.resonance} />
              </div>
            </Section>

            <Section title="LFO Modulation" icon="〰">
              {lfos.map((lfo, i) => (
                <div key={i} style={{
                  marginBottom: i < 2 ? 8 : 0, borderRadius: T.radius,
                  border: `1px solid ${lfo.enabled ? "rgba(255,180,60,0.25)" : T.border}`,
                  background: lfo.enabled ? T.accentSoft : T.surface,
                  overflow: "hidden", transition: "all 100ms",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: T.amber, fontFamily: T.font, letterSpacing: 1 }}>LFO {i + 1}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 9, color: T.textDim, fontFamily: T.font }}>→ {LFO_TARGETS.find(t => t.value === lfo.target)?.label}</span>
                    <div
                      onClick={() => updateLfo(i, "enabled", !lfo.enabled)}
                      style={{
                        width: 32, height: 16, borderRadius: 2, padding: 2,
                        background: lfo.enabled ? T.accent : "#181208",
                        border: `1px solid ${lfo.enabled ? T.accent : T.borderHi}`,
                        cursor: "pointer", transition: "all 100ms",
                        display: "flex", alignItems: "center",
                        justifyContent: lfo.enabled ? "flex-end" : "flex-start",
                        boxShadow: lfo.enabled ? `0 0 6px ${T.accentGlow}` : "none",
                      }}
                    >
                      <div style={{ width: 10, height: 10, borderRadius: 1, background: lfo.enabled ? "#f0e6d2" : T.textMuted, transition: "all 100ms" }} />
                    </div>
                  </div>
                  {lfo.enabled && (
                    <div style={{ padding: "4px 10px 10px", borderTop: `1px solid ${T.border}` }}>
                      <LfoScope shape={lfo.shape} rate={lfo.rate} lfoOutputRef={lfoOutputRef} index={i} />
                      <div style={{ display: "flex", gap: 4, marginTop: 6, marginBottom: 6 }}>
                        {LFO_SHAPES.map((s) => (
                          <button key={s} onClick={() => updateLfo(i, "shape", s)} style={{
                            flex: 1, height: 22, fontSize: 8, fontWeight: 700,
                            fontFamily: T.font, letterSpacing: 0.8, textTransform: "uppercase",
                            border: `1px solid ${lfo.shape === s ? T.accent : T.border}`,
                            borderRadius: 2, cursor: "pointer",
                            background: lfo.shape === s ? "linear-gradient(180deg, #cc6e08, #a05500)" : "linear-gradient(180deg, #2e2820, #1a1510)",
                            color: lfo.shape === s ? "#f0e6d2" : T.textDim,
                            padding: 0,
                          }}>
                            {s === "s&h" ? "S&H" : s.slice(0, 3).toUpperCase()}
                          </button>
                        ))}
                      </div>
                      <div style={{ marginBottom: 4 }}>
                        <select
                          value={lfo.target}
                          onChange={(e) => updateLfo(i, "target", e.target.value)}
                          style={{
                            width: "100%", height: 26, borderRadius: 2, fontSize: 9,
                            border: `1px solid ${T.border}`, background: "#181208",
                            color: T.text, padding: "0 6px", outline: "none",
                            fontFamily: T.font, letterSpacing: 1, textTransform: "uppercase",
                          }}
                        >
                          {LFO_TARGETS.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                        <RotaryKnob label="Rate" value={lfo.rate} onChange={(v) => updateLfo(i, "rate", v)} min={0.05} max={10} step={0.05} size={44} log />
                        <RotaryKnob label="Depth" value={lfo.depth} onChange={(v) => updateLfo(i, "depth", v)} min={0} max={5} step={0.01} size={44} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

# WaveCraft — Product Specification

**Version:** POC (Proof of Concept)
**Date:** April 2026
**Status:** POC complete. This document specifies the validated prototype and serves as the baseline for the production build.

---

## 1. Product Summary

WaveCraft is a browser-based synthesiser that lets users type a mathematical equation or draw a waveform by hand, then play that waveform as a real-time musical instrument. It combines a graphing calculator with a full signal chain — envelopes, filters, effects, LFOs, visualisers, recording, looping, and audio export — all running inside a single-page web application with no plugins or installs.

The product targets sound designers, music hobbyists, educators, and anyone who thinks "what does `sin(x + a*sin(b*x))` sound like?" is a reasonable question.

---

## 2. Core Concepts

### 2.1 Equation-Driven Oscillator

The fundamental innovation: the user writes a math expression that becomes the oscillator. The expression is compiled at edit time via `mathjs` and evaluated per-sample at audio rate. Available scope variables:

| Variable | Description |
|----------|-------------|
| `x` | Waveform phase (0 → 2π per cycle, scaled by X Scale) |
| `t` | Elapsed time for the current note (seconds) |
| `freq` | Note frequency (Hz) |
| `note` | MIDI note number (0–127) |
| `velocity` | Note velocity (0.0–1.0) |
| `a`, `b`, `c`, `d` | Four live-tweakable parameters |
| `pi`, `e` | Mathematical constants |

This means the oscillator is not limited to standard waveforms. Any expression — FM synthesis, waveshaping, additive, phase distortion, time-variant timbres — can be typed in and played immediately.

### 2.2 Drawn Wavetable Oscillator

As an alternative to equations, users can hand-draw a single-cycle waveform on a canvas. The wavetable is 256 samples, read with linear interpolation. When a drawn wave is loaded, it replaces the equation oscillator entirely.

### 2.3 Full Signal Chain

Every note passes through:

```
Equation or Wavetable → Per-voice ADSR Envelope → Biquad Filter
  → Effects Chain (configurable order) → Master Gain → Analyser → Output
```

---

## 3. Architecture

### 3.1 Frontend

| Layer | Technology |
|-------|-----------|
| Framework | React (functional components, hooks) |
| Build | Vite |
| Audio | Web Audio API (`ScriptProcessorNode`, 2048-sample buffer) |
| MIDI | Web MIDI API |
| Math | `mathjs` (compile + evaluate) |
| Deployment | GitHub Pages via Actions |

**Single-file architecture:** The entire synth — UI, audio engine, visualisers, recording, MIDI — lives in one JSX file (~4,000 lines). All state is managed via React hooks and refs.

### 3.2 Backend (Optional)

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + Express |
| Database | SQLite (via `better-sqlite3`, WAL mode) |
| Auth | JWT (30-day expiry) + bcrypt |
| Hosting | Self-hosted (not on GitHub Pages) |

The backend is optional. The synth runs fully offline with local preset storage. The backend adds user accounts and cloud preset sync. If deployed, the frontend reads `VITE_API_BASE` to locate the API.

---

## 4. Audio Engine

### 4.1 Synthesis

**Method:** Per-sample evaluation inside a `ScriptProcessorNode` callback (buffer size: 2048 samples, mono output).

**Polyphony:** Unlimited voices. Each held note maintains independent state:
- MIDI note number and frequency
- Velocity (smoothed per-sample at 1% coefficient to prevent clicks on retrigger)
- Phase counter (sample-accurate)
- ADSR envelope stage and current gain

**Sample generation:** For each sample of each voice:
1. Compute phase: `x = (phaseCounter / sampleRate) * freq * 2π * xScale`
2. If drawn wave: wavetable lookup with linear interpolation
3. If equation: evaluate compiled expression with smoothed `{a, b, c, d}` parameters
4. Apply `tanh(raw * yScale)` soft clipping
5. Scale by `0.28 * envelopeGain * velocity`
6. Sum all voices, apply `Math.tanh()` to the polyphonic mix (prevents digital hard clipping on chords)

**Parameter smoothing:** Equation parameters `a`, `b`, `c`, `d` are exponentially smoothed per-sample (coefficient 0.999, ~20ms at 48 kHz) to eliminate zipper noise from LFO modulation and knob changes.

**Object reuse:** The evaluation scope object is reused across samples (single persistent object, mutated in-place) to minimise garbage collection pressure and associated audio glitches.

### 4.2 ADSR Envelope

Each voice tracks its own envelope stage: `attack → decay → sustain → release`.

| Parameter | Range | Default | Unit |
|-----------|-------|---------|------|
| Attack | 0.001–1.5 | 0.012 | seconds |
| Decay | 0.01–2.0 | 0.18 | seconds |
| Sustain | 0.0–1.0 | 0.78 | level |
| Release | 0.02–3.0 | 0.22 | seconds |

Envelope is computed per-sample with linear ramps. On note retrigger (same note pressed again while held), the voice restarts from attack stage at its current gain level — no pop.

Release step is pre-calculated at note-off as `envGain / (release * sampleRate)` so release time is consistent regardless of the current gain level.

Voices are garbage-collected from the voice map when their release envelope reaches zero.

### 4.3 Filter

A single biquad filter sits between the voice mix and the effects chain.

| Parameter | Range | Default |
|-----------|-------|---------|
| Type | Bypass / Low-Pass / High-Pass / Band-Pass | Bypass (allpass) |
| Cutoff | 60–20,000 Hz | 18,000 Hz |
| Resonance (Q) | 0.1–20.0 | 0.7 |

Cutoff and resonance are modulatable by LFO. LFO-driven changes use `setTargetAtTime` for click-free transitions.

### 4.4 Effects Chain

Four effects in a configurable order. Each has independent dry/wet routing and an enable toggle. The default order is:

**Distortion → Chorus → Delay → Reverb**

Users can drag-reorder effects at runtime. Reordering causes a live rewire of the Web Audio graph.

#### 4.4.1 Distortion

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| Drive | 1–30 | 8 | Waveshaper intensity |
| Tone | 0–1.0 | 0.45 | Post-distortion lowpass (350 Hz–18.35 kHz) |
| Mix | 0–1.0 | 0.8 | Dry/wet blend |
| Asymmetry | 0–0.6 | 0.15 | Even-harmonic bias |

Implementation: `WaveShaperNode` with 4× oversampling. Curve is a 256-sample blend of 72% `tanh(k·x)` (soft) and 28% `atan(k·1.8·x)` (hard). Curve is regenerated on every parameter change.

#### 4.4.2 Chorus

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| Mix | 0–1.0 | 0.5 | Dry/wet blend |
| Rate | 0.1–8.0 Hz | 1.5 | LFO speed |
| Depth | 0–0.02 | 0.005 | Delay modulation depth |

Implementation: `DelayNode` (base 6ms) modulated by a sine `OscillatorNode`. LFO output is scaled by a `GainNode` connected to `delayTime`.

#### 4.4.3 Delay

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| Mix | 0–1.0 | 0.3 | Dry/wet blend |
| Time | 0.05–1.0 s | 0.35 | Delay time |
| Feedback | 0–0.9 | 0.4 | Feedback gain |

Implementation: `DelayNode` (max 2s) with a feedback loop through a `GainNode`.

#### 4.4.4 Reverb

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| Mix | 0–1.0 | 0.3 | Dry/wet blend |
| Decay | 0.2–5.0 s | 2.0 | Reverb tail length |

Implementation: `ConvolverNode` with synthetic impulse response generated at runtime. IR is stereo, length = `decay × sampleRate`, shaped by `(1 - i/len)²` decay curve with random noise. IR is regenerated when decay changes.

### 4.5 LFO System

Three independent LFOs, each with:

| Parameter | Range | Default |
|-----------|-------|---------|
| Enabled | on/off | off |
| Shape | sine, triangle, square, saw, sample & hold | sine |
| Rate | 0.05–10.0 Hz | 1.0 |
| Depth | 0–5.0 | 0 |
| Target | a, b, c, d, cutoff, resonance, volume | LFO 1→a, LFO 2→b, LFO 3→cutoff |

**Modulation routing:**
- Parameters `a`–`d`: additive offset to the base value
- Cutoff: exponential scaling — `cutoff × 2^(mod × 2)`
- Resonance: `Q + mod × 10`
- Volume: `masterVolume + mod × 0.3`

LFOs run on the UI animation frame loop (~60 fps). Parameter changes are applied to shared refs that the audio thread reads per-sample with smoothing - so the audio thread never blocks on UI.

S&H (sample and hold) resamples when the LFO phase crosses a cycle boundary.

### 4.6 Waveform Scaling

| Control | Range | Default | Effect |
|---------|-------|---------|--------|
| X Scale | 0.1–4.0 | 1.0 | Multiplies the phase input — stretches/compresses harmonic content |
| Y Scale | 0.1–4.0 | 1.0 | Multiplies waveform amplitude before soft clipping — adds aggression |
| Master Volume | 0–0.5 | 0.18 | Final output gain |

---

## 5. MIDI

### 5.1 Input

The app requests MIDI access on load via `navigator.requestMIDIAccess()`. All connected MIDI inputs are bound automatically. Hot-plugging is supported via the `statechange` event.

**Message handling:**
- Note On (0x90, velocity > 0): triggers `noteOn(note, velocity/127)`
- Note Off (0x80, or 0x90 with velocity 0): triggers `noteOff(note)`

### 5.2 +7th Feature

A toggle that automatically layers a minor seventh (10 semitones) above the lowest currently held note. The seventh voice is triggered at 70% of the lowest note's velocity. When the lowest note changes, the seventh is silently re-routed. The seventh is not recorded as a separate user event — it piggybacks on the lowest real note.

---

## 6. On-Screen Keyboard

**Range:** C3 (MIDI 48) to C5 (MIDI 72) — 25 notes, 2 octaves.

**Interaction:**
- Click to play, release to stop
- Drag across keys while held to glide
- Active keys light up with accent colour glow

**Velocity:** Fixed at 0.8 for mouse/touch input. MIDI provides full 0–1 velocity.

---

## 7. Visualisers

### 7.1 Waveform Preview (PlotCanvas)

A 600×600 canvas showing the current equation's shape over one cycle. Updates on equation or parameter change. When LFO is active, shows both the base waveform (dimmed) and the modulated waveform (bright, on top).

### 7.2 Oscilloscope

A 280×100 canvas displaying the live audio output time-domain waveform.

- **Source:** `AnalyserNode.getFloatTimeDomainData()` (2048 samples)
- **Trigger:** Zero-crossing detection (rising edge) for stable display
- **Period detection:** Calculates expected period from the lowest held note's frequency
- **Display:** ~2 full cycles of the detected period
- **Auto-scaling:** Peak amplitude tracked with asymmetric smoothing (fast attack, slow release)

### 7.3 Spectrum Analyser

A 280×100 canvas showing the frequency spectrum as a bar chart.

- **Source:** `AnalyserNode.getByteFrequencyData()` (1024 bins)
- **Smoothing:** 0.8 time constant
- **Colour:** Warm-to-cool gradient across frequency bins

### 7.4 ADSR Graph

A 280×100 canvas rendering the current envelope shape with labelled A/D/S/R segments, control point dots, and a green-glow filled area.

### 7.5 LFO Scopes

Three 120×36 mini-canvases (one per LFO) showing the LFO waveform shape and a live output indicator dot.

---

## 8. Recording & Export

### 8.1 Recording

The recorder captures **note events**, not raw audio. Each event is:

```
{ t: seconds, type: "on" | "off", note: midiNumber, velocity: 0–1 }
```

Time is relative to recording start (measured via `performance.now()`).

**Countdown:** 3-second visual countdown before recording begins.

### 8.2 Playback

Playback re-triggers the synth engine using the stored event timeline via chained `setTimeout` calls. This means:
- Playback always uses the **current** sound design, not a frozen snapshot
- Changing the equation, ADSR, filter, or effects during playback affects the sound immediately

### 8.3 Trim

A visual timeline with draggable start/end handles. "Trim" filters the event list to the selected window and shifts timestamps to start at zero.

### 8.4 Loop

A toggle. When enabled, playback automatically restarts from the beginning after the last event, releasing all held notes between iterations.

### 8.5 Export

Export captures real audio output:
1. A `MediaStreamDestination` is created and wired to the master gain
2. A `MediaRecorder` (codec: `audio/webm;codecs=opus`) captures the stream
3. The recorded event timeline is replayed through the synth
4. After the sequence completes (+200ms tail), the recorder stops
5. The resulting blob is downloaded as `wavecraft-{timestamp}.webm`

---

## 9. Presets

### 9.1 Built-in Presets (12)

| Name | Equation | a | b | c | d |
|------|----------|---|---|---|---|
| Pure Sine | `sin(x)` | 1 | 0 | 0 | 0 |
| FM Bell | `sin(x + a*sin(b*x))` | 3 | 7 | 0 | 0 |
| Warm Saw | `tanh(a*sin(x) + b*sin(2*x) + c*sin(3*x))` | 1 | 0.5 | 0.33 | 0 |
| Fat Square | `tanh(a * sin(x))` | 5 | 0 | 0 | 0 |
| Organ | `sin(x) + a*sin(2*x) + b*sin(3*x) + c*sin(4*x)` | 0.5 | 0.25 | 0.125 | 0 |
| Chirp | `sin(a*x^2 + b*x)` | -1.149 | 0.113 | 0 | 0 |
| PWM | `sign(sin(x) - a)` | 0 | 0 | 0 | 0 |
| Metallic | `sin(x + a*sin(b*x)) + c*sin(11*x)` | 2 | 5 | 0.15 | 0 |
| Sub Bass | `sin(x) + a*sin(0.5*x)` | 0.8 | 0 | 0 | 0 |
| Pluck | `sin(x) * exp(-a*t) * (1 + b*sin(3*x))` | 3 | 0.5 | 0 | 0 |
| Noise Ring | `tanh(sin(x) + a*sin(x*1.01) + b*sin(x*2.99))` | 0.8 | 0.4 | 0 | 0 |
| Alien | `sin(a*x) * cos(b*x) + c*sin(d*x)` | 1 | 0.5 | 0.3 | 3 |

Each preset also carries its own ADSR profile, filter defaults (bypass, 18 kHz, Q 0.7), all effects off, and three disabled LFOs.

### 9.2 User Presets (Local)

Saved to `localStorage` as JSON under `wavecraft_user_presets`. Each preset stores:

```
{ name, eq, a, b, c, d, xScale, yScale, masterVolume,
  adsr, filter, fxParams, add7th, lfos, drawnWave? }
```

### 9.3 Cloud Presets (Authenticated)

Same data as local presets but stored server-side. UPSERT semantics: saving a preset with an existing name overwrites it.

---

## 10. Wave Drawer

### 10.1 Canvas

800×300 pixel drawing surface. Cross-hair cursor. Grid overlay (4×4 divisions with centre line).

### 10.2 Drawing Tool

Freehand painting — pointer down + drag writes sample values directly. Resolution: 256 samples per cycle.

### 10.3 Processing

- **Smooth:** 3-tap moving average (weights: 0.25, 0.5, 0.25)
- **Normalize:** Peak normalize to ±1.0
- **Clear:** Zero-fill the wavetable

### 10.4 Preset Shapes (19)

| Shape | Description |
|-------|-------------|
| Sine | Pure sine wave |
| Triangle | Band-limited triangle |
| Square | Hard square wave |
| Sawtooth | Rising sawtooth |
| Pulse 25 | 25% duty cycle pulse |
| PWM Rich | Sine-modulated duty cycle pulse |
| SuperSaw | 5 detuned sawtooth voices (±0.3%, ±0.9%) |
| Juno Wire | 3-harmonic additive (classic Juno character) |
| Moog Bass | tanh-saturated 3-harmonic additive |
| OB Brass | 4-harmonic additive (Oberheim style) |
| Prophet Sweep | Sine × PWM crossfade blend |
| TB Squelch | tanh-saturated saw + 2 sines (acid character) |
| Sync Lead | Pseudo-oscillator sync via phase modulation |
| Vox Formant | 3 non-harmonic sines (vocal quality) |
| Glass FM | FM synthesis with high modulation index |
| Bell DX | 3 non-harmonic partials (DX7 bell) |
| Choir Pad | 3 harmonics with phase offsets (ensemble) |
| Reese | 2 slightly detuned sines + sub (DnB bass) |
| Noise | Random values (white noise wavetable) |

All preset shapes are peak-normalised on load.

---

## 11. Drum Machines

Two independent drum machines share the same audio context and master gain.

### 11.1 VL-Tone Drum Machine

Modelled after the Casio VL-Tone. 16-step sequencer, 3 sounds.

#### Sounds

| ID | Name | Synthesis | Default Pitch | Default Decay | Default Volume |
|----|------|-----------|---------------|---------------|----------------|
| po | Po (Bass) | Sine oscillator with exponential frequency sweep (pitch×2 → pitch) | 150 Hz | 30 ms | 0.8 |
| pi | Pi (Click) | Square oscillator with frequency ramp + decay | 1,000 Hz | 20 ms | 0.6 |
| sha | Sha (Noise) | Bandpass-filtered noise burst | 6,000 Hz | 160 ms | 0.5 |

#### Sound Parameter Ranges

| Sound | Pitch Range | Decay Range |
|-------|-------------|-------------|
| Po | 40–500 Hz | 5–150 ms |
| Pi | 40–4,000 Hz | 5–150 ms |
| Sha | 1,000–12,000 Hz | 5–500 ms |

#### Built-in Patterns (10)

Rock 1 (120 BPM), Rock 2 (128), March (112), Waltz (108), 4 Beat (120), Swing (116), Bossa Nova (126), Samba (132), Beguine (118), Rhumba (110).

#### Transport

- Play/Stop (synced with PO-32 via shared transport toggle)
- BPM: 60–240
- Drum Volume: 0–100%
- Pad (preview) Volume: 0–100%
- Sound preview: click a sound label to audition it

#### User Presets

Saved to `localStorage` under `wavecraft_drum_presets`. Each stores the step grid, tempo, and sound parameters.

### 11.2 PO-32 Tonic Drum Machine

Modelled after the Teenage Engineering PO-32 Tonic. 16-step sequencer, 16 sounds across 4 channels.

#### Sounds (16)

| ID | Name | Category | Synthesis |
|----|------|----------|-----------|
| 0 | Kick | Drums | Sine with exponential frequency sweep |
| 1 | Snare | Drums | 3× bandpass-filtered noise bursts |
| 2 | Clap | Drums | Triple noise attack + decay tail |
| 3 | High Hat | Drums | Highpass-filtered noise |
| 4 | Closed Hat | Drums | Short highpass noise |
| 5 | Open Hat | Drums | Long highpass noise |
| 6 | Tom Metal | Drums | Noise + bandpass + square oscillator |
| 7 | Conga | Drums | Sine frequency sweep |
| 8 | Low Tom | Drums | Sine sweep (lower) |
| 9 | Rimshot | Drums | High-frequency transient |
| 10 | Tambourine | Drums | Filtered noise burst |
| 11 | Clap (ext.) | Drums | Extended triple-burst clap |
| 12 | Bass | Bass | Sine/sawtooth with lowpass sweep |
| 13 | FM | Bass | Carrier + modulator FM pair |
| 14 | Synth | Bass | Sawtooth + resonant lowpass |
| 15 | Noise | Texture | Lowpass-filtered noise |

#### Per-Sound Controls

Each sound has a **Pitch** knob and a **Morph** knob. Morph adjusts the decay and character of each sound in a synthesis-appropriate way (e.g. longer tail for kick, more resonance for synth bass).

#### Sequencer Features

- 16-step grid per sound (16×16 matrix total)
- **Accent row:** 16-step accent pattern (1.3× volume boost on accented steps vs 0.8× normal)
- **Swing:** 0–100% — shifts even/odd step timing
- **4-channel mute:** Sounds grouped into 4 channels of 4, each independently muteable
- Live step indicator with green glow

#### Built-in Patterns

8 patterns: TR-808 (120 BPM), Trap (140), House (126), Techno (132), DnB (174), Hip Hop (90), Afrobeat (110), UK Garage (138).

#### User Presets

Saved to `localStorage` under `wavecraft_po32_presets`.

### 11.3 Shared Transport

Both drum machines can be started/stopped together via a single sync toggle. They share a BPM value and a sync epoch so they start in phase.

### 11.4 Combined Drum Presets

A "save all drums" feature captures both machines' state (steps, params, BPM) into a single preset stored in `localStorage`.

---

## 12. User Interface

### 12.1 Design Language

Industrial dark theme. Colours:

| Token | Value | Usage |
|-------|-------|-------|
| Background | `#111111` | Page background |
| Surface | `#222222` | Panel backgrounds |
| Accent | `#ff3300` | Active elements, buttons |
| Green | `#00e676` | LED indicators, values, plot lines |
| Amber | `#ffaa00` | Section titles, warnings |
| Text | `#f0f0f0` | Primary text |
| Text Dim | `#999999` | Secondary labels |

CRT scanline overlay (fixed, pointer-events: none) across the entire viewport for retro character.

### 12.2 Layout

Three-page tabbed interface: **Synth**, **Draw**, **Drums**.

#### Top Bar (sticky)
- Logo: "∿ EQUATIONSYNTH v0.1"
- Page tabs
- Engine status pill (green = audio active)
- MIDI status pill
- Auth button / user display

#### Synth Page (3-column responsive grid)

**Left Column (~380px):**
- Waveform preview (plot canvas)
- Equation input with Apply button
- X/Y scale rotary knobs
- Built-in presets grid
- User presets list (local)
- Cloud presets list (authenticated)

**Centre Column (fluid):**
- Master volume knob + sample rate display
- Piano keyboard + +7th toggle
- Oscilloscope and spectrum analyser (2-column grid)
- Recorder controls (record/play/stop/loop/export) with visual timeline and trim handles
- Effects chain (accordion panels, drag-reorderable)

**Right Column (~290px):**
- Parameter knobs: a, b, c, d
- ADSR graph + 4 rotary knobs
- Filter section (type dropdown, cutoff, resonance)
- Equation variable reference card
- 3× LFO panels (collapsible)

#### Draw Page
- Wave drawing canvas (800×300)
- Tool row: Draw, Smooth, Normalize, Clear
- Preset shapes grid (19 shapes)
- "Use Wave in Synth" button

#### Drums Page
- VL-Tone drum machine (step grid, transport, patterns, sound controls)
- PO-32 Tonic drum machine (step grid, transport, patterns, per-sound controls)
- Combined preset save/load

### 12.3 Custom Controls

**Knob (Slider):** Horizontal range input with value display, LFO modulation bar, optional reset button.

**RotaryKnob:** Circular dial (270° arc from -135° to +135°). Vertical drag interaction. Supports linear and logarithmic scaling. Shows arc fill, LFO modulation pointer, and reset affordance.

**Section:** Bordered card with gradient background, title bar (amber, uppercase, icon), inset shadow.

**Pill:** Inline status badge with optional glow state.

---

## 13. Backend API

### 13.1 Database

SQLite via `better-sqlite3`, WAL mode, foreign keys enabled.

**Users table:**

| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PRIMARY KEY |
| email | TEXT | UNIQUE, NOT NULL |
| password_hash | TEXT | NOT NULL (bcrypt, cost 10) |
| display_name | TEXT | NOT NULL |
| created_at | TEXT | DEFAULT current timestamp |

**Presets table:**

| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PRIMARY KEY |
| user_id | INTEGER | FK → users(id) ON DELETE CASCADE |
| name | TEXT | NOT NULL |
| data | TEXT | NOT NULL (JSON string) |
| created_at | TEXT | DEFAULT current timestamp |
| updated_at | TEXT | DEFAULT current timestamp |
| | | UNIQUE(user_id, name) |

### 13.2 Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/signup` | No | Create account. Password ≥8 chars, display name 1–50 chars. Returns JWT + user. |
| POST | `/api/login` | No | Authenticate. Returns JWT + user. |
| GET | `/api/me` | Yes | Return current user info. |
| GET | `/api/presets` | Yes | List user's presets (newest first). |
| GET | `/api/presets/:id` | Yes | Get preset data (scoped to user). |
| POST | `/api/presets` | Yes | Create or update preset (UPSERT by name). Name 1–100 chars. |
| DELETE | `/api/presets/:id` | Yes | Delete preset (scoped to user). |

**Auth:** JWT in `Authorization: Bearer <token>` header. Tokens expire after 30 days.

**CORS:** Open (`app.use(cors())`).

**Body limit:** 2 MB JSON.

---

## 14. Data Persistence

| Data | Storage | Scope |
|------|---------|-------|
| Engine state (equation, params, ADSR, filter, FX, LFOs) | React state (volatile) | Session |
| User presets | `localStorage` (`wavecraft_user_presets`) | Browser |
| VL-Tone drum presets | `localStorage` (`wavecraft_drum_presets`) | Browser |
| PO-32 Tonic drum presets | `localStorage` (`wavecraft_po32_presets`) | Browser |
| Auth token + user | `localStorage` (`wavecraft_token`, `wavecraft_user`) | Browser |
| Cloud presets | SQLite (server) | Account |
| FX chain order | React state (volatile) | Session |
| Recorded events | React state (volatile) | Session |

---

## 15. Known Limitations (POC)

### 15.1 Audio Engine

| Issue | Impact | Production Fix |
|-------|--------|----------------|
| `ScriptProcessorNode` is deprecated | Works but runs on main thread; can stutter on heavy UI or GC pressure | Migrate to `AudioWorkletProcessor` |
| Buffer size fixed at 2048 samples | ~46ms latency at 44.1 kHz; perceptible on fast playing | AudioWorklet with 128-sample blocks (~3ms) |
| Mono output only | No stereo field | Add stereo panning per voice, stereo chorus/delay |
| `mathjs` evaluation per sample | CPU-heavy for complex equations | Pre-compile to optimised JS function or WASM |
| No anti-aliasing on wavetable oscillator | Aliasing on high notes with harmonically rich waveforms | Band-limited wavetable mipmaps (PolyBLEP or oversampling) |
| No voice stealing or voice limit | CPU can spike with many MIDI notes held | Implement voice pool with configurable max polyphony |

### 15.2 Export

| Issue | Production Fix |
|-------|----------------|
| WebM/Opus only (no WAV) | Add WAV export via offline `AudioContext` rendering |
| Export replays in real-time (slow) | Use `OfflineAudioContext` for instant rendering |
| No metadata in exported file | Embed title, BPM, timestamp |

### 15.3 Recording

| Issue | Production Fix |
|-------|----------------|
| Event timeline stored in volatile state (lost on refresh) | Persist to localStorage or IndexedDB |
| No undo/redo on recording | Event history stack |
| No quantisation | Snap-to-grid with configurable resolution |
| No multi-track | Separate synth vs. drum event lanes |

### 15.4 UI / UX

| Issue | Production Fix |
|-------|----------------|
| Single 4,000-line file | Component decomposition into modules |
| No responsive/mobile layout | Responsive breakpoints, touch-optimised controls |
| No keyboard shortcuts for play/record/stop | Hotkey system (spacebar, R, etc.) |
| On-screen keyboard fixed at 2 octaves | Configurable range, octave shift buttons |
| No MIDI learn (map CC to parameters) | MIDI CC → parameter binding UI |
| No undo on parameter changes | Parameter history stack |
| FX chain order not persisted | Include in preset save/localStorage |

### 15.5 Backend

| Issue | Production Fix |
|-------|----------------|
| No rate limiting | Express rate-limiter middleware |
| No email verification | Email confirmation flow |
| No password reset | Reset token via email |
| CORS wide open | Restrict to known origins |
| JWT secret may be hardcoded | Environment variable, rotation support |
| No preset sharing between users | Public/private preset visibility |

---

## 16. Production Roadmap

### Phase 1: Engine Overhaul

- [ ] Migrate `ScriptProcessorNode` → `AudioWorkletProcessor` (128-sample buffer, off-main-thread)
- [ ] Pre-compile equations to optimised JS functions (eliminate per-sample `mathjs` overhead)
- [ ] Add band-limited wavetable rendering (PolyBLEP or mipmap interpolation)
- [ ] Voice pool with configurable max polyphony and voice stealing (oldest / quietest)
- [ ] Stereo output with per-voice panning
- [ ] WAV export via `OfflineAudioContext`

### Phase 2: Modular Architecture

- [ ] Decompose monolith into separate modules: engine, UI, effects, MIDI, recording, drums
- [ ] State management (Zustand or similar) replacing deeply nested React state
- [ ] Unit tests for audio engine (offline context, known-input/known-output)
- [ ] Component-level tests for UI

### Phase 3: UX & Features

- [ ] Responsive layout for tablet and mobile
- [ ] Keyboard shortcuts (spacebar = play/stop, R = record, etc.)
- [ ] MIDI CC learn / parameter mapping
- [ ] Configurable keyboard range and octave shift
- [ ] Undo/redo for parameter changes and recording edits
- [ ] Quantise recorded events
- [ ] Multi-track recording (synth + drum lanes)
- [ ] Persist recording and FX order to presets

### Phase 4: Backend Hardening

- [ ] Rate limiting on all endpoints
- [ ] Email verification and password reset
- [ ] Scoped CORS
- [ ] JWT secret from environment, token refresh
- [ ] Preset sharing (public/private/link-share)
- [ ] Social features (like, fork, remix)

### Phase 5: Polish

- [ ] Loading states and error boundaries
- [ ] Accessibility (ARIA labels, keyboard navigation)
- [ ] PWA manifest + service worker for offline use
- [ ] Onboarding tutorial / guided first session
- [ ] Preset browser with categories, tags, search

---

## 17. Technical Debt Register

| Item | Severity | Location | Notes |
|------|----------|----------|-------|
| Entire app in single JSX file | High | `graphing_calculator_synth_app.jsx` | ~4,000 lines; must decompose before adding features |
| ScriptProcessorNode (deprecated) | High | `setupAudio()` | Functional but blocks main thread |
| No test coverage | High | — | Zero unit or integration tests |
| localStorage for auth tokens | Medium | Auth flow | Consider httpOnly cookies or secure session |
| `let T = {...THEMES.industrial}` global mutable | Medium | Theme system | Should be React context or CSS variables |
| Drum machine imperative handle pattern | Low | `React.forwardRef` + `useImperativeHandle` | Works but fragile; prefer shared state |
| CRT overlay always rendered | Low | CSS injection on load | Negligible perf cost but not toggleable |

---

## 18. Metrics (POC Baseline)

| Metric | POC Value |
|--------|-----------|
| Bundle size (dev) | ~1.2 MB (unminified, includes mathjs) |
| First paint | < 1s (Vite dev server) |
| Audio latency | ~46ms (2048-sample buffer at 44.1 kHz) |
| Max comfortable polyphony | ~8–12 voices (CPU-dependent, main thread) |
| Wavetable resolution | 256 samples |
| Supported browsers | Chrome, Edge, Firefox (Web Audio + MIDI) |
| Mobile support | Functional but not optimised |

---

*This document describes WaveCraft as built in the POC. The production version should address the items in Sections 15–17 before public release.*

# WaveCraft

WaveCraft is a browser synth for people who think a graphing calculator should be allowed to headline a gig.

Type an equation like `sin(x + a*sin(b*x))`, or draw a waveform by hand, and the app turns it into a playable instrument. Then it lets you bend that sound through envelopes, filters, effects, live visualizers, recording, looping, and export.

In short: this is part math toy, part sound design sandbox, part tiny performance rig.

## What It Does

- Builds a playable waveform from either a math expression or a hand-drawn wavetable
- Lets you modulate the sound with four live parameters: `a`, `b`, `c`, and `d`
- Supports ADSR envelope shaping, filtering, distortion, chorus, delay, and reverb
- Plays from an on-screen keyboard or any connected MIDI controller that the browser exposes
- Shows a waveform preview, oscilloscope, and spectrum display while you play
- Records note events, replays them in time, loops them, and exports the result as an audio file

## Quick Start

The runnable app lives in [`app/`](./app).

```bash
cd app
npm install
npm run dev
```

Open the Vite URL in your browser, click `Enable Audio`, and start making noise.

## GitHub Pages

This repo is set up to publish the frontend in `app/` to GitHub Pages with Actions.

1. Push this repo to GitHub.
2. In GitHub, open `Settings -> Pages`.
3. Set `Build and deployment` to `GitHub Actions`.
4. Push to `main` or run the `Deploy GitHub Pages` workflow manually.

The published site will host the synth UI only. GitHub Pages cannot run the Node/SQLite backend in `server/`.

If you want cloud presets/login on the deployed site, host the API separately and add a repository variable named `VITE_API_BASE` with your API URL, for example `https://your-api.example.com`.

## How To Use It

1. Enter an equation in the `f(x)` box and click `Apply`.
2. Or switch to the `Draw` tab, sketch a waveform, and click `Use Wave in Synth`.
3. Play notes with the on-screen keyboard or a MIDI controller.
4. Tweak `a`, `b`, `c`, `d`, the ADSR envelope, filter, and effects chain.
5. Record a phrase, loop it, then export the performance.

If you just want a fast win, start with one of the built-in presets and then mutate it until it becomes something rude.

## Equation Cheatsheet

WaveCraft evaluates your expression for every sample it generates. The useful variables are:

- `x`: waveform phase input
- `t`: elapsed time for the current note, in seconds
- `freq`: note frequency in Hz
- `note`: MIDI note number
- `velocity`: note velocity from `0` to `1`
- `a`, `b`, `c`, `d`: live parameter knobs
- `pi`, `e`: math constants

Some good starters:

```txt
sin(x)
sin(x + a*sin(b*x))
tanh(sin(x) + 0.5*sin(2*x))
sin(x) * exp(-0.001*t)
sin(a*x) * cos(b*x) + c*sin(d*x)
```

Two controls matter more than they first appear:

- `X Scale` stretches the phase input, which changes the visual and harmonic shape of the oscillator.
- `Y Scale` boosts the waveform before soft clipping, which makes it a quick way to add aggression.

## How It Works

WaveCraft has two sound sources:

- Equation mode: the app compiles your expression with `mathjs` and evaluates it during audio generation.
- Draw mode: the app stores a 256-sample wavetable and reads through it with linear interpolation.

Each active note keeps track of its own:

- MIDI note number and frequency
- velocity
- phase position
- ADSR envelope stage and gain

During playback, the app mixes all held notes inside a `ScriptProcessorNode`, then sends the signal through this chain:

```txt
equation or drawn wave
-> ADSR envelope
-> filter
-> distortion
-> chorus
-> delay
-> reverb
-> master gain
-> analyser
-> speakers / export
```

That means the waveform is not just drawn for show. The exact shape you type or sketch is the thing the synth actually reads while generating audio.

## Recording, Looping, and Export

The recorder does not capture raw audio first. It stores timed note events.

That gives WaveCraft a nice trick: when you hit play, it re-runs the synth engine and effects chain using the recorded note timeline. In practice, this means your take stays editable through the current sound design instead of becoming a frozen sample immediately.

Export works by temporarily mirroring the synth output into a `MediaStreamDestination` and capturing it with `MediaRecorder`. The current implementation downloads a `.webm` file.

## UI Tour

- `Waveform Preview`: shows the current equation or drawn wavetable
- `Presets`: loads quick starting points like bell, organ, PWM, pluck, and metallic tones
- `Keyboard`: playable range from `C3` to `C5`
- `+7th`: automatically layers a seventh above the lowest played note
- `Effects Chain`: toggle and tweak distortion, chorus, delay, and reverb
- `Oscilloscope` and `Spectrum`: live visual feedback from the running audio graph

## Project Structure

- [`app/src/graphing_calculator_synth_app.jsx`](./app/src/graphing_calculator_synth_app.jsx): the main application, UI, audio engine, recording, MIDI handling, and visualizers
- [`app/src/main.jsx`](./app/src/main.jsx): React entry point
- [`app/src/index.css`](./app/src/index.css): global styles and animation helpers

## Tech Stack

- React
- Vite
- Web Audio API
- Web MIDI API
- `mathjs`

## Notes

- MIDI support depends on browser support and permission prompts.
- The synth currently uses `ScriptProcessorNode`, which is simple and effective for this prototype, though `AudioWorklet` would be the natural next step for a more production-grade engine.
- Export currently produces `.webm`, not `.wav`.

## Why This Exists

Because sometimes "what if I could play an equation" is a valid product requirement.

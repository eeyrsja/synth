/**
 * Recorder module — manages recording state, event capture,
 * playback scheduling, and audio export.
 *
 * This module holds mutable state via a refs pattern (no React dependency).
 */

export function createRecorderState() {
  return {
    startTime: 0,
    events: [],
    stateRef: "idle", // internal state tracking (not the React state)
    playTimer: null,
    playStart: 0,
    playIdx: 0,
    playHeld: new Set(),
    countdownTimer: null,
    mediaRec: null,
    mediaChunks: [],
  };
}

/**
 * Record a note-on event.
 */
export function recNoteOn(recorder, note, velocity = 0.8) {
  if (recorder.stateRef !== "recording") return;
  recorder.events.push({
    t: (performance.now() - recorder.startTime) / 1000,
    type: "on",
    note,
    velocity,
  });
}

/**
 * Record a note-off event.
 */
export function recNoteOff(recorder, note) {
  if (recorder.stateRef !== "recording") return;
  recorder.events.push({
    t: (performance.now() - recorder.startTime) / 1000,
    type: "off",
    note,
  });
}

/**
 * Start recording with countdown.
 *
 * @param {object} recorder - Recorder state
 * @param {object} callbacks
 * @param {Function} callbacks.onCountdown - Called with remaining count
 * @param {Function} callbacks.onStart - Called when recording actually starts
 * @param {Function} callbacks.panic - Called to clear all notes before recording
 */
export function startRecording(recorder, { onCountdown, onStart, panic }) {
  panic?.();
  onCountdown?.(3);

  let count = 3;
  recorder.countdownTimer = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(recorder.countdownTimer);
      recorder.countdownTimer = null;
      recorder.events = [];
      recorder.startTime = performance.now();
      recorder.stateRef = "recording";
      onStart?.();
    } else {
      onCountdown?.(count);
    }
  }, 1000);
}

/**
 * Cancel an in-progress countdown.
 */
export function cancelCountdown(recorder, { onCancel }) {
  if (recorder.countdownTimer) clearInterval(recorder.countdownTimer);
  recorder.countdownTimer = null;
  recorder.stateRef = "idle";
  onCancel?.();
}

/**
 * Stop recording.
 * @returns {{ events: Array, duration: number }}
 */
export function stopRecording(recorder, { panic }) {
  const dur = (performance.now() - recorder.startTime) / 1000;
  // Close any still-held notes
  for (const n of recorder.playHeld) {
    recorder.events.push({ t: dur, type: "off", note: n });
  }
  const events = [...recorder.events];
  recorder.stateRef = "idle";
  panic?.();
  return { events, duration: dur };
}

/**
 * Start playback of recorded events.
 */
export function startPlayback(recorder, events, duration, loopEnabled, { noteOn, noteOff, onPosition, onEnd }) {
  if (!events.length) return;

  recorder.playHeld.clear();
  recorder.playIdx = 0;
  recorder.playStart = performance.now();

  const scheduleNext = () => {
    const idx = recorder.playIdx;
    if (idx >= events.length) {
      const remaining = duration * 1000 - (performance.now() - recorder.playStart);
      recorder.playTimer = setTimeout(() => {
        for (const n of recorder.playHeld) noteOff(n);
        recorder.playHeld.clear();
        if (loopEnabled) {
          recorder.playIdx = 0;
          recorder.playStart = performance.now();
          onPosition?.(0);
          scheduleNext();
        } else {
          onEnd?.();
        }
      }, Math.max(0, remaining));
      return;
    }

    const ev = events[idx];
    const elapsed = performance.now() - recorder.playStart;
    const wait = ev.t * 1000 - elapsed;

    recorder.playTimer = setTimeout(() => {
      if (ev.type === "on") {
        noteOn(ev.note, ev.velocity || 0.8);
        recorder.playHeld.add(ev.note);
      } else {
        noteOff(ev.note);
        recorder.playHeld.delete(ev.note);
      }
      onPosition?.((performance.now() - recorder.playStart) / 1000);
      recorder.playIdx = idx + 1;
      scheduleNext();
    }, Math.max(0, wait));
  };

  scheduleNext();
}

/**
 * Stop playback.
 */
export function stopPlayback(recorder, { noteOff, onStop }) {
  if (recorder.playTimer) clearTimeout(recorder.playTimer);
  recorder.playTimer = null;
  for (const n of recorder.playHeld) noteOff(n);
  recorder.playHeld.clear();
  onStop?.();
}

/**
 * Export recorded audio as WebM.
 */
export function exportAudio(recorder, events, duration, engine, { noteOn, noteOff, panic, onExportStart, onExportEnd }) {
  if (!events.length || !engine.audioCtx) return;

  onExportStart?.();

  const dest = engine.audioCtx.createMediaStreamDestination();
  engine.gain.connect(dest);

  const mediaRec = new MediaRecorder(dest.stream, { mimeType: "audio/webm;codecs=opus" });
  recorder.mediaChunks = [];
  mediaRec.ondataavailable = (e) => { if (e.data.size) recorder.mediaChunks.push(e.data); };
  mediaRec.onstop = () => {
    engine.gain.disconnect(dest);
    const blob = new Blob(recorder.mediaChunks, { type: "audio/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wavecraft-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
    onExportEnd?.();
  };

  mediaRec.start();
  panic?.();
  recorder.playHeld.clear();

  let i = 0;
  const t0 = performance.now();
  const step = () => {
    if (i >= events.length) {
      const rem = duration * 1000 - (performance.now() - t0);
      setTimeout(() => {
        for (const n of recorder.playHeld) noteOff(n);
        recorder.playHeld.clear();
        setTimeout(() => mediaRec.stop(), 200);
      }, Math.max(0, rem));
      return;
    }
    const ev = events[i];
    const wait = ev.t * 1000 - (performance.now() - t0);
    setTimeout(() => {
      if (ev.type === "on") {
        noteOn(ev.note, ev.velocity || 0.8);
        recorder.playHeld.add(ev.note);
      } else {
        noteOff(ev.note);
        recorder.playHeld.delete(ev.note);
      }
      i++;
      step();
    }, Math.max(0, wait));
  };
  step();
}

/**
 * Apply trim to recorded events.
 */
export function applyTrim(events, duration, trimStart, trimEnd) {
  const tMin = trimStart * duration;
  const tMax = trimEnd * duration;
  const trimmed = events
    .filter((e) => e.t >= tMin && e.t <= tMax)
    .map((e) => ({ ...e, t: e.t - tMin }));
  return { events: trimmed, duration: tMax - tMin };
}

/**
 * Cleanup recorder timers on unmount.
 */
export function cleanupRecorder(recorder) {
  if (recorder.playTimer) clearTimeout(recorder.playTimer);
  if (recorder.countdownTimer) clearInterval(recorder.countdownTimer);
}

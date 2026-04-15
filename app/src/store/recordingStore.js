import { create } from "zustand";

const useRecordingStore = create((set, get) => ({
  recState: "idle", // idle | countdown | recording | playing
  countdown: 0,
  loopEnabled: false,
  recordedEvents: [],
  playbackPos: 0,
  recDuration: 0,
  audioExporting: false,
  trimStart: 0,
  trimEnd: 1,
  trimming: false,

  setRecState: (v) => set({ recState: v }),
  setCountdown: (v) => set({ countdown: v }),
  setLoopEnabled: (v) => set({ loopEnabled: v }),
  setRecordedEvents: (v) => set({ recordedEvents: v }),
  setPlaybackPos: (v) => set({ playbackPos: v }),
  setRecDuration: (v) => set({ recDuration: v }),
  setAudioExporting: (v) => set({ audioExporting: v }),
  setTrimStart: (v) => set({ trimStart: v }),
  setTrimEnd: (v) => set({ trimEnd: v }),
  setTrimming: (v) => set({ trimming: v }),
}));

export default useRecordingStore;

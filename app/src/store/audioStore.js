import { create } from "zustand";

const useAudioStore = create((set) => ({
  audioReady: false,
  activeNotes: [],
  sampleRate: 44100,

  setAudioReady: (v) => set({ audioReady: v }),
  setActiveNotes: (v) => set({ activeNotes: typeof v === "function" ? v : v }),
  setSampleRate: (v) => set({ sampleRate: v }),
}));

export default useAudioStore;

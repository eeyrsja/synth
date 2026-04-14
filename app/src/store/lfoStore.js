import { create } from "zustand";
import { DEFAULT_LFO } from "../engine/types.js";

const useLfoStore = create((set, get) => ({
  lfos: [
    { ...DEFAULT_LFO },
    { ...DEFAULT_LFO, target: "b" },
    { ...DEFAULT_LFO, target: "cutoff" },
  ],
  lfoUiTick: 0,

  setLfos: (v) => set({ lfos: typeof v === "function" ? v(get().lfos) : v }),
  updateLfo: (idx, key, val) => set((s) => {
    const next = [...s.lfos];
    next[idx] = { ...next[idx], [key]: val };
    return { lfos: next };
  }),
  tickLfoUi: () => set((s) => ({ lfoUiTick: (s.lfoUiTick + 1) % 1000000 })),
}));

export default useLfoStore;

import { create } from "zustand";
import { DEFAULT_EQ, DEFAULT_ADSR, DEFAULT_FILTER, DEFAULT_LFO, DEFAULT_FX_PARAMS, withFxDefaults } from "../engine/types.js";

const useSynthStore = create((set, get) => ({
  // Equation
  equationInput: DEFAULT_EQ,
  equation: DEFAULT_EQ,

  // Params
  a: 1,
  b: 0,
  c: 0,
  d: 0,
  xScale: 1,
  yScale: 1,

  // Master
  masterVolume: 0.18,
  add7th: false,

  // ADSR
  adsr: { ...DEFAULT_ADSR },

  // Filter
  filter: { ...DEFAULT_FILTER },

  // Effects
  fxParams: withFxDefaults(),
  fxOrder: ["distortion", "chorus", "delay", "reverb"],
  openEffect: null,

  // Actions
  setEquationInput: (v) => set({ equationInput: v }),
  setEquation: (v) => set({ equation: v }),
  setA: (v) => set({ a: v }),
  setB: (v) => set({ b: v }),
  setC: (v) => set({ c: v }),
  setD: (v) => set({ d: v }),
  setXScale: (v) => set({ xScale: v }),
  setYScale: (v) => set({ yScale: v }),
  setMasterVolume: (v) => set({ masterVolume: v }),
  setAdd7th: (v) => set({ add7th: v }),
  setAdsr: (v) => set({ adsr: typeof v === "function" ? v(get().adsr) : v }),
  setFilter: (v) => set({ filter: typeof v === "function" ? v(get().filter) : v }),
  setFxParams: (v) => set({ fxParams: typeof v === "function" ? v(get().fxParams) : v }),
  setFxOrder: (v) => set({ fxOrder: typeof v === "function" ? v(get().fxOrder) : v }),
  setOpenEffect: (v) => set({ openEffect: v }),

  updateFx: (effectId, key, value) => set((s) => ({
    fxParams: {
      ...s.fxParams,
      [effectId]: { ...s.fxParams[effectId], [key]: value },
    },
  })),
}));

export default useSynthStore;

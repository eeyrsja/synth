import { create } from "zustand";

const usePresetStore = create((set, get) => ({
  userPresets: (() => {
    try { return JSON.parse(localStorage.getItem("wavecraft_presets") || "[]"); } catch { return []; }
  })(),
  cloudPresets: [],
  cloudLoading: false,
  newPresetName: "",

  setUserPresets: (v) => set({ userPresets: typeof v === "function" ? v(get().userPresets) : v }),
  setCloudPresets: (v) => set({ cloudPresets: v }),
  setCloudLoading: (v) => set({ cloudLoading: v }),
  setNewPresetName: (v) => set({ newPresetName: v }),

  persistUserPresets: (presets) => {
    set({ userPresets: presets });
    localStorage.setItem("wavecraft_presets", JSON.stringify(presets));
  },
}));

export default usePresetStore;

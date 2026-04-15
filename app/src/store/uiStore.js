import { create } from "zustand";

const useUiStore = create((set) => ({
  page: "synth", // "synth" | "draw" | "drums"

  setPage: (v) => set({ page: v }),
}));

export default useUiStore;

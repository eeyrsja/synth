import { create } from "zustand";

const useMidiStore = create((set) => ({
  midiStatus: "No MIDI connected",

  setMidiStatus: (v) => set({ midiStatus: v }),
}));

export default useMidiStore;

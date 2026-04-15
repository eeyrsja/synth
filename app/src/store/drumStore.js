import { create } from "zustand";

const useDrumStore = create((set) => ({
  drumBpm: 120,
  drumsPlaying: false,
  drumSyncStartAt: 0,
  drumSyncEpoch: 0,

  setDrumBpm: (v) => set({ drumBpm: v }),
  setDrumsPlaying: (v) => set({ drumsPlaying: v }),
  setDrumSyncStartAt: (v) => set({ drumSyncStartAt: v }),
  setDrumSyncEpoch: (v) => set({ drumSyncEpoch: v }),
}));

export default useDrumStore;

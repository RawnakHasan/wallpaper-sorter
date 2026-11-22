import { create } from 'zustand';

type RailState = 'expanded' | 'collapsed';

interface RailStore {
  rail: RailState;
  setRail: (rail: RailState) => void;
  toggleRail: () => void;
}

function readRail(): RailState {
  try {
    return localStorage.getItem('ws-rail') === 'collapsed' ? 'collapsed' : 'expanded';
  } catch {
    return 'expanded';
  }
}

export const useRailStore = create<RailStore>((set, get) => ({
  rail: readRail(),
  setRail: (rail) => {
    try {
      localStorage.setItem('ws-rail', rail);
    } catch {
      // Rail preference is optional.
    }
    set({ rail });
  },
  toggleRail: () => {
    const rail = get().rail === 'expanded' ? 'collapsed' : 'expanded';
    get().setRail(rail);
  },
}));

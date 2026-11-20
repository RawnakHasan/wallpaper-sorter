import { create } from 'zustand';

export interface HotkeyActions {
  assign?: () => void;
  remove?: () => void;
  all?: () => void;
}

interface HotkeysState {
  actions: HotkeyActions;
  setActions: (actions: HotkeyActions) => void;
}

export const useHotkeysStore = create<HotkeysState>((set) => ({
  actions: {},
  setActions: (actions) => set({ actions }),
}));

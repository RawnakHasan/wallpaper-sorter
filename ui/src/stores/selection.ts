import { create } from 'zustand';

interface SelectionState {
  keys: Set<string>;
  last: string | null;
  add: (key: string) => void;
  addMany: (keys: string[]) => void;
  remove: (key: string) => void;
  setLast: (key: string | null) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  keys: new Set(),
  last: null,
  add: (key) => set((state) => ({ keys: new Set(state.keys).add(key) })),
  addMany: (values) => set((state) => ({ keys: new Set([...state.keys, ...values]) })),
  remove: (key) => set((state) => {
    const keys = new Set(state.keys);
    keys.delete(key);
    return { keys };
  }),
  setLast: (last) => set({ last }),
  clear: () => set({ keys: new Set(), last: null }),
}));

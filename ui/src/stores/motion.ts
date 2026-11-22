import { create } from 'zustand';

interface MotionStore {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function readMotion() {
  try {
    const saved = localStorage.getItem('ws-motion');
    if (saved === 'on') return true;
    if (saved === 'off') return false;
  } catch {
    // Motion preference is optional.
  }
  return !prefersReducedMotion();
}

function applyMotion(enabled: boolean) {
  document.documentElement.dataset.motion = enabled ? 'on' : 'off';
}

export const useMotionStore = create<MotionStore>((set) => {
  const enabled = readMotion();
  applyMotion(enabled);
  return {
    enabled,
    setEnabled: (next) => {
      try {
        localStorage.setItem('ws-motion', next ? 'on' : 'off');
      } catch {
        // Motion preference is optional.
      }
      applyMotion(next);
      set({ enabled: next });
    },
  };
});

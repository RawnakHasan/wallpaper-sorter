import { create } from 'zustand';

export interface ToastOptions {
  error?: boolean;
  undo?: () => unknown | Promise<unknown>;
}

export interface ToastMessage {
  id: number;
  message: string;
  error: boolean;
  undo?: ToastOptions['undo'];
}

interface ToastState {
  current: ToastMessage | null;
  show: (message: string, options?: ToastOptions) => void;
  dismiss: () => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let nextId = 0;

export const useToastStore = create<ToastState>((set) => ({
  current: null,
  show: (message, options = {}) => {
    if (timer) clearTimeout(timer);
    set({
      current: {
        id: ++nextId,
        message,
        error: options.error ?? false,
        undo: options.undo,
      },
    });
    timer = setTimeout(() => {
      set({ current: null });
      timer = undefined;
    }, options.undo ? 12000 : 4500);
  },
  dismiss: () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    set({ current: null });
  },
}));

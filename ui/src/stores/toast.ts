import { create } from 'zustand';
import { toast as sonnerToast } from 'sonner';

export interface ToastOptions {
  error?: boolean;
  success?: boolean;
  undo?: () => unknown | Promise<unknown>;
  action?: {
    label: string;
    onClick: () => unknown | Promise<unknown>;
  };
}

interface ToastState {
  show: (message: string, options?: ToastOptions) => void;
  dismiss: () => void;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function runUndo(undo: NonNullable<ToastOptions['undo']>) {
  try {
    await undo();
    sonnerToast.success('Undone');
  } catch (error) {
    sonnerToast.error(messageOf(error));
  }
}

export const useToastStore = create<ToastState>(() => ({
  show: (message, options = {}) => {
    const undo = options.undo;
    const action = undo
      ? { label: 'Undo', onClick: () => { void runUndo(undo); } }
      : options.action
        ? { label: options.action.label, onClick: () => { void options.action?.onClick(); } }
      : undefined;
    const toastOptions = { duration: undo ? 12000 : 4500, action };

    if (options.error) sonnerToast.error(message, toastOptions);
    else if (options.success) sonnerToast.success(message, toastOptions);
    else sonnerToast(message, toastOptions);
  },
  dismiss: () => { sonnerToast.dismiss(); },
}));

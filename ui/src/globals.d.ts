declare global {
  interface Window {
    WS: {
      refresh: () => void;
    };
  }
}

export {};

import { create } from 'zustand';

export type Theme = 'system' | 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem('ws-theme');
    return saved === 'dark' || saved === 'light' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme: Theme) {
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

export const useThemeStore = create<ThemeState>((set) => {
  const theme = readTheme();
  applyTheme(theme);
  return {
    theme,
    setTheme: (nextTheme) => {
      try {
        if (nextTheme === 'dark' || nextTheme === 'light') localStorage.setItem('ws-theme', nextTheme);
        else localStorage.removeItem('ws-theme');
      } catch {
        // Theme preferences are optional in restricted browser contexts.
      }
      applyTheme(nextTheme);
      set({ theme: nextTheme });
    },
  };
});

export const setTheme = (theme: Theme) => useThemeStore.getState().setTheme(theme);

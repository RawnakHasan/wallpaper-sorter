import { create } from 'zustand';

interface RecentFoldersState {
  folders: string[];
  remember: (folder: string) => void;
}

function readFolders(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('ws-recent-folders') || '[]');
    return Array.isArray(saved) && saved.every((item) => typeof item === 'string') ? saved.slice(0, 6) : [];
  } catch {
    return [];
  }
}

export const useRecentFoldersStore = create<RecentFoldersState>((set) => ({
  folders: readFolders(),
  remember: (folder) => {
    set((state) => {
      const folders = [folder, ...state.folders.filter((value) => value !== folder)].slice(0, 6);
      try {
        localStorage.setItem('ws-recent-folders', JSON.stringify(folders));
      } catch {
        // Recent folders are optional in restricted browser contexts.
      }
      return { folders };
    });
  },
}));

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHotkeysStore } from './hotkeys';
import { useRecentFoldersStore } from './recent-folders';
import { useSelectionStore } from './selection';
import { useToastStore } from './toast';
import { useThemeStore } from './theme';

afterEach(() => {
  useToastStore.getState().dismiss();
  useHotkeysStore.getState().setActions({});
  useSelectionStore.getState().clear();
  useThemeStore.getState().setTheme('system');
  useRecentFoldersStore.setState({ folders: [] });
  localStorage.clear();
});

describe('client state stores', () => {
  it('updates and clears selected keys without mutating prior state', () => {
    const selection = useSelectionStore.getState();
    selection.add('/wallpapers/one.jpg');
    expect([...useSelectionStore.getState().keys]).toEqual(['/wallpapers/one.jpg']);
    expect(selection.keys.size).toBe(0);

    useSelectionStore.getState().remove('/wallpapers/one.jpg');
    useSelectionStore.getState().add('/wallpapers/two.jpg');
    useSelectionStore.getState().clear();
    expect(useSelectionStore.getState().keys.size).toBe(0);
    expect(useSelectionStore.getState().last).toBeNull();
  });

  it('persists at most six unique recent folders in most-recent-first order', () => {
    const remember = useRecentFoldersStore.getState().remember;
    for (let index = 0; index < 7; index += 1) remember(`/folder-${index}`);
    remember('/folder-3');

    expect(useRecentFoldersStore.getState().folders).toEqual([
      '/folder-3',
      '/folder-6',
      '/folder-5',
      '/folder-4',
      '/folder-2',
      '/folder-1',
    ]);
    expect(JSON.parse(localStorage.getItem('ws-recent-folders') || '[]')).toEqual(useRecentFoldersStore.getState().folders);
  });

  it('persists and applies the selected theme', () => {
    useThemeStore.getState().setTheme('dark');
    expect(localStorage.getItem('ws-theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    useThemeStore.getState().setTheme('system');
    expect(localStorage.getItem('ws-theme')).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('replaces registered page keyboard actions', () => {
    const assign = () => {};
    useHotkeysStore.getState().setActions({ assign });
    expect(useHotkeysStore.getState().actions.assign).toBe(assign);
    useHotkeysStore.getState().setActions({});
    expect(useHotkeysStore.getState().actions).toEqual({});
  });

  it('keeps undoable toasts visible longer and expires them on schedule', () => {
    vi.useFakeTimers();
    useToastStore.getState().show('Moved', { undo: () => {}, error: true });

    expect(useToastStore.getState().current).toMatchObject({ message: 'Moved', error: true });
    vi.advanceTimersByTime(11999);
    expect(useToastStore.getState().current?.message).toBe('Moved');
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().current).toBeNull();
    vi.useRealTimers();
  });
});

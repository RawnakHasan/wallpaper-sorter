import { useEffect, useLayoutEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Link,
  Outlet,
  useNavigate,
  useRouterState,
  useSearch,
} from '@tanstack/react-router';
import { Icon } from './src/components/Icon';
import { closeLayer, confirmDialog, hasLayer, openSheet } from './src/components/dialogs';
import { getStatus, statusQueryKey } from './src/features/status/api';
import { Toast } from './src/components/Toast';
import { useHotkeysStore } from './src/stores/hotkeys';
import { useRecentFoldersStore } from './src/stores/recent-folders';
import { useSelectionStore } from './src/stores/selection';
import { useToastStore } from './src/stores/toast';
import { setTheme as setStoredTheme } from './src/stores/theme';
import './src/legacy';

const WS = window.WS;
WS.closeLayer = closeLayer;
WS.hasLayer = hasLayer;
WS.openSheet = (title, content, footer, onClose) => openSheet(title, content, footer, WS.icon('close'), onClose);
WS.confirmBox = confirmDialog;
WS.toast = (message, options) => useToastStore.getState().show(message, options);
WS.setTheme = setStoredTheme;
WS.recentFolders = () => useRecentFoldersStore.getState().folders;
WS.rememberFolder = (folder) => useRecentFoldersStore.getState().remember(folder);
WS.clearSelection = () => useSelectionStore.getState().clear();
const selectionKeys = new Proxy(new Set(), {
  get(_target, property) {
    const state = useSelectionStore.getState();
    if (property === 'add') return (key) => { state.add(key); return selectionKeys; };
    if (property === 'delete') return (key) => {
      const existed = state.keys.has(key);
      state.remove(key);
      return existed;
    };
    if (property === 'clear') return () => state.clear();
    const value = Reflect.get(state.keys, property, state.keys);
    return typeof value === 'function' ? value.bind(state.keys) : value;
  },
});
Object.defineProperty(WS, 'selection', {
  configurable: true,
  get() {
    const state = useSelectionStore.getState();
    return {
      keys: selectionKeys,
      get last() {
        return useSelectionStore.getState().last;
      },
      set last(value) {
        useSelectionStore.getState().setLast(value);
      },
    };
  },
});
Object.defineProperty(WS, 'keys', {
  configurable: true,
  get: () => useHotkeysStore.getState().actions,
  set: (actions) => useHotkeysStore.getState().setActions(actions),
});

const NAV = [
  ['/', 'Overview', 'overview'],
  ['/inbox', 'Inbox', 'inbox'],
  ['/library', 'Library', 'library'],
  ['/tags', 'Tags', 'tags'],
  ['/duplicates', 'Duplicates', 'duplicates'],
  ['/data', 'Data', 'data'],
  ['/resort', 'Re-sort', 'resort'],
  ['/activity', 'Activity', 'activity'],
  ['/settings', 'Settings', 'settings'],
];

function NavIcon({ name }) {
  return <Icon name={name} className="nv-icon" />;
}

export function AppShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const routeSearch = useSearch({ strict: false });
  const routeKey = JSON.stringify(routeSearch);
  const navigate = useNavigate();
  const statusQuery = useQuery({
    queryKey: statusQueryKey,
    queryFn: getStatus,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });
  const status = statusQuery.data;
  const online = statusQuery.isPending ? null : !statusQuery.isError;
  const inboxCount = status?.counts.inbox ?? 0;
  const [search, setSearch] = useState('');

  useLayoutEffect(() => {
    WS.closeLayer();
    WS.clearSelection();
    WS.keys = {};
    const main = document.getElementById('main');
    if (main) main.scrollTop = 0;
  }, [pathname, routeKey]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const typing = target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
      if (event.key === 'Escape') {
        if (WS.hasLayer()) WS.closeLayer();
        else if (WS.selection.keys.size) {
          WS.clearSelection();
          WS.refresh();
        }
        return;
      }
      if (typing || event.metaKey || event.altKey) return;
      if (event.ctrlKey) {
        if (event.key.toLowerCase() === 'a' && WS.keys.all) {
          event.preventDefault();
          WS.keys.all();
        }
        return;
      }
      if (event.key === 'a' && WS.keys.assign) {
        event.preventDefault();
        WS.keys.assign();
      } else if (event.key === 'Delete' && WS.keys.remove) {
        event.preventDefault();
        WS.keys.remove();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <header className="topbar">
        <span className="brand">Wallpaper Sorter</span>
        <span className="spacer" />
        <input
          className="input"
          type="search"
          placeholder="Search images"
          aria-label="Search images"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onInput={(event) => setSearch(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') navigate({ to: '/data', search: { q: event.currentTarget.value.trim() || undefined } });
          }}
        />
        <span className="status" role="status">
          <span className={`dot${online ? '' : ' off'}`} />
          <span className="t">{online === true ? 'Watching' : online === false ? 'Not connected' : 'Connecting…'}</span>
        </span>
        <button
          className="btn"
          onClick={async () => {
            try {
              await WS.post('/api/rescan');
              WS.toast('Looking at the folders again');
            } catch (error) {
              WS.toast(error.message, { error: true });
            }
          }}
        >
          Scan now
        </button>
      </header>
      <div className="body">
        <nav className="rail" aria-label="Pages">
          {NAV.map(([path, label, icon]) => (
            <Link
              key={path}
              to={path}
              className={`nv${pathname === path ? ' on' : ''}`}
              aria-current={pathname === path ? 'page' : undefined}
              activeOptions={{ exact: path === '/' }}
            >
              <span className="nv-label"><NavIcon name={icon} /><span>{label}</span></span>
              {path === '/inbox' ? <span className="count" id="inbox-count">{inboxCount > 0 ? inboxCount : ''}</span> : null}
            </Link>
          ))}
        </nav>
        <main className={`main${pathname === '/library' ? ' library-scroll-shell' : ''}`} id="main" tabIndex="-1">
          <Outlet />
        </main>
      </div>
      <Toast />
    </>
  );
}

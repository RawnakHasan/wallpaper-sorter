import { useEffect, useLayoutEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Link,
  Outlet,
  useNavigate,
  useRouterState,
  useSearch,
} from '@tanstack/react-router';
import { Icon, type IconName } from './Icon';
import { closeLayer, hasLayer } from './dialogs';
import { getStatus, requestRescan, statusQueryKey } from '../features/status/api';
import { Toast } from './Toast';
import { useHotkeysStore } from '../stores/hotkeys';
import { useSelectionStore } from '../stores/selection';
import { useToastStore } from '../stores/toast';

const NAV = [
  ['/', 'Overview', 'overview'],
  ['/inbox', 'Inbox', 'inbox'],
  ['/library', 'Library', 'library'],
  ['/search', 'Browse', 'search'],
  ['/tags', 'Tags', 'tags'],
  ['/duplicates', 'Duplicates', 'duplicates'],
  ['/data', 'Data', 'data'],
  ['/resort', 'Re-sort', 'resort'],
  ['/activity', 'Activity', 'activity'],
  ['/settings', 'Settings', 'settings'],
] as const;

function NavIcon({ name }: { name: IconName }) {
  return <Icon name={name} className="nv-icon" />;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
  const showToast = useToastStore((state) => state.show);
  const [search, setSearch] = useState('');

  // Route transitions must reset scroll, selection, and page hotkeys before paint.
  useLayoutEffect(() => {
    closeLayer();
    useSelectionStore.getState().clear();
    useHotkeysStore.getState().setActions({});
    const main = document.getElementById('main');
    if (main) main.scrollTop = 0;
  }, [pathname, routeKey]);

  // Global Escape and shortcut handling belongs outside page components so dialogs and selection share one layer.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
      if (event.key === 'Escape') {
        if (hasLayer()) closeLayer();
        else if (useSelectionStore.getState().keys.size) {
          useSelectionStore.getState().clear();
        }
        return;
      }
      if (typing || event.metaKey || event.altKey) return;
      if (event.ctrlKey) {
        const actions = useHotkeysStore.getState().actions;
        if (event.key.toLowerCase() === 'a' && actions.all) {
          event.preventDefault();
          actions.all();
        }
        return;
      }
      const actions = useHotkeysStore.getState().actions;
      if (event.key === 'a' && actions.assign) {
        event.preventDefault();
        actions.assign();
      } else if (event.key === 'Delete' && actions.remove) {
        event.preventDefault();
        actions.remove();
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
              await requestRescan();
              showToast('Looking at the folders again');
            } catch (error) {
              showToast(messageOf(error), { error: true });
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
        <main className={`main${pathname === '/library' ? ' library-scroll-shell' : ''}`} id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <Toast />
    </>
  );
}

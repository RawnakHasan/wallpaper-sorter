import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useQuery } from '@tanstack/react-query';
import {
  Link,
  Outlet,
  useNavigate,
  useRouterState,
  useSearch,
} from '@tanstack/react-router';
import { Icon } from './Icon';
import { TooltipControl } from './ui/Tooltip';
import { OverlayScrollbar } from './OverlayScrollbar';
import { closeLayer, hasLayer } from './dialogs';
import { getStatus, requestRescan, statusQueryKey } from '../features/status/api';
import { Toast } from './Toast';
import { useHotkeysStore } from '../stores/hotkeys';
import { useSelectionStore } from '../stores/selection';
import { useToastStore } from '../stores/toast';
import { useThemeStore } from '../stores/theme';
import { useRailStore } from '../stores/rail';
import { useMotionStore } from '../stores/motion';

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
  ['/git', 'Git', 'git'],
  ['/settings', 'Settings', 'settings'],
] as const;

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
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const rail = useRailStore((state) => state.rail);
  const toggleRail = useRailStore((state) => state.toggleRail);
  const motionEnabled = useMotionStore((state) => state.enabled);
  const railRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const shortcutRef = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState('');

  useLayoutEffect(() => {
    document.documentElement.dataset.rail = rail === 'collapsed' ? 'collapsed' : 'expanded';
  }, [rail]);

  // Route transitions must reset scroll, selection, and page hotkeys before paint.
  useLayoutEffect(() => {
    closeLayer();
    useSelectionStore.getState().clear();
    useHotkeysStore.getState().setActions({});
    const main = document.getElementById('main');
    if (main) main.scrollTop = 0;
  }, [pathname, routeKey]);

  useLayoutEffect(() => {
    const railElement = railRef.current;
    const indicator = indicatorRef.current;
    if (!railElement || !indicator) return;
    const active = railElement.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active) return;
    const y = active.offsetTop + (active.offsetHeight - 22) / 2;
    if (motionEnabled) {
      gsap.to(indicator, { y, duration: 0.45, ease: 'power3.inOut' });
    } else {
      gsap.set(indicator, { y });
    }
    if (window.matchMedia('(max-width: 860px)').matches) {
      railElement.scrollTo({
        left: Math.max(0, active.offsetLeft - 16),
        behavior: motionEnabled ? 'smooth' : 'auto',
      });
    }
  }, [pathname, rail, motionEnabled]);

  useLayoutEffect(() => {
    if (!motionEnabled) return;
    const main = document.getElementById('main');
    if (!main) return;
    const blocks = Array.from(main.querySelectorAll<HTMLElement>(
      '.page-head,.panel,.stats,.stat,.card,.tagrow,.watched-entry',
    ));
    if (!blocks.length) return;
    gsap.fromTo(blocks, { opacity: 0, y: 14 }, {
      opacity: 1,
      y: 0,
      duration: 0.45,
      stagger: { amount: 0.28 },
      ease: 'power3.out',
      clearProps: 'transform,opacity',
    });
  }, [pathname, motionEnabled]);

  // Global Escape and shortcut handling belongs outside page components so dialogs and selection share one layer.
  useEffect(() => {
    let chord: 'g' | null = null;
    let chordTimer: number | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
      if (event.key === '/' && !typing) {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('[aria-label="Search images"]')?.focus();
        return;
      }
      if (event.key === '?' && !typing) {
        event.preventDefault();
        if (typeof shortcutRef.current?.showModal === 'function') {
          shortcutRef.current.showModal();
        } else {
          shortcutRef.current?.setAttribute('open', '');
        }
        return;
      }
      if (event.key === 'Escape') {
        if (hasLayer()) closeLayer();
        else if (useSelectionStore.getState().keys.size) {
          useSelectionStore.getState().clear();
        }
        return;
      }
      if (typing || event.metaKey || event.altKey) return;
      if (chord) {
        chord = null;
        if (chordTimer !== null) window.clearTimeout(chordTimer);
        const routes: Record<string, string> = {
          o: '/', i: '/inbox', l: '/library', b: '/search', t: '/tags',
          u: '/duplicates', d: '/data', r: '/resort', a: '/activity',
          c: '/git', s: '/settings',
        };
        const route = routes[event.key.toLowerCase()];
        if (route) {
          event.preventDefault();
          navigate({ to: route });
        }
        return;
      }
      if (event.key.toLowerCase() === 'g') {
        chord = 'g';
        chordTimer = window.setTimeout(() => { chord = null; }, 1200);
        return;
      }
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
  }, [navigate]);

  return (
    <div className="ws-app">
      <header className="top">
        <span className="brand">Wallpaper Sorter</span>
        <span className="spacer" />
        <input
          className="search"
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
        <span className="conn" role="status">
          <span className={`dot${online ? '' : ' off'}`} />
          <span>{online === true ? 'Watching' : online === false ? 'Not connected' : 'Connecting…'}</span>
        </span>
        <button
          className="button"
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
        <div className="theme-switch" role="group" aria-label="Theme">
          {([
            ['system', 'monitor'],
            ['light', 'sun'],
            ['dark', 'moon'],
          ] as const).map(([value, icon]) => (
            <button
              key={value}
              type="button"
              className="theme-button"
              aria-label={`${value[0].toUpperCase()}${value.slice(1)} theme`}
              aria-pressed={theme === value}
              onClick={() => setTheme(value)}
              title={`${value[0].toUpperCase()}${value.slice(1)} theme`}
            >
              <Icon name={icon} />
            </button>
          ))}
        </div>
        <button
          className="button icon-button shortcuts-button"
          type="button"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          onClick={() => shortcutRef.current?.showModal()}
        >
          <Icon name="help" />
        </button>
      </header>
      <div className="body">
        <nav className="rail" aria-label="Pages" ref={railRef}>
          <span className="rail-indicator" ref={indicatorRef} aria-hidden="true" />
          {NAV.map(([path, label, icon]) => (
            <TooltipControl key={path} label={label}>
              <Link
                to={path}
                className="rail-link"
                aria-current={pathname === path ? 'page' : undefined}
                activeOptions={{ exact: path === '/' }}
                title={rail === 'collapsed' ? label : undefined}
              >
                <Icon name={icon} className="rail-icon" />
                <span className="rail-label">{label}</span>
                {path === '/inbox' && inboxCount > 0 ? (
                  <span className="rail-badge" id="inbox-count">{inboxCount}</span>
                ) : null}
              </Link>
            </TooltipControl>
          ))}
          <span className="rail-spacer" />
          <button
            className="rail-collapse"
            type="button"
            aria-expanded={rail === 'expanded'}
            onClick={toggleRail}
          >
            <Icon name={rail === 'expanded' ? 'panelClose' : 'panelOpen'} className="rail-icon" />
            <span className="rail-label">{rail === 'expanded' ? 'Collapse' : 'Expand'}</span>
          </button>
        </nav>
        <main className={`main${pathname === '/library' ? ' library-scroll-shell' : ''}`} id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <Toast />
      <OverlayScrollbar />
      <dialog className="shortcuts-dialog" ref={shortcutRef} aria-labelledby="shortcuts-title">
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <div className="shortcut-grid">
          <span><kbd>/</kbd></span><span>Search images</span>
          <span><kbd>G</kbd> <kbd>O</kbd></span><span>Overview</span>
          <span><kbd>G</kbd> <kbd>I</kbd></span><span>Inbox</span>
          <span><kbd>G</kbd> <kbd>L</kbd></span><span>Library</span>
          <span><kbd>G</kbd> <kbd>B</kbd></span><span>Browse</span>
          <span><kbd>G</kbd> <kbd>T</kbd></span><span>Tags</span>
          <span><kbd>G</kbd> <kbd>U</kbd></span><span>Duplicates</span>
          <span><kbd>G</kbd> <kbd>D</kbd></span><span>Data</span>
          <span><kbd>G</kbd> <kbd>R</kbd></span><span>Re-sort</span>
          <span><kbd>G</kbd> <kbd>A</kbd></span><span>Activity</span>
          <span><kbd>G</kbd> <kbd>C</kbd></span><span>Git</span>
          <span><kbd>G</kbd> <kbd>S</kbd></span><span>Settings</span>
          <span><kbd>Esc</kbd></span><span>Close or clear selection</span>
          <span><kbd>?</kbd></span><span>Show this list</span>
        </div>
        <div className="dialog-actions">
          <button className="button button-primary" type="button" onClick={() => shortcutRef.current?.close()}>
            Done
          </button>
        </div>
      </dialog>
    </div>
  );
}

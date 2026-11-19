import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useNavigate,
  useRouterState,
  useSearch,
} from '@tanstack/react-router';
import './legacy.js';
import '../app.css';

const WS = window.WS;
const RefreshContext = createContext({ revision: 0, ready: false, focusRef: null, scrollRef: null, refresh: () => {} });

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

const ICONS = {
  overview: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  inbox: ['M12 3v11m0 0 4-4m-4 4-4-4M4 14v6h16v-6'],
  library: ['M3 6h7l2 2h9v12H3z'],
  tags: ['M4 4h9l7 7-9 9-7-7z', 'M8 8h.01'],
  duplicates: ['M7 7h11v11H7zM3 3h11v4M3 3v11h4'],
  data: ['M4 5c0-2 16-2 16 0v14c0 2-16 2-16 0zm0 0c0 2 16 2 16 0M4 12c0 2 16 2 16 0'],
  resort: ['M4 7h11l-3-3m3 3-3 3M20 17H9l3 3m-3-3 3-3'],
  activity: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2'],
  settings: ['M4 7h16M4 12h16M4 17h16M8 5v4M16 10v4M11 15v4'],
};

function applyTheme() {
  let theme = null;
  try {
    theme = localStorage.getItem('ws-theme');
  } catch {
    // Theme persistence is optional in restricted browser contexts.
  }
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

WS.setTheme = (value) => {
  try {
    if (value === 'dark' || value === 'light') localStorage.setItem('ws-theme', value);
    else localStorage.removeItem('ws-theme');
  } catch {
    // Theme persistence is optional in restricted browser contexts.
  }
  applyTheme();
};
applyTheme();

function NavIcon({ name }) {
  return (
    <svg className="nv-icon" viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[name].map((d) => <path d={d} key={d} />)}
    </svg>
  );
}

function LegacyPage({ name }) {
  const ref = useRef(null);
  const search = useSearch({ strict: false });
  const query = JSON.stringify(search);
  const { revision, ready, focusRef, scrollRef, refresh } = useContext(RefreshContext);

  useEffect(() => {
    let disposed = false;
    WS.keys = {};
    if (!ready) return undefined;
    const render = async () => {
      try {
        const node = await WS.pages[name](new URLSearchParams(JSON.parse(query)));
        if (!disposed && ref.current) ref.current.replaceChildren(node);
      } catch (error) {
        if (!disposed && ref.current) ref.current.replaceChildren(WS.errorBox(error, refresh));
      }
      if (!disposed && scrollRef.current) {
        const grid = ref.current?.querySelector('.grid-scroll');
        const tree = ref.current?.querySelector('.tree');
        if (grid) grid.scrollTop = scrollRef.current.gridTop;
        if (tree) tree.scrollTop = scrollRef.current.treeTop;
        scrollRef.current = null;
      }
      if (!disposed && focusRef.current) {
        const focus = focusRef.current;
        focusRef.current = null;
        const element = document.getElementById(focus.id);
        if (element) {
          element.focus();
          try {
            if (focus.start !== null && focus.start !== undefined) element.setSelectionRange(focus.start, focus.end);
          } catch {
            // The focused control is not a text field.
          }
        }
      }
    };
    render();
    return () => { disposed = true; };
  }, [name, query, ready, revision, focusRef, scrollRef, refresh]);

  return <div className="page-host" ref={ref}>{ready ? null : <p className="muted">Loading…</p>}</div>;
}

function AppShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const routeSearch = useSearch({ strict: false });
  const routeKey = JSON.stringify(routeSearch);
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [online, setOnline] = useState(null);
  const [inboxCount, setInboxCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const focusRef = useRef(null);
  const scrollRef = useRef(null);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const context = useMemo(() => ({ revision, ready, focusRef, scrollRef, refresh }), [revision, ready, refresh]);

  useLayoutEffect(() => {
    WS.closeLayer();
    WS.clearSelection();
    WS.keys = {};
    scrollRef.current = null;
    const main = document.getElementById('main');
    if (main) main.scrollTop = 0;
  }, [pathname, routeKey]);

  useEffect(() => {
    WS.refresh = () => {
      const main = document.getElementById('main');
      const element = document.activeElement;
      const grid = main?.querySelector('.grid-scroll');
      const tree = main?.querySelector('.tree');
      scrollRef.current = grid || tree ? { gridTop: grid?.scrollTop || 0, treeTop: tree?.scrollTop || 0 } : null;
      if (main && element?.id && main.contains(element)) {
        focusRef.current = { id: element.id, start: element.selectionStart, end: element.selectionEnd };
      }
      refresh();
    };
    WS.onOnline(setOnline);
    WS.keys = {};
    let signature = '';
    let initialized = false;

    const poll = async () => {
      try {
        const status = await WS.get('/api/status');
        WS.status = status;
        setInboxCount(status.counts.inbox);
        const nextSignature = JSON.stringify([status.counts, status.activity_last_id]);
        const element = document.activeElement;
        const typing = element && ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName);
        if (signature && nextSignature !== signature && !WS.hasLayer() && !typing) WS.refresh();
        signature = nextSignature;
      } catch {
        // The connection chip reflects API availability.
      } finally {
        if (!initialized) {
          initialized = true;
          setReady(true);
        }
      }
    };
    poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      window.clearInterval(timer);
      WS.refresh = () => {};
      WS.onOnline(() => {});
    };
  }, []);

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
    <RefreshContext.Provider value={context}>
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
      <div id="toast" hidden role="status" aria-live="polite" />
    </RefreshContext.Provider>
  );
}

function OverviewPage() {
  const { revision, refresh } = useContext(RefreshContext);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let disposed = false;
    Promise.all([WS.get('/api/status'), WS.get('/api/activity?limit=8')])
      .then(([status, activity]) => {
        if (!disposed) {
          setData({ status, activity });
          setError(null);
        }
      })
      .catch((cause) => {
        if (!disposed) setError(cause);
      });
    return () => { disposed = true; };
  }, [revision]);

  if (error) {
    return <div className="page"><p className="error" role="alert">{error.message}</p><button className="btn" onClick={refresh}>Try again</button></div>;
  }
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;

  const { status, activity } = data;
  const compactPath = (path) => path.startsWith(status.library + '/') ? path.slice(status.library.length + 1) : WS.basename(path);
  const eventLabel = (event) => {
    if (event.kind === 'undo') return 'Undone';
    if (event.kind === 'rename') return 'Renamed';
    if (event.kind === 'duplicate') return 'Sent to Duplicates';
    if ((event.note || '').startsWith('Deleted')) return 'Deleted';
    if ((event.note || '').startsWith('Assigned')) return 'Assigned';
    return 'Sorted';
  };
  const undo = async (id) => {
    try {
      await WS.post('/api/undo', { id });
      WS.toast('Undone');
      refresh();
    } catch (cause) {
      WS.toast(cause.message, { error: true });
    }
  };
  const watchedEntry = (path, badges, message) => (
    <div className="watched-entry" key={path}>
      <span className="m watched-path">{path}</span>
      <span className="watched-badges">
        {badges.map(([label, tone]) => <span className={`badge${tone ? ` ${tone}` : ''}`} key={label}>{label}</span>)}
      </span>
      {message ? <p className="error">{message}</p> : null}
    </div>
  );

  return (
    <div className="page">
      <div className="page-head">
        <h1>Overview</h1>
        <span className="sub">{status.counts.library_images} images in {status.library}</span>
        <span className="spacer" />
        <Link className="btn" to="/resort">Re-sort library</Link>
      </div>
      <div className="stats">
        <Link className="stat" to="/inbox"><div className="n">{status.counts.inbox}</div><div className="l">waiting in the Inbox</div></Link>
        <Link className="stat" to="/library"><div className="n">{status.counts.library_images}</div><div className="l">images in the library</div></Link>
        <Link className="stat" to="/duplicates"><div className="n">{status.counts.duplicates}</div><div className="l">in Duplicates</div></Link>
        <Link className="stat" to="/data"><div className="n">{status.counts.records}</div><div className="l">records of where images came from</div></Link>
      </div>
      <h3>Recent activity</h3>
      {activity.length ? (
        <div className="batch">
          {activity.map((event) => (
            <div className="act" key={event.id}>
              <span className="t m">{WS.fmtTime(event.time)}</span>
              <span className="k">{eventLabel(event)}</span>
              <span className="m grow" title={`${event.from} → ${event.to}`}>{compactPath(event.from)} → {compactPath(event.to)}</span>
              {event.undone ? <span className="badge">undone</span> : event.undoable ? <button className="btn small" onClick={() => undo(event.id)}>Undo</button> : null}
            </div>
          ))}
        </div>
      ) : <div className="empty"><b>Nothing yet</b>Sorted images show up here, with an Undo button.</div>}
      <h3>Watched folders</h3>
      <div className="panel watched-folders">
        <div className="watched-list">
          {watchedEntry(status.library, [['library, top level', 'good']])}
          {status.intake.map((intake) => watchedEntry(intake.path, [
            [intake.watching ? 'watching' : intake.exists ? 'not watching' : 'folder not found yet', intake.watching ? 'good' : 'warn'],
            ...(intake.recursive ? [['includes subfolders', '']] : []),
          ], intake.error))}
        </div>
      </div>
      {!status.setup_complete ? (
        <div className="panel welcome">
          <h3>Welcome to Wallpaper Sorter</h3>
          <p className="muted">Library: {status.library}</p>
          <button
            className="btn primary"
            onClick={async () => {
              try {
                await WS.api('PUT', '/api/settings', { setup_complete: true });
                WS.toast('Setup complete');
                refresh();
              } catch (cause) {
                WS.toast(cause.message, { error: true });
              }
            }}
          >
            Finish setup
          </button>
        </div>
      ) : null}
    </div>
  );
}

const rootRoute = createRootRoute({ component: AppShell });
const routes = NAV.map(([path, , name]) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    validateSearch: (search) => search,
    component: () => name === 'overview' ? <OverviewPage /> : <LegacyPage name={name} />,
  })
);
const router = createRouter({
  routeTree: rootRoute.addChildren(routes),
  history: createHashHistory(),
  scrollRestoration: false,
});

const appRoot = createRoot(document.getElementById('app'));
appRoot.render(<RouterProvider router={router} />);
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) appRoot.unmount();
}, { once: true });

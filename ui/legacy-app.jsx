import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Link,
  Outlet,
  useNavigate,
  useRouterState,
  useSearch,
} from '@tanstack/react-router';
import { Icon } from './src/components/Icon';
import { Thumb } from './src/components/Thumb';
import { closeLayer, confirmDialog, hasLayer, openSheet } from './src/components/dialogs';
import { getStatus, statusQueryKey } from './src/features/status/api';
import { Toast } from './src/components/Toast';
import { useHotkeysStore } from './src/stores/hotkeys';
import { useRecentFoldersStore } from './src/stores/recent-folders';
import { useSelectionStore } from './src/stores/selection';
import { useToastStore } from './src/stores/toast';
import { setTheme as setStoredTheme, useThemeStore } from './src/stores/theme';
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

function NavIcon({ name }) {
  return <Icon name={name} className="nv-icon" />;
}
export function LegacyPage({ name }) {
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
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const focusRef = useRef(null);
  const scrollRef = useRef(null);
  const signature = useRef('');

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
    WS.keys = {};
    return () => {
      WS.refresh = () => {};
    };
  }, [focusRef, refresh, scrollRef]);

  useEffect(() => {
    if (statusQuery.isFetched) setReady(true);
  }, [statusQuery.isFetched]);

  useEffect(() => {
    if (!status) return;
    WS.status = status;
    const nextSignature = JSON.stringify([status.counts, status.activity_last_id]);
    const element = document.activeElement;
    const typing = element && ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName);
    if (signature.current && nextSignature !== signature.current && !WS.hasLayer() && !typing) WS.refresh();
    signature.current = nextSignature;
  }, [status]);

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
      <Toast />
    </RefreshContext.Provider>
  );
}

function activityLabel(event) {
  if (event.kind === 'undo') return 'Undone';
  if (event.kind === 'rename') return 'Renamed';
  if (event.kind === 'duplicate') return 'Sent to Duplicates';
  if ((event.note || '').startsWith('Deleted')) return 'Deleted';
  if ((event.note || '').startsWith('Assigned')) return 'Assigned';
  return 'Sorted';
}

function activityPath(path, root) {
  return path.startsWith(root + '/') ? path.slice(root.length + 1) : WS.basename(path);
}

async function undoActivity(id, refresh) {
  try {
    await WS.post('/api/undo', { id });
    WS.toast('Undone');
    refresh();
  } catch (error) {
    WS.toast(error.message, { error: true });
  }
}

async function undoActivityBatch(batch, refresh) {
  try {
    await WS.undoBatch(batch);
    WS.toast('Undone');
    refresh();
  } catch (error) {
    WS.toast(error.message, { error: true });
  }
}

function ActivityRow({ event, root, refresh }) {
  return (
    <div className="act" key={event.id}>
      <span className="t m">{WS.fmtTime(event.time)}</span>
      <span className="k">{activityLabel(event)}</span>
      <span className="m grow" title={`${event.from} → ${event.to}`}>{activityPath(event.from, root)} → {activityPath(event.to, root)}</span>
      {event.undone ? <span className="badge">undone</span> : event.undoable ? <button className="btn small" onClick={() => undoActivity(event.id, refresh)}>Undo</button> : null}
    </div>
  );
}

export function ActivityPage() {
  const { revision, refresh } = useContext(RefreshContext);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let disposed = false;
    Promise.all([WS.get('/api/activity?limit=300'), WS.get('/api/status')])
      .then(([items, status]) => {
        if (!disposed) {
          setData({ items, status });
          setError(null);
        }
      })
      .catch((cause) => {
        if (!disposed) setError(cause);
      });
    return () => { disposed = true; };
  }, [revision]);

  if (error) return <div className="page"><p className="error" role="alert">{error.message}</p><button className="btn" onClick={refresh}>Try again</button></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;

  const days = [];
  for (let i = 0; i < data.items.length;) {
    const date = WS.fmtDay(data.items[i].time);
    const day = days[days.length - 1];
    if (!day || day.date !== date) days.push({ date, batches: [] });
    let end = i + 1;
    while (end < data.items.length && data.items[end].batch === data.items[i].batch && WS.fmtDay(data.items[end].time) === date) end++;
    days[days.length - 1].batches.push(data.items.slice(i, end));
    i = end;
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Activity</h1>
        {data.items.length ? <span className="sub">Everything the sorter did, newest first</span> : null}
      </div>
      {data.items.length ? (
        <>
          {days.map((day) => (
            <React.Fragment key={day.date}>
              <div className="day">{day.date}</div>
              {day.batches.map((batch) => {
                const undoable = batch.some((event) => event.undoable);
                const batchKey = batch[0].batch || batch[0].id;
                return (
                  <div className="batch" key={batchKey}>
                    {batch.length > 1 || undoable ? (
                      <div className="batch-head">
                        <span>{WS.plural(batch.length, 'action')}</span>
                        <span className="spacer" />
                        {undoable && batch.length > 1 ? <button className="btn small" onClick={() => undoActivityBatch(batch[0].batch, refresh)}>Undo all</button> : null}
                      </div>
                    ) : null}
                    {batch.map((event) => <ActivityRow event={event} root={data.status.library} refresh={refresh} key={event.id} />)}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
          <p className="faint">The log keeps recent entries. Where each image came from is kept for good, on the Data page.</p>
        </>
      ) : <div className="empty"><b>Nothing yet</b>Every move and rename is listed here and can be undone.</div>}
    </div>
  );
}

function LegacyThumb({ hash }) {
  return <span className="list-thumb"><Thumb hash={hash} /></span>;
}

export function DuplicatesPage() {
  const { revision, refresh } = useContext(RefreshContext);
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const { deleteFiles, dupFolder } = WS.ui;

  useEffect(() => {
    let disposed = false;
    WS.get('/api/duplicates')
      .then((result) => {
        if (!disposed) {
          setItems(result);
          setError(null);
        }
      })
      .catch((cause) => {
        if (!disposed) setError(cause);
      });
    return () => { disposed = true; };
  }, [revision]);

  const restore = async (item) => {
    const folders = (await WS.get('/api/folders')).filter((folder) =>
      folder.path !== dupFolder() && !folder.path.startsWith(dupFolder() + '/')
    );
    const picker = WS.folderPicker({ folders });
    const go = WS.h('button', { class: 'btn primary', text: 'Restore as new image' });
    const problem = WS.h('div', { class: 'error', role: 'alert' });
    go.onclick = async () => {
      const folder = picker.get();
      if (!folder) {
        problem.textContent = 'Choose a folder.';
        return;
      }
      go.disabled = true;
      try {
        const result = await WS.post('/api/duplicates/restore', { paths: [item.path], folder });
        WS.closeLayer();
        WS.toast(`Restored ${WS.plural(result.done.length, 'copy', 'copies')} as new images`, { undo: () => WS.undoBatch(result.batch) });
        WS.refresh();
      } catch (cause) {
        problem.textContent = cause.message;
        go.disabled = false;
      }
    };
    WS.openSheet('Restore duplicate', WS.h('div', {},
      WS.h('p', { class: 'muted', text: item.name }),
      WS.h('div', { class: 'field' }, WS.h('span', { class: 'lbl', text: 'Folder' }), picker.el),
      problem
    ), [WS.h('button', { class: 'btn', text: 'Cancel', onclick: WS.closeLayer }), go]);
  };

  if (error) return <div className="page"><p className="error" role="alert">{error.message}</p><button className="btn" onClick={refresh}>Try again</button></div>;
  if (!items) return <div className="page"><p className="muted">Loading…</p></div>;

  const total = items.reduce((sum, item) => sum + item.size, 0);
  const emptyFolder = async () => {
    if (!(await WS.confirmBox(`Move all ${items.length} copies (${WS.fmtBytes(total)}) to the trash? You can undo this.`, 'Move to trash', true))) return;
    try {
      const result = await WS.post('/api/duplicates/empty');
      WS.toast(`Moved ${WS.plural(result.done.length, 'copy', 'copies')} to the trash`, { undo: () => WS.undoBatch(result.batch) });
      refresh();
    } catch (cause) {
      WS.toast(cause.message, { error: true });
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Duplicates</h1>
        {items.length ? <span className="sub">{WS.plural(items.length, 'copy', 'copies')}, {WS.fmtBytes(total)}</span> : null}
        <span className="spacer" />
        {items.length ? <button className="btn danger" onClick={emptyFolder}>Empty {dupFolder()} folder</button> : null}
      </div>
      {items.length ? (
        <div className="list">
          {items.map((item) => {
            const relative = item.duplicate_of && !item.duplicate_of.startsWith('/');
            return (
              <div key={item.path}>
                <LegacyThumb hash={item.hash} />
                <div className="grow">
                  <div className="m">{item.name}</div>
                  <div className="muted">
                    Same as{' '}
                    {relative ? (
                      <Link
                        to="/library"
                        search={{ folder: WS.dirname(item.duplicate_of) }}
                        className="m"
                      >
                        {item.duplicate_of}
                      </Link>
                    ) : <span className="m">{item.duplicate_of || 'an image in the library'}</span>}
                    {' · '}{WS.fmtBytes(item.size)}
                  </div>
                </div>
                <div className="row actions">
                  <button className="btn small" onClick={() => restore(item)}>Restore…</button>
                  <button className="btn small danger" onClick={() => deleteFiles([item.path], item.name)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : <div className="empty"><b>No duplicates</b>Copies of images you already have are moved here instead of being sorted twice.</div>}
    </div>
  );
}

const GAP_TEXT = {
  keep: 'Keep gaps. The next number is the highest plus one. Nothing is renamed.',
  lowest: 'The next image takes the lowest free number. Nothing is renamed.',
  last: 'The last images are renamed into the gaps whenever an image arrives.',
  renumber: 'Everything is renumbered without gaps whenever an image arrives.',
};

export function SettingsPage() {
  const { revision, refresh } = useContext(RefreshContext);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [gapMode, setGapMode] = useState(null);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  useEffect(() => {
    let disposed = false;
    WS.get('/api/status')
      .then((status) => {
        if (!disposed) {
          setData(status);
          setError(null);
        }
      })
      .catch((cause) => {
        if (!disposed) setError(cause);
      });
    return () => { disposed = true; };
  }, [revision]);

  const openIntakeSheet = (intake) => {
    const path = WS.h('input', { class: 'input wide', value: intake ? intake.path : '', 'aria-label': 'Intake folder path', placeholder: '/absolute/path/to/downloads' });
    const recursive = WS.h('input', { type: 'checkbox', id: 'intake-recursive' });
    recursive.checked = intake ? intake.recursive : true;
    const removeEmpty = WS.h('input', { type: 'checkbox', id: 'intake-remove-empty' });
    removeEmpty.checked = !!(intake && intake.remove_empty_folders);
    const problem = WS.h('div', { class: 'error', role: 'alert' });
    const save = WS.h('button', { class: 'btn primary', text: 'Save' });
    save.addEventListener('click', async () => {
      problem.textContent = '';
      save.disabled = true;
      try {
        await WS.api(intake ? 'PUT' : 'POST', intake ? `/api/intake/${intake.index}` : '/api/intake', {
          path: path.value,
          recursive: recursive.checked,
          remove_empty_folders: removeEmpty.checked,
        });
        WS.closeLayer();
        WS.toast(intake ? 'Intake folder updated' : 'Intake folder added');
        refresh();
      } catch (cause) {
        problem.textContent = cause.message;
        save.disabled = false;
      }
    });
    WS.openSheet(intake ? 'Edit intake folder' : 'Add intake folder', WS.h('div', {},
      WS.h('div', { class: 'field' }, WS.h('label', { text: 'Folder path' }), path),
      WS.h('div', { class: 'field' }, WS.h('div', { class: 'check-row' }, recursive, WS.h('label', { for: 'intake-recursive', text: 'Include subfolders' }))),
      WS.h('div', { class: 'field' }, WS.h('div', { class: 'check-row' }, removeEmpty, WS.h('label', { for: 'intake-remove-empty', text: 'Remove empty subfolders' })), WS.h('span', { class: 'faint', text: 'Off by default. Hidden folders are never removed.' })),
      problem
    ), [WS.h('button', { class: 'btn', text: 'Cancel', onclick: WS.closeLayer }), save]);
  };

  const removeIntake = async (intake) => {
    if (!(await WS.confirmBox(`Stop watching ${intake.path}?`, 'Remove', true))) return;
    try {
      await WS.api('DELETE', `/api/intake/${intake.index}`);
      WS.toast('Intake folder removed');
      refresh();
    } catch (cause) {
      WS.toast(cause.message, { error: true });
    }
  };

  const emptyTrash = async () => {
    if (!(await WS.confirmBox('Permanently remove everything in the trash? This cannot be undone.', 'Remove for good', true))) return;
    try {
      const result = await WS.post('/api/trash/empty');
      WS.toast(`Removed ${WS.plural(result.removed, 'file')}`);
    } catch (cause) {
      WS.toast(cause.message, { error: true });
    }
  };

  if (error) return <div className="page"><p className="error" role="alert">{error.message}</p><button className="btn" onClick={refresh}>Try again</button></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;

  const selectedGap = gapMode || data.settings.gap_mode;
  const watchedEntry = (intake) => (
    <div className="watched-entry" key={intake.path}>
      <span className="m watched-path">{intake.path}</span>
      <span className="watched-badges">
        {intake.library ? <span className="badge good">library, top level</span> : <span className={`badge ${intake.watching ? 'good' : 'warn'}`}>{intake.watching ? 'watching' : intake.exists ? 'not watching' : 'folder not found yet'}</span>}
        {!intake.library && intake.recursive ? <span className="badge">includes subfolders</span> : null}
        {!intake.library && intake.remove_empty_folders ? <span className="badge warn">removes empty folders</span> : null}
      </span>
      {!intake.library ? (
        <span className="watched-actions">
          <button className="btn small" onClick={() => openIntakeSheet(intake)}>Edit</button>
          <button className="btn small danger" onClick={() => removeIntake(intake)}>Remove</button>
        </span>
      ) : null}
      {intake.error ? <p className="error watched-error">{intake.error}</p> : null}
    </div>
  );

  return (
    <div className="page">
      <div className="page-head"><h1>Settings</h1><span className="sub">version {data.version}</span></div>
      <div className="panel">
        <h2>Numbering</h2>
        <div className="field">
          <label htmlFor="settings-gap-mode">Gaps in the numbering</label>
          <select
            id="settings-gap-mode"
            className="select"
            aria-label="Gaps in the numbering"
            value={selectedGap}
            onChange={async (event) => {
              const mode = event.target.value;
              setGapMode(mode);
              try {
                await WS.api('PUT', '/api/settings', { gap_mode: mode });
                setData((current) => ({ ...current, settings: { ...current.settings, gap_mode: mode } }));
                WS.toast('Saved');
              } catch (cause) {
                setGapMode(data.settings.gap_mode);
                WS.toast(cause.message, { error: true });
              }
            }}
          >
            <option value="keep">Keep gaps</option>
            <option value="lowest">Fill with the next image</option>
            <option value="last">Move the last image into the gap</option>
            <option value="renumber">Renumber everything</option>
          </select>
          <div className="muted">{GAP_TEXT[selectedGap]}</div>
        </div>
      </div>
      <div className="panel watched-folders">
        <h2>Watched folders</h2>
        <div className="watched-list">
          {watchedEntry({ library: true, path: data.library })}
          {data.intake.map((intake) => watchedEntry(intake))}
        </div>
        <div className="watched-footer"><button className="btn small" onClick={() => openIntakeSheet(null)}>Add folder</button></div>
      </div>
      <div className="panel">
        <h2>Images</h2>
        <div className="row">{data.settings.image_extensions.map((extension) => <span className="tagchip" key={extension}>{extension}</span>)}</div>
        <p className="faint">Copies of images you already have go to the “{data.settings.duplicates_folder}” folder.</p>
      </div>
      <div className="panel">
        <h2>Appearance</h2>
        <div className="seg" role="group" aria-label="Theme">
          {['system', 'dark', 'light'].map((value) => (
            <button key={value} className={theme === value ? 'on' : ''} onClick={() => setTheme(value)}>
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="panel">
        <h2>Trash</h2>
        <p className="muted">Deleted images wait in a hidden folder inside the library until you empty it.</p>
        <button className="btn danger" onClick={emptyTrash}>Empty trash</button>
      </div>
      <div className="panel">
        <h2>This page</h2>
        <p className="muted">Served from <span className="m">{location.host}</span> on this computer only.</p>
      </div>
    </div>
  );
}

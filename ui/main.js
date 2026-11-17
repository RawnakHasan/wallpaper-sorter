'use strict';
// The shell: navigation, routing, status polling, theme, keyboard shortcuts.
(function () {
  const WS = window.WS;
  const h = WS.h;
  const NAV = [
    ['/', 'Overview', 'overview'],
    ['/inbox', 'Inbox', 'inbox'],
    ['/library', 'Library', 'library'],
    ['/tags', 'Tags', 'tags'],
    ['/duplicates', 'Duplicates', 'duplicates'],
    ['/data', 'Data', 'data'],
    ['/activity', 'Activity', 'activity'],
    ['/settings', 'Settings', 'settings'],
  ];
  const PAGES = { '/': 'overview', '/inbox': 'inbox', '/library': 'library', '/tags': 'tags', '/duplicates': 'duplicates', '/data': 'data', '/activity': 'activity', '/settings': 'settings' };

  const ICONS = {
    overview: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
    inbox: ['M12 3v11m0 0 4-4m-4 4-4-4M4 14v6h16v-6'],
    library: ['M3 6h7l2 2h9v12H3z'],
    tags: ['M4 4h9l7 7-9 9-7-7z', 'M8 8h.01'],
    duplicates: ['M7 7h11v11H7zM3 3h11v4M3 3v11h4'],
    data: ['M4 5c0-2 16-2 16 0v14c0 2-16 2-16 0zm0 0c0 2 16 2 16 0M4 12c0 2 16 2 16 0'],
    activity: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2'],
    settings: ['M4 7h16M4 12h16M4 17h16M8 5v4M16 10v4M11 15v4'],
  };
  function navIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'nv-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of ICONS[name]) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }

  // ---------- theme
  function applyTheme() {
    let t = null;
    try {
      t = localStorage.getItem('ws-theme');
    } catch (e) {
      /* ignore */
    }
    if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }
  WS.setTheme = (v) => {
    try {
      if (v === 'dark' || v === 'light') localStorage.setItem('ws-theme', v);
      else localStorage.removeItem('ws-theme');
    } catch (e) {
      /* ignore */
    }
    applyTheme();
  };
  applyTheme();

  // ---------- shell
  const rail = h('nav', { class: 'rail', 'aria-label': 'Pages' }, ...NAV.map(([path, label, icon]) => h('a', { class: 'nv', href: '#' + path, dataset: { path } }, h('span', { class: 'nv-label' }, navIcon(icon), h('span', { text: label })), path === '/inbox' ? h('span', { class: 'count', id: 'inbox-count' }) : null)));
  const search = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search images',
    'aria-label': 'Search images',
    onkeydown: (e) => {
      if (e.key === 'Enter') location.hash = '#/data?q=' + encodeURIComponent(search.value.trim());
    },
  });
  const dot = h('span', { class: 'dot off' });
  const chipText = h('span', { class: 't', text: 'Connecting…' });
  const chip = h('span', { class: 'status', role: 'status' }, dot, chipText);
  const scan = h('button', {
    class: 'btn',
    text: 'Scan now',
    onclick: async () => {
      try {
        await WS.post('/api/rescan');
        WS.toast('Looking at the folders again');
      } catch (e) {
        WS.toast(e.message, { error: true });
      }
    },
  });
  const main = h('main', { class: 'main', id: 'main', tabindex: '-1' });
  const toastBox = h('div', { id: 'toast', hidden: true, role: 'status', 'aria-live': 'polite' });
  WS.$('#app').append(h('header', { class: 'topbar' }, h('span', { class: 'brand', text: 'Wallpaper Sorter' }), h('span', { class: 'spacer' }), search, chip, scan), h('div', { class: 'body' }, rail, main), toastBox);

  WS.onOnline((ok) => {
    dot.classList.toggle('off', !ok);
    chipText.textContent = ok ? 'Watching' : 'Not connected';
  });

  // ---------- routing and rendering
  function current() {
    const [path, query] = (location.hash.slice(1) || '/').split('?');
    return { path: PAGES[path] ? path : '/', params: new URLSearchParams(query || '') };
  }

  function captureFocus() {
    const el = document.activeElement;
    return el && el.id && main.contains(el) ? { id: el.id, start: el.selectionStart, end: el.selectionEnd } : null;
  }
  function restoreFocus(f) {
    if (!f) return;
    const el = document.getElementById(f.id);
    if (!el) return;
    el.focus();
    try {
      if (f.start !== null && f.start !== undefined) el.setSelectionRange(f.start, f.end);
    } catch (e) {
      /* not a text field */
    }
  }

  let token = 0;
  async function render(keepScroll) {
    const { path, params } = current();
    const mine = ++token;
    for (const a of rail.children) {
      const on = a.dataset.path === path;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    const focus = captureFocus();
    const top = keepScroll ? main.scrollTop : 0;
    WS.keys = {};
    if (!keepScroll) main.replaceChildren(h('div', { class: 'page' }, h('p', { class: 'muted', text: 'Loading…' })));
    let node;
    try {
      node = await WS.pages[PAGES[path]](params);
    } catch (e) {
      node = h('div', { class: 'page' }, WS.errorBox(e, () => render(false)));
    }
    if (mine !== token) return; // a newer render has started
    main.replaceChildren(node);
    main.scrollTop = top;
    restoreFocus(focus);
  }
  WS.refresh = () => render(true);
  window.addEventListener('hashchange', () => {
    WS.closeLayer();
    WS.clearSelection();
    render(false);
  });

  // ---------- status polling: the sorter works in the background, so the page keeps up
  let signature = '';
  async function poll() {
    try {
      const st = await WS.get('/api/status');
      WS.status = st;
      const badge = WS.$('#inbox-count');
      if (badge) badge.textContent = st.counts.inbox ? String(st.counts.inbox) : '';
      const sig = JSON.stringify([st.counts, st.activity_last_id]);
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'SELECT');
      if (signature && sig !== signature && !WS.hasLayer() && !typing) WS.refresh();
      signature = sig;
    } catch (e) {
      /* the chip already says "Not connected" */
    }
  }
  WS.poll = poll;
  setInterval(poll, 3000);

  // ---------- keyboard
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
    if (e.key === 'Escape') {
      if (WS.hasLayer()) WS.closeLayer();
      else if (WS.selection.keys.size) {
        WS.clearSelection();
        WS.refresh();
      }
      return;
    }
    if (typing || e.metaKey || e.altKey) return;
    if (e.ctrlKey) {
      if (e.key.toLowerCase() === 'a' && WS.keys.all) {
        e.preventDefault();
        WS.keys.all();
      }
      return;
    }
    if (e.key === 'a' && WS.keys.assign) {
      e.preventDefault();
      WS.keys.assign();
    } else if (e.key === 'Delete' && WS.keys.remove) {
      e.preventDefault();
      WS.keys.remove();
    }
  });

  // ---------- go
  (async function start() {
    await poll();
    await render(false);
  })();
})();

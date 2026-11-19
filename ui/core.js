'use strict';
// Shared helpers: building elements, talking to the API, toasts, sheets, dialogs, pickers.
// Everything that comes from the file system is put on the page with textContent, never as HTML.
(function () {
  const WS = (window.WS = { refresh: () => {}, status: null });

  WS.$ = (sel, root) => (root || document).querySelector(sel);
  WS.h = function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };
  const h = WS.h;

  // ---------- formatting
  WS.fmtBytes = (n) => {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  };
  WS.fmtDateTime = (sec) => (sec ? new Date(sec * 1000).toLocaleString() : '');
  WS.fmtTime = (sec) => new Date(sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  WS.fmtDay = (sec) => new Date(sec * 1000).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  WS.basename = (p) => p.split('/').pop();
  WS.dirname = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  WS.extOf = (name) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '');
  WS.safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//.test(u) ? u : null);
  WS.plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

  // ---------- API
  let onlineHook = () => {};
  WS.onOnline = (fn) => (onlineHook = fn);
  WS.api = async function api(method, path, body) {
    const init = { method, headers: {} };
    if (method !== 'GET') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body === undefined ? {} : body);
    }
    let res;
    try {
      res = await fetch(path, init);
    } catch (e) {
      onlineHook(false);
      throw new Error('Cannot reach the sorter');
    }
    onlineHook(true);
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : null;
    if (!res.ok) {
      const err = new Error((data && data.error) || res.statusText || 'Request failed');
      err.status = res.status;
      throw err;
    }
    return data;
  };
  WS.get = (path) => WS.api('GET', path);
  WS.post = (path, body) => WS.api('POST', path, body);
  WS.undoBatch = (batch) => WS.post('/api/undo', { batch });

  // ---------- small components
  WS.thumb = function thumb(hash, alt) {
    if (!hash) return h('span');
    const src = `/api/thumb/${hash}`;
    const img = h('img', { src, alt: alt || '', loading: 'lazy', decoding: 'async' });
    let retrying = false;
    let objectUrl = null;
    const placeholder = () => {
      if (!img.isConnected) return;
      const ext = (alt || '').includes('.') ? alt.split('.').pop().toUpperCase() : 'IMAGE';
      img.replaceWith(h('span', { class: 'thumb-placeholder', text: ext }));
    };
    img.addEventListener('load', () => {
      img.classList.add('loaded');
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    });
    img.addEventListener('error', () => {
      if (retrying) {
        placeholder();
        return;
      }
      retrying = true;
      const retry = async () => {
        while (img.isConnected) {
          let response;
          try {
            response = await fetch(src);
          } catch {
            placeholder();
            return;
          }
          if (response.status !== 503) {
            if (!response.ok) {
              placeholder();
              return;
            }
            try {
              objectUrl = URL.createObjectURL(await response.blob());
            } catch {
              placeholder();
              return;
            }
            if (!img.isConnected) {
              URL.revokeObjectURL(objectUrl);
              objectUrl = null;
              return;
            }
            img.src = objectUrl;
            return;
          }
          const retryAfter = response.headers.get('Retry-After');
          let delay = 1000;
          if (retryAfter) {
            const seconds = Number(retryAfter);
            if (Number.isFinite(seconds)) delay = seconds * 1000;
            else {
              const retryAt = Date.parse(retryAfter);
              if (Number.isFinite(retryAt)) delay = retryAt - Date.now();
            }
          }
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, delay)));
        }
      };
      retry();
    });
    return img;
  };
  const ICONS = {
    close: ['M18 6 6 18', 'm6 6 12 12'],
    info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
    previous: ['m15 18-6-6 6-6'],
    next: ['m9 18 6-6-6-6'],
  };
  WS.icon = function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ui-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of ICONS[name] || []) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  };
  WS.badge = (text, cls) => h('span', { class: 'badge' + (cls ? ' ' + cls : ''), text });
  WS.siteBadges = (origin) => {
    const sources = (origin && origin.sources) || [];
    const shown = sources.filter((s) => s.site !== 'Unknown');
    return shown.length ? shown.map((s) => WS.badge(s.id ? `${s.site} ${s.id}` : s.site)) : [WS.badge('Unknown source')];
  };
  WS.empty = (title, text) => h('div', { class: 'empty' }, h('b', { text: title }), text || '');
  WS.errorBox = (err, retry) =>
    h('div', { class: 'empty' }, h('b', { class: 'error', text: 'Something went wrong' }), err.message || String(err), h('div', {}, retry ? h('button', { class: 'btn', onclick: retry, text: 'Try again' }) : null));

  // ---------- toast
  let toastTimer;
  WS.toast = function toast(message, opts) {
    const o = opts || {};
    const box = WS.$('#toast');
    if (!box) return;
    box.className = 'toast' + (o.error ? ' err' : '');
    box.replaceChildren(h('span', { text: message }));
    if (o.undo) {
      box.append(
        h('button', {
          class: 'btn small',
          text: 'Undo',
          onclick: async () => {
            try {
              await o.undo();
              WS.toast('Undone');
              WS.refresh();
            } catch (e) {
              WS.toast(e.message, { error: true });
            }
          },
        })
      );
    }
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (box.hidden = true), o.undo ? 12000 : 4500);
  };

  // ---------- sheets and dialogs
  let layer = null;
  WS.closeLayer = function closeLayer() {
    if (!layer) return;
    const l = layer;
    layer = null;
    l.nodes.forEach((n) => n.remove());
    if (l.onClose) l.onClose();
  };
  WS.hasLayer = () => !!layer;

  WS.openSheet = function openSheet(title, content, footer, onClose) {
    WS.closeLayer();
    const overlay = h('div', { class: 'overlay', onclick: WS.closeLayer });
    const sheet = h(
      'aside',
      { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', {}, h('h2', { text: title }), h('button', { class: 'btn small icon-btn', type: 'button', 'aria-label': 'Close', title: 'Close', onclick: WS.closeLayer }, WS.icon('close'))),
      h('div', { class: 'content' }, content),
      footer ? h('footer', {}, footer) : null
    );
    document.body.append(overlay, sheet);
    layer = { nodes: [overlay, sheet], onClose };
    const first = sheet.querySelector('input,select,textarea');
    if (first) first.focus();
    return sheet;
  };

  WS.confirmBox = function confirmBox(message, okText, danger) {
    return new Promise((resolve) => {
      WS.closeLayer();
      let answered = false;
      const done = (v) => {
        if (answered) return;
        answered = true;
        WS.closeLayer();
        resolve(v);
      };
      const overlay = h('div', { class: 'overlay', onclick: () => done(false) });
      const ok = h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => done(true), text: okText || 'OK' });
      const box = h(
        'div',
        { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true' },
        h('p', { text: message }),
        h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => done(false), text: 'Cancel' }), ok)
      );
      document.body.append(overlay, box);
      layer = { nodes: [overlay, box], onClose: () => done(false) };
      ok.focus();
    });
  };

  // ---------- folder picker with type-ahead
  const RECENT_KEY = 'ws-recent-folders';
  WS.recentFolders = () => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    } catch (e) {
      return [];
    }
  };
  WS.rememberFolder = (folder) => {
    try {
      const list = [folder, ...WS.recentFolders().filter((f) => f !== folder)].slice(0, 6);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch (e) {
      /* private mode: ignore */
    }
  };

  WS.folderPicker = function folderPicker(opts) {
    const known = (opts.folders || []).map((f) => f.path).filter((p) => p !== opts.hide);
    const input = h('input', { class: 'input wide', value: opts.value || '', placeholder: opts.placeholder || 'Folder, for example Wuthering-Waves/Chisa', autocomplete: 'off', 'aria-label': 'Folder' });
    const list = h('div', { class: 'suggest', hidden: true });
    function pick(p) {
      input.value = p;
      list.hidden = true;
      if (opts.onChange) opts.onChange(p);
    }
    function refresh() {
      const q = input.value.trim().toLowerCase();
      let items = q ? known.filter((p) => p.toLowerCase().includes(q)) : WS.recentFolders().filter((p) => known.includes(p));
      items = items.slice(0, 8);
      list.replaceChildren(...items.map((p) => h('button', { type: 'button', onmousedown: (e) => { e.preventDefault(); pick(p); }, text: p })));
      const typed = input.value.trim();
      if (typed && !known.includes(typed)) list.append(h('div', { class: 'new', text: `New folder: ${typed}` }));
      list.hidden = !list.childNodes.length;
      if (opts.onChange) opts.onChange(typed);
    }
    input.addEventListener('input', refresh);
    input.addEventListener('focus', refresh);
    input.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 120));
    return { el: h('div', { class: 'picker' }, input, list), input, get: () => input.value.trim() };
  };

  // ---------- chip input (keywords)
  WS.chipInput = function chipInput(initial, placeholder) {
    const values = [...(initial || [])];
    const wrap = h('div', { class: 'chips' });
    const input = h('input', { class: 'chip-in', placeholder: placeholder || '', 'aria-label': placeholder || 'Add' });
    function draw() {
      wrap.replaceChildren(
        ...values.map((v, i) =>
          h('span', { class: 'tagchip' }, v, h('button', { type: 'button', 'aria-label': `Remove ${v}`, text: '×', onclick: () => { values.splice(i, 1); draw(); } }))
        ),
        input
      );
    }
    function add() {
      const v = input.value.trim().replace(/,$/, '').trim();
      if (v && !values.includes(v)) values.push(v);
      input.value = '';
      draw();
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        add();
        input.focus();
      } else if (e.key === 'Backspace' && !input.value && values.length) {
        values.pop();
        draw();
        input.focus();
      }
    });
    input.addEventListener('blur', () => {
      if (input.value.trim()) add();
    });
    draw();
    return {
      el: wrap,
      add: (v) => { if (v && !values.includes(v)) { values.push(v); draw(); } },
      get: () => {
        const pending = input.value.trim();
        return pending && !values.includes(pending) ? [...values, pending] : [...values];
      },
    };
  };

  // ---------- selection shared by the grids
  WS.selection = { keys: new Set(), last: null };
  WS.clearSelection = () => {
    WS.selection.keys.clear();
    WS.selection.last = null;
  };
})();

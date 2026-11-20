'use strict';
// The pages. Each one is an async function that returns the element to show.
(function () {
  const WS = window.WS;
  const h = WS.h;
  WS.pages = {};
  WS.keys = {}; // keyboard actions of the page that is showing: { assign, remove, all }

  const dupFolder = () => (WS.status && WS.status.settings && WS.status.settings.duplicates_folder) || 'Duplicates';
  const enc = encodeURIComponent;

  function page(title, sub, actions, ...kids) {
    return h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('h1', { text: title }), sub ? h('span', { class: 'sub', text: sub }) : null, h('span', { class: 'spacer' }), actions || null), ...kids);
  }

  async function rebuildThumbnails(hashes) {
    const unique = [...new Set(hashes.filter(Boolean))];
    if (!unique.length) {
      WS.toast('No thumbnails available to rebuild', { error: true });
      return;
    }
    WS.toast(`Rebuilding ${WS.plural(unique.length, 'thumbnail')}…`);
    let done = 0;
    const errors = [];
    for (const hash of unique) {
      try {
        await WS.rebuildThumbnail(hash);
        done++;
      } catch (e) {
        errors.push(e.message);
      }
    }
    if (errors.length) WS.toast(`Rebuilt ${done} of ${unique.length}; ${errors.length} failed: ${errors[0]}`, { error: true });
    else WS.toast(`Rebuilt ${WS.plural(done, 'thumbnail')}`);
  }

  // ---------- image grid with selection (used by the Inbox and the Library)
  // items: [{ key, hash, name, sub, label, labelClass, title, onOpen }]
  function imageGrid(items, bar) {
    const CHUNK = 240;
    let shown = 0;
    const grid = h('div', { class: 'grid', role: 'list' });
    const more = h('div', { class: 'more' });
    const root = h('div', { class: 'grid-scroll' }, grid, more);

    function sync() {
      const sel = WS.selection.keys;
      for (const c of grid.children) {
        const on = sel.has(c.dataset.key);
        c.classList.toggle('sel', on);
        c.setAttribute('aria-pressed', String(on));
      }
      bar.update();
    }
    function toggle(it, e) {
      const sel = WS.selection;
      if (e && e.shiftKey && sel.last !== null) {
        const keys = items.map((x) => x.key);
        const a = keys.indexOf(sel.last);
        const b = keys.indexOf(it.key);
        if (a >= 0 && b >= 0) keys.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((k) => sel.keys.add(k));
      } else if (sel.keys.has(it.key)) sel.keys.delete(it.key);
      else sel.keys.add(it.key);
      sel.last = it.key;
      sync();
    }
    function cell(it) {
      const on = WS.selection.keys.has(it.key);
      const el = h(
        'div',
        { class: 'cell' + (on ? ' sel' : '') + (it.hash ? ' loading' : ''), role: 'listitem', tabindex: '0', 'aria-pressed': String(on), 'aria-label': it.name, dataset: { key: it.key } },
        WS.thumb(it.hash, it.name),
        it.label ? h('span', { class: 'label ' + (it.labelClass || ''), title: it.title || '', text: it.label }) : null,
        h('span', { class: 'check', text: '✓' }),
        h('button', { class: 'open', type: 'button', 'aria-label': `Details of ${it.name}`, title: 'Details', onclick: (e) => { e.stopPropagation(); it.onOpen(); } }, WS.icon('info')),
        h('div', { class: 'cap' }, h('span', { class: 'm', text: it.name }), it.sub ? h('span', { class: 'm', text: it.sub }) : null)
      );
      el.addEventListener('click', (e) => toggle(it, e));
      el.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          toggle(it, e);
        }
      });
      return el;
    }
    function showMore() {
      const next = items.slice(shown, shown + CHUNK);
      next.forEach((it) => grid.append(cell(it)));
      shown += next.length;
      const left = items.length - shown;
      if (left > 0) more.replaceChildren(h('button', { class: 'btn', text: `Show ${Math.min(CHUNK, left)} more (${left} not shown)`, onclick: showMore }));
      else more.replaceChildren();
    }
    showMore();
    return { el: root, sync };
  }

  function selectionBar(buttons, allKeys) {
    const el = h('div', { class: 'selbar', role: 'toolbar', 'aria-label': 'Selection' });
    const api = {
      el,
      update() {
        const n = WS.selection.keys.size;
        el.hidden = n === 0;
        el.replaceChildren(
          h('b', { text: `${n} selected` }),
          ...buttons.map((b) => h('button', { class: 'btn ' + (b.cls || ''), text: b.text, onclick: b.run })),
          h('button', { class: 'btn', text: 'Select all', onclick: () => { allKeys().forEach((k) => WS.selection.keys.add(k)); api.onChange(); } }),
          h('button', { class: 'btn', text: 'Clear', onclick: () => { WS.clearSelection(); api.onChange(); } })
        );
      },
      onChange: () => {},
    };
    api.update();
    return api;
  }

  function pruneSelection(validKeys) {
    const valid = new Set(validKeys);
    for (const k of [...WS.selection.keys]) if (!valid.has(k)) WS.selection.keys.delete(k);
  }

  // ---------- assign / move sheet
  const BORING = new Set(['full', 'wallpaper', 'wallpapers', 'konachan', 'yande', 'png', 'jpg', 'jpeg', 'and', 'the', 'drawn', 'tagme', 'naive', 'com', 'uhdpaper']);

  async function openAssign(opts) {
    let folders, tags;
    try {
      [folders, tags] = await Promise.all([WS.get('/api/folders'), WS.get('/api/tags')]);
    } catch (e) {
      WS.toast(e.message, { error: true });
      return;
    }
    const files = opts.files;
    const picker = WS.folderPicker({ folders, hide: dupFolder(), onChange: updatePreview });
    const preview = h('div', { class: 'preview-line' });
    const problem = h('div', { class: 'error', role: 'alert' });

    function updatePreview() {
      const f = picker.get();
      if (!f) {
        preview.textContent = '';
        return;
      }
      const info = folders.find((x) => x.path === f);
      const tagged = tags.find((t) => t.dest === f && t.prefix);
      const prefix = info ? info.prefix : tagged ? tagged.prefix : f.split('/').pop().replace(/-/g, ' ');
      const next = info ? info.next_number : 1;
      const name = `${prefix} ${next}.${WS.extOf(files[0].name)}`;
      preview.textContent = files.length > 1 ? `${name} and ${files.length - 1} more, numbered on from there` : `Will be named ${name}`;
    }

    // keywords for a new tag
    let tagBox = null;
    let chips = null;
    let tagArea = null;
    if (opts.withTag) {
      tagBox = h('input', { type: 'checkbox', id: 'also-tag', onchange: () => (tagArea.hidden = !tagBox.checked) });
      chips = WS.chipInput([], 'keyword, then Enter');
      const sugg = h('div', { class: 'sugg' });
      tagArea = h('div', { hidden: true }, h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Keywords (whole words in a filename)' }), chips.el, sugg));
      WS.post('/api/tags/test', { filename: files[0].name })
        .then((r) => {
          const words = [...new Set(r.words)].filter((w) => /^[a-z]{3,}$/.test(w) && !BORING.has(w));
          sugg.replaceChildren(...words.slice(0, 8).map((w) => h('button', { type: 'button', text: w, onclick: () => chips.add(w) })));
        })
        .catch(() => {});
    }

    const go = h('button', { class: 'btn primary', text: opts.verb || 'Assign' });
    async function submit() {
      problem.textContent = '';
      const folder = picker.get();
      if (!folder) {
        problem.textContent = 'Choose a folder.';
        return;
      }
      const body = { paths: files.map((f) => f.path), folder };
      if (tagBox && tagBox.checked) {
        const kws = chips.get();
        if (!kws.length) {
          problem.textContent = 'Add at least one keyword, or untick "Also save a tag".';
          return;
        }
        body.tag = { keywords: kws, dest: folder };
      }
      go.disabled = true;
      try {
        const r = await WS.post('/api/assign', body);
        WS.rememberFolder(folder);
        WS.closeLayer();
        const moved = r.done.filter((d) => d.kind === 'move').length;
        const dups = r.done.filter((d) => d.kind === 'duplicate').length;
        let msg = `Moved ${WS.plural(moved, 'image')} to ${folder}`;
        if (dups) msg += `; ${WS.plural(dups, 'duplicate')} sent to ${dupFolder()}`;
        if (r.error) WS.toast(`Stopped: ${r.error}`, { error: true });
        else WS.toast(msg, { undo: () => WS.undoBatch(r.batch) });
        WS.clearSelection();
        if (opts.onDone) opts.onDone(r);
        WS.refresh();
      } catch (e) {
        problem.textContent = e.message;
        go.disabled = false;
      }
    }
    go.addEventListener('click', submit);

    const content = h(
      'div',
      {},
      h('p', { class: 'muted', text: files.length === 1 ? files[0].name : `${files.length} images` }),
      h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Folder' }), picker.el, preview),
      opts.withTag ? h('div', { class: 'field' }, h('div', { class: 'check-row' }, tagBox, h('label', { for: 'also-tag', text: 'Also save a tag, so this does not happen again' })), tagArea) : null,
      problem
    );
    WS.openSheet(opts.title || 'Assign to folder', content, [h('button', { class: 'btn', text: 'Cancel', onclick: WS.closeLayer }), go]);
  }

  async function deleteFiles(paths, what) {
    const ok = await WS.confirmBox(`Delete ${what}? ${paths.length === 1 ? 'It goes' : 'They go'} to the trash and can be undone.`, 'Delete', true);
    if (!ok) return;
    try {
      const r = await WS.post('/api/delete', { paths });
      WS.clearSelection();
      WS.toast(`Deleted ${WS.plural(r.done.length, 'image')}`, { undo: () => WS.undoBatch(r.batch) });
      WS.refresh();
    } catch (e) {
      WS.toast(e.message, { error: true });
    }
  }

  // ---------- detail sheet
  function openDetail(d) {
    const o = d.origin;
    const rows = [['File', d.name], ...(d.rows || [])];
    if (o) {
      rows.push(['Original name', o.original_name]);
      if (o.width) rows.push(['Resolution', `${o.width} × ${o.height}`]);
      rows.push(['Added', WS.fmtDateTime(o.added)]);
      if (o.note) rows.push(['Why here', o.note]);
    }
    const kv = h('div', { class: 'kv' });
    rows.forEach(([k, v]) => kv.append(h('div', { text: k }), h('div', { class: 'm', text: String(v) })));

    const sources = h('div', { class: 'kv' });
    ((o && o.sources) || []).forEach((s) => {
      const url = WS.safeUrl(s.url);
      sources.append(
        h('div', { text: 'Source' }),
        h('div', {}, WS.badge(s.site), ' ', s.id ? h('span', { class: 'm', text: s.id }) : null, ' ', url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: 'open page' }) : null, s.artist ? h('div', { class: 'muted', text: `Artist: ${s.artist}${s.artist_id ? ' (' + s.artist_id + ')' : ''}` }) : null)
      );
    });

    const content = h('div', {}, d.hash ? h('img', { class: 'preview', src: `/api/image/${d.hash}`, alt: d.name }) : null, kv, sources, d.extra || null);
    const footer = [];
    if (d.hash) footer.push(h('button', { class: 'btn', text: 'Rebuild thumbnail', onclick: () => rebuildThumbnails([d.hash]) }));
    if (d.onAssign) footer.push(h('button', { class: 'btn primary', text: d.assignText || 'Assign…', onclick: () => { WS.closeLayer(); d.onAssign(); } }));
    if (d.onDelete) footer.push(h('button', { class: 'btn danger', text: 'Delete', onclick: () => { WS.closeLayer(); d.onDelete(); } }));
    WS.openSheet(d.name, content, footer.length ? footer : null);
  }
  WS.openDetail = openDetail;

  // ---------- Inbox
  const inboxFilter = { reason: '', intake: '' };
  WS.pages.inbox = async function () {
    const all = await WS.get('/api/inbox');
    const intakes = [...new Set(all.map((i) => i.intake))];
    const items = all.filter((i) => (!inboxFilter.reason || i.reason === inboxFilter.reason) && (!inboxFilter.intake || i.intake === inboxFilter.intake));
    pruneSelection(items.map((i) => i.path));
    const reasonText = { no_match: 'No match', conflict: 'Conflict', ready: 'Ready' };

    const cells = items.map((it) => ({
      key: it.path,
      hash: it.origin && it.origin.hash,
      name: it.name,
      sub: it.origin ? it.origin.sources.filter((s) => s.site !== 'Unknown').map((s) => s.site).join(', ') : '',
      label: reasonText[it.reason] || it.reason,
      labelClass: it.reason,
      title: it.reason === 'conflict' ? `These tags clash: ${it.matched.join(', ')}` : it.reason === 'ready' ? 'A tag matches now; the next scan sorts it' : 'No tag matches this name',
      onOpen: () => openDetail({ name: it.name, hash: it.origin && it.origin.hash, origin: it.origin, rows: [['Waiting because', reasonText[it.reason]], ['Folder', it.intake === 'library' ? 'the library folder' : it.intake]], onAssign: () => openAssign({ files: [{ path: it.path, name: it.name }], withTag: true }), onDelete: () => deleteFiles([it.path], it.name) }),
    }));
    const selected = () => items.filter((i) => WS.selection.keys.has(i.path));
    const bar = selectionBar(
      [
        { text: 'Assign to folder…', cls: 'primary', run: () => openAssign({ files: selected().map((i) => ({ path: i.path, name: i.name })), withTag: true }) },
        { text: 'Rebuild thumbnails', run: () => rebuildThumbnails(selected().map((i) => i.origin && i.origin.hash)) },
        { text: 'Delete', cls: 'danger', run: () => deleteFiles(selected().map((i) => i.path), WS.plural(selected().length, 'image')) },
      ],
      () => items.map((i) => i.path)
    );
    const grid = imageGrid(cells, bar);
    bar.onChange = grid.sync;
    WS.keys = { assign: () => selected().length && bar.el.querySelector('.primary').click(), remove: () => selected().length && bar.el.querySelector('.danger').click(), all: () => { items.forEach((i) => WS.selection.keys.add(i.path)); grid.sync(); } };

    const reasonSel = h('select', { class: 'select', 'aria-label': 'Filter by reason', onchange: (e) => { inboxFilter.reason = e.target.value; WS.refresh(); } }, h('option', { value: '', text: 'Any reason' }), h('option', { value: 'no_match', text: 'No match' }), h('option', { value: 'conflict', text: 'Conflict' }), h('option', { value: 'ready', text: 'Ready' }));
    reasonSel.value = inboxFilter.reason;
    const intakeSel = h('select', { class: 'select', 'aria-label': 'Filter by folder', onchange: (e) => { inboxFilter.intake = e.target.value; WS.refresh(); } }, h('option', { value: '', text: 'All folders' }), ...intakes.map((i) => h('option', { value: i, text: i === 'library' ? 'Library folder' : WS.basename(i) })));
    intakeSel.value = inboxFilter.intake;

    return page(
      'Inbox',
      all.length ? `${all.length} waiting` : '',
      h('div', { class: 'row' }, reasonSel, intakes.length > 1 ? intakeSel : null),
      all.length === 0 ? WS.empty('Inbox clear', 'Images that cannot be sorted by their name wait here.') : null,
      items.length === 0 && all.length ? WS.empty('Nothing matches these filters') : null,
      bar.el,
      items.length ? grid.el : null
    );
  };

  // ---------- Library
  WS.pages.library = async function (params) {
    const dup = dupFolder();
    const folders = (await WS.get('/api/folders')).filter((f) => f.path !== dup && !f.path.startsWith(dup + '/'));
    if (!folders.length) return page('Library', '', h('button', { class: 'btn primary', text: 'New folder', onclick: () => openCreateFolder('') }), WS.empty('No folders yet', 'Folders appear here when images are sorted into them.'));
    let current = params.get('folder');
    if (!current || !folders.some((f) => f.path === current)) current = folders[0].path;
    const info = folders.find((f) => f.path === current);
    const images = await WS.get(`/api/images?folder=${enc(current)}`);
    pruneSelection(images.map((i) => i.path));

    const go = (folder) => { WS.clearSelection(); location.hash = `#/library?folder=${enc(folder)}`; };
    const tree = h('nav', { class: 'tree', 'aria-label': 'Folders' }, ...folders.map((f) => {
      const depth = f.path.split('/').length - 1;
      const b = h('button', { class: f.path === current ? 'on' : '', 'aria-current': f.path === current ? 'true' : null, onclick: () => go(f.path) }, h('span', { text: f.name }), h('span', { class: 'count', text: String(f.count) }));
      b.style.paddingLeft = 8 + depth * 14 + 'px';
      return b;
    }));

    const segs = current.split('/');
    const crumbs = h('div', { class: 'crumbs' }, ...segs.flatMap((s, i) => [i ? '/' : null, h('button', { text: s, onclick: () => { const p = segs.slice(0, i + 1).join('/'); if (folders.some((f) => f.path === p)) go(p); } })]));

    const cells = images.map((im) => ({
      key: im.path,
      hash: im.hash,
      name: im.name,
      sub: im.origin ? im.origin.sources.filter((s) => s.site !== 'Unknown').map((s) => s.site).join(', ') : '',
      onOpen: () => openDetail({ name: im.name, hash: im.hash, origin: im.origin, rows: [['Folder', current], ['Size', WS.fmtBytes(im.size)]], assignText: 'Move to folder…', onAssign: () => openAssign({ files: [{ path: im.path, name: im.name }], title: 'Move to folder', verb: 'Move' }), onDelete: () => deleteFiles([im.path], im.name) }),
    }));
    const selected = () => images.filter((i) => WS.selection.keys.has(i.path));
    const bar = selectionBar(
      [
        { text: 'Move to folder…', cls: 'primary', run: () => openAssign({ files: selected().map((i) => ({ path: i.path, name: i.name })), title: 'Move to folder', verb: 'Move' }) },
        { text: 'Rebuild thumbnails', run: () => rebuildThumbnails(selected().map((i) => i.hash)) },
        { text: 'Delete', cls: 'danger', run: () => deleteFiles(selected().map((i) => i.path), WS.plural(selected().length, 'image')) },
      ],
      () => images.map((i) => i.path)
    );
    const grid = imageGrid(cells, bar);
    bar.onChange = grid.sync;
    WS.keys = { assign: () => selected().length && bar.el.querySelector('.primary').click(), remove: () => selected().length && bar.el.querySelector('.danger').click(), all: () => { images.forEach((i) => WS.selection.keys.add(i.path)); grid.sync(); } };

    const sourceCounts = new Map();
    for (const image of images) {
      const source = (image.origin?.sources || []).find((item) => item.site && item.site !== 'Unknown');
      const label = source ? source.site : 'Unknown';
      sourceCounts.set(label, (sourceCounts.get(label) || 0) + 1);
    }
    const sourceSummary = h(
      'span',
      { class: 'source-counts', role: 'group', 'aria-label': 'Images by source' },
      h('span', { class: 'source-count-label', text: 'Sources' }),
      ...[...sourceCounts.entries()]
        .sort(([a], [b]) => (a === 'Unknown' ? -1 : b === 'Unknown' ? 1 : a.localeCompare(b)))
        .map(([source, count]) => h('span', { class: 'source-count' }, h('b', { text: source }), String(count)))
    );
    const facts = h('div', { class: 'facts' }, h('span', {}, 'Prefix ', h('b', { text: info.prefix })), h('span', {}, 'Next number ', h('b', { text: String(info.next_number) })), h('span', {}, 'Images ', h('b', { text: String(images.length) })), info.gaps.length ? h('span', {}, 'Gaps ', h('b', { text: info.gaps.length > 6 ? `${info.gaps.length} (${info.gaps.slice(0, 6).join(', ')}, …)` : `${info.gaps.length} (${info.gaps.join(', ')})` })) : null, sourceCounts.size ? sourceSummary : null);
    const fill = info.gaps.length ? h('button', { class: 'btn', text: 'Close gaps…', onclick: () => openFillGaps(current) }) : null;
    const actions = h('div', { class: 'row' },
      h('button', { class: 'btn', text: 'New folder', onclick: () => openCreateFolder(current + '/') }),
      h('button', { class: 'btn', text: 'Manage folder…', onclick: () => openFolderManagement(current, info, folders) }),
      fill
    );

    return h('div', { class: 'page' }, h('div', { class: 'lib' }, tree, h('div', { class: 'lib-main' }, h('div', { class: 'page-head' }, h('h1', { text: info.name }), h('span', { class: 'spacer' }), actions), crumbs, facts, images.length === 0 ? WS.empty('No images in this folder') : null, bar.el, images.length ? grid.el : null)));
  };

  function openCreateFolder(defaultPath) {
    const input = h('input', { class: 'input wide', value: defaultPath, placeholder: 'Folder path, for example Series/Violet', 'aria-label': 'New folder path' });
    const problem = h('div', { class: 'error', role: 'alert' });
    const create = h('button', { class: 'btn primary', text: 'Create folder' });
    create.addEventListener('click', async () => {
      problem.textContent = '';
      create.disabled = true;
      try {
        const result = await WS.post('/api/folders', { folder: input.value.trim() });
        WS.closeLayer();
        WS.toast(`Created ${result.folder}`);
        location.hash = `#/library?folder=${enc(result.folder)}`;
        WS.refresh();
      } catch (e) {
        problem.textContent = e.message;
        create.disabled = false;
      }
    });
    WS.openSheet('New folder', h('div', {}, h('div', { class: 'field' }, h('label', { for: 'new-folder', text: 'Folder path' }), input), problem), [h('button', { class: 'btn', text: 'Cancel', onclick: WS.closeLayer }), create]);
  }

  function openFolderManagement(folder, info, folders) {
    const renameInput = h('input', { class: 'input wide', value: folder, 'aria-label': 'New folder path' });
    const mergeSelect = h('select', { class: 'select', 'aria-label': 'Merge destination' }, ...folders.filter((f) => f.path !== folder && !f.path.startsWith(folder + '/')).map((f) => h('option', { value: f.path, text: f.path })));
    const prefixInput = h('input', { class: 'input wide', value: info.prefix, 'aria-label': 'File prefix' });
    const renamePreview = h('div', { class: 'folder-preview' });
    const mergePreview = h('div', { class: 'folder-preview' });
    const prefixPreview = h('div', { class: 'folder-preview' });

    async function previewChange(kind, params, target, allowNoFiles) {
      target.replaceChildren();
      try {
        const query = new URLSearchParams(params).toString();
        const data = await WS.get(`/api/folder-${kind}?${query}`);
        const blocked = data.items.some((i) => i.kind === 'leave');
        const detail = data.items.slice(0, 30).map((i) => h('div', { class: 'resort-row' }, h('span', { class: 'm grow', text: i.to ? `${i.from} → ${i.to}` : i.path }), i.reason ? h('span', { class: 'muted', text: i.reason }) : null));
        const note = h('p', { class: blocked ? 'error' : 'muted', text: blocked ? 'Some destinations are occupied. Resolve the conflicts before applying.' : `${data.changes} file${data.changes === 1 ? '' : 's'} will change.` });
        const apply = h('button', { class: 'btn primary', text: kind === 'prefix' ? 'Save prefix' : kind === 'rename' ? 'Rename folder' : 'Merge folders', disabled: blocked || (!allowNoFiles && data.changes === 0) });
        apply.addEventListener('click', async () => {
          const label = kind === 'prefix' ? `Save the prefix “${params.prefix}”?` : kind === 'rename' ? `Rename ${params.from} to ${params.to}?` : `Merge ${params.from} into ${params.to}?`;
          if (!(await WS.confirmBox(`${label} ${data.changes ? 'File changes are logged and can be undone.' : 'No files need renaming.'}`, apply.textContent, kind !== 'prefix'))) return;
          apply.disabled = true;
          try {
            const body = kind === 'prefix' ? { folder: params.folder, prefix: params.prefix } : { from: params.from, to: params.to };
            const result = kind === 'prefix' ? await WS.api('PUT', `/api/folder-${kind}`, body) : await WS.post(`/api/folder-${kind}`, body);
            if (result.error) throw new Error(result.error);
            WS.closeLayer();
            const message = kind === 'prefix' ? `Prefix changed for ${params.folder}` : `${kind === 'rename' ? 'Renamed' : 'Merged'} ${params.from}`;
            WS.toast(message, result.done.length ? { undo: () => WS.undoBatch(result.batch) } : undefined);
            const next = kind === 'rename' ? params.to : kind === 'merge' ? params.to : params.folder;
            location.hash = `#/library?folder=${enc(next)}`;
            WS.refresh();
          } catch (e) {
            target.append(h('p', { class: 'error', role: 'alert', text: e.message }));
            apply.disabled = false;
          }
        });
        const more = data.items.length > 30 ? [h('p', { class: 'muted', text: `Showing 30 of ${data.items.length} changes.` })] : [];
        target.replaceChildren(note, ...detail, ...more, apply);
      } catch (e) {
        target.replaceChildren(h('p', { class: 'error', role: 'alert', text: e.message }));
      }
    }

    const renameButton = h('button', { class: 'btn', text: 'Preview rename', onclick: () => previewChange('rename', { from: folder, to: renameInput.value.trim() }, renamePreview, false) });
    const mergeButton = h('button', { class: 'btn', text: 'Preview merge', onclick: () => previewChange('merge', { from: folder, to: mergeSelect.value }, mergePreview, false) });
    const prefixButton = h('button', { class: 'btn', text: 'Preview prefix', onclick: () => previewChange('prefix', { folder, prefix: prefixInput.value.trim() }, prefixPreview, true) });
    const section = (title, control, button, output) => h('section', { class: 'folder-manage-section' }, h('h3', { text: title }), control, button, output);
    WS.openSheet(`Manage ${folder}`, h('div', {},
      section('Rename', renameInput, renameButton, renamePreview),
      section('Merge into', mergeSelect, mergeButton, mergePreview),
      section('Numbering prefix', prefixInput, prefixButton, prefixPreview)
    ), [h('button', { class: 'btn', text: 'Done', onclick: WS.closeLayer })]);
  }

  function openFillGaps(folder) {
    let mode = 'last';
    const list = h('div', { class: 'list' });
    const note = h('p', { class: 'muted' });
    const apply = h('button', { class: 'btn primary', text: 'Apply', disabled: true });
    const segLast = h('button', { text: 'Move the last images into the gaps', onclick: () => setMode('last') });
    const segAll = h('button', { text: 'Renumber everything', onclick: () => setMode('renumber') });
    function setMode(m) {
      mode = m;
      segLast.classList.toggle('on', m === 'last');
      segAll.classList.toggle('on', m === 'renumber');
      load();
    }
    async function load() {
      apply.disabled = true;
      try {
        const r = await WS.get(`/api/gap-fill?folder=${enc(folder)}&mode=${mode}`);
        note.textContent = r.length ? `${WS.plural(r.length, 'file')} would be renamed. Nothing else moves.` : 'Nothing to rename.';
        const more = r.length > 40 ? [h('div', { class: 'muted', text: `…and ${r.length - 40} more` })] : [];
        list.replaceChildren(...r.slice(0, 40).map((x) => h('div', {}, h('span', { class: 'm grow', text: `${x.from} → ${x.to}` }))), ...more);
        apply.disabled = r.length === 0;
      } catch (e) {
        note.textContent = e.message;
        list.replaceChildren();
      }
    }
    apply.addEventListener('click', async () => {
      apply.disabled = true;
      try {
        const r = await WS.post('/api/gap-fill', { folder, mode });
        WS.closeLayer();
        WS.toast(`Renamed ${WS.plural(r.done.length, 'file')} in ${folder}`, { undo: () => WS.undoBatch(r.batch) });
        WS.refresh();
      } catch (e) {
        note.textContent = e.message;
      }
    });
    WS.openSheet('Close gaps in ' + folder, h('div', {}, h('div', { class: 'seg', role: 'group' }, segLast, segAll), note, list), [h('button', { class: 'btn', text: 'Cancel', onclick: WS.closeLayer }), apply]);
    setMode('last');
  }
  WS.ui = { page, imageGrid, selectionBar, pruneSelection, openAssign, deleteFiles, dupFolder, enc };
})();

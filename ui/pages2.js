'use strict';
// The other pages: Activity, Tags, Duplicates, Data, Settings.
(function () {
  const WS = window.WS;
  const h = WS.h;
  const { page, openAssign, deleteFiles, dupFolder, enc } = WS.ui;
  const SITES = ['Wallhaven', 'Zerochan', 'Konachan', 'yande.re', 'Danbooru', 'Pixiv', 'Unknown'];

  // ---------- Activity
  function kindLabel(e) {
    if (e.kind === 'undo') return 'Undone';
    if (e.kind === 'rename') return 'Renamed';
    if (e.kind === 'duplicate') return 'Sent to Duplicates';
    if ((e.note || '').startsWith('Deleted')) return 'Deleted';
    if ((e.note || '').startsWith('Assigned')) return 'Assigned';
    return 'Sorted';
  }
  const shortPath = (p, root) => (p.startsWith(root + '/') ? p.slice(root.length + 1) : WS.basename(p));

  async function undoOne(id) {
    try {
      await WS.post('/api/undo', { id });
      WS.toast('Undone');
      WS.refresh();
    } catch (e) {
      WS.toast(e.message, { error: true });
    }
  }
  async function undoBatch(batch) {
    try {
      await WS.undoBatch(batch);
      WS.toast('Undone');
      WS.refresh();
    } catch (e) {
      WS.toast(e.message, { error: true });
    }
  }

  function actRow(e, root) {
    return h(
      'div',
      { class: 'act' },
      h('span', { class: 't m', text: WS.fmtTime(e.time) }),
      h('span', { class: 'k', text: kindLabel(e) }),
      h('span', { class: 'm grow', title: `${e.from} → ${e.to}`, text: `${shortPath(e.from, root)} → ${shortPath(e.to, root)}` }),
      e.undone ? WS.badge('undone') : e.undoable ? h('button', { class: 'btn small', text: 'Undo', onclick: () => undoOne(e.id) }) : null
    );
  }

  WS.activityRows = function activityRows(items, root, compact) {
    if (compact) return h('div', { class: 'batch' }, ...items.map((e) => actRow(e, root)));
    const out = [];
    let day = '';
    let i = 0;
    while (i < items.length) {
      const d = WS.fmtDay(items[i].time);
      if (d !== day) {
        day = d;
        out.push(h('div', { class: 'day', text: d }));
      }
      let j = i;
      while (j < items.length && items[j].batch === items[i].batch && WS.fmtDay(items[j].time) === d) j++;
      const group = items.slice(i, j);
      const head = group.length > 1 || group.some((g) => g.undoable) ? h('div', { class: 'batch-head' }, h('span', { text: WS.plural(group.length, 'action') }), h('span', { class: 'spacer' }), group.some((g) => g.undoable) && group.length > 1 ? h('button', { class: 'btn small', text: 'Undo all', onclick: () => undoBatch(items[i].batch) }) : null) : null;
      out.push(h('div', { class: 'batch' }, head, ...group.map((e) => actRow(e, root))));
      i = j;
    }
    return h('div', {}, out);
  };

  WS.pages.activity = async function () {
    const [items, st] = await Promise.all([WS.get('/api/activity?limit=300'), WS.get('/api/status')]);
    return page(
      'Activity',
      items.length ? 'Everything the sorter did, newest first' : '',
      null,
      items.length ? WS.activityRows(items, st.library, false) : WS.empty('Nothing yet', 'Every move and rename is listed here and can be undone.'),
      items.length ? h('p', { class: 'faint', text: 'The log keeps recent entries. Where each image came from is kept for good, on the Data page.' }) : null
    );
  };

  // ---------- Tags
  function optionBadges(t) {
    return [t.match === 'substring' ? WS.badge('inside words') : null, t.strict_words && t.strict_words.length ? WS.badge(`needs: ${t.strict_words.join(', ')}`) : null, t.generic ? WS.badge('generic', 'warn') : null, t.prefix ? WS.badge(`prefix: ${t.prefix}`) : null];
  }

  async function openTagSheet(tag, folders) {
    const kws = WS.chipInput(tag ? tag.keywords : [], 'keyword, then Enter');
    const strict = WS.chipInput(tag ? tag.strict_words || [] : [], 'word, then Enter');
    const prefix = h('input', { class: 'input wide', value: (tag && tag.prefix) || '', 'aria-label': 'File prefix' });
    const picker = WS.folderPicker({ folders, hide: dupFolder(), value: tag ? tag.dest : '', onChange: (v) => (prefix.placeholder = v ? `Default: ${v.split('/').pop().replace(/-/g, ' ')}` : '') });
    const match = h('select', { class: 'select', 'aria-label': 'Match mode' }, h('option', { value: 'word', text: 'Whole words only' }), h('option', { value: 'substring', text: 'Anywhere in the name' }));
    match.value = tag ? tag.match : 'word';
    const generic = h('input', { type: 'checkbox', id: 'tag-generic' });
    generic.checked = !!(tag && tag.generic);
    const problem = h('div', { class: 'error', role: 'alert' });
    const save = h('button', { class: 'btn primary', text: 'Save' });
    save.addEventListener('click', async () => {
      problem.textContent = '';
      const spec = { keywords: kws.get(), dest: picker.get(), prefix: prefix.value.trim() || null, match: match.value, strict_words: strict.get(), generic: generic.checked };
      save.disabled = true;
      try {
        await WS.api(tag ? 'PUT' : 'POST', tag ? `/api/tags/${tag.index}` : '/api/tags', spec);
        WS.closeLayer();
        WS.toast('Tag saved. Waiting images that match are sorted now.');
        WS.refresh();
      } catch (e) {
        problem.textContent = e.message;
        save.disabled = false;
      }
    });
    const content = h(
      'div',
      {},
      h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Keywords' }), kws.el),
      h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Destination folder' }), picker.el),
      h('div', { class: 'field' }, h('label', { text: 'File prefix (optional)' }), prefix),
      h('div', { class: 'field' }, h('label', { text: 'Match' }), match),
      h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Only if one of these words is also in the name (optional)' }), strict.el),
      h('div', { class: 'field' }, h('div', { class: 'check-row' }, generic, h('label', { for: 'tag-generic', text: 'Generic folder' })), h('span', { class: 'faint', text: 'Used only when no specific tag matched and the name is short (four words or fewer).' })),
      problem
    );
    prefix.placeholder = tag ? '' : 'Default: the folder name';
    WS.openSheet(tag ? 'Edit tag' : 'Add tag', content, [h('button', { class: 'btn', text: 'Cancel', onclick: WS.closeLayer }), save]);
  }

  WS.pages.tags = async function () {
    const [tags, folders] = await Promise.all([WS.get('/api/tags'), WS.get('/api/folders')]);

    // filename tester
    const input = h('input', { class: 'input wide', id: 'tester-in', placeholder: 'Paste a filename to see where it would go', 'aria-label': 'Filename to test', value: WS.testerValue || '' });
    const out = h('div', { class: 'result' });
    let timer;
    async function run() {
      const name = input.value.trim();
      WS.testerValue = input.value;
      if (!name) return out.replaceChildren();
      try {
        const r = await WS.post('/api/tags/test', { filename: name });
        const hit = new Set(r.matched.flatMap((k) => k.toLowerCase().split(/[^a-z0-9]+/)));
        const folder = r.dest === 'INBOX' ? 'Stays in the Inbox' : r.dest === 'IGNORE' ? 'Ignored (not an image)' : r.dest;
        out.replaceChildren(
          h('div', { text: 'Words' }),
          h('div', { class: 'words' }, ...[...new Set(r.words)].map((w) => h('span', { class: 'tagchip' + (hit.has(w) ? ' hit' : ''), text: w }))),
          h('div', { text: 'Rule' }),
          h('div', { text: r.rule }),
          h('div', { text: 'Folder' }),
          h('div', { class: 'm', text: folder }),
          r.new_name ? h('div', { text: 'New name' }) : null,
          r.new_name ? h('div', { class: 'm', text: r.new_name }) : null,
          r.ignored ? h('div', { text: 'Note' }) : null,
          r.ignored ? h('div', { class: 'muted', text: r.ignored }) : null
        );
      } catch (e) {
        out.replaceChildren(h('div', { class: 'error', text: e.message }));
      }
    }
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(run, 200);
    });
    const examples = [tags[0] ? `${tags[0].keywords[0]}.png` : null, 'wallhaven-1q2le9.jpg'].filter(Boolean);
    const tester = h('div', { class: 'panel tester' }, h('h2', { text: 'Try a filename' }), h('div', { class: 'field', style: null }, input), h('div', { class: 'sugg' }, ...examples.map((x) => h('button', { type: 'button', text: x, onclick: () => { input.value = x; run(); } }))), out);
    if (input.value) run();

    // list, grouped by destination folder
    const groups = new Map();
    tags.forEach((t) => groups.set(t.dest, [...(groups.get(t.dest) || []), t]));
    const list = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dest, ts]) =>
      h(
        'div',
        {},
        h('div', { class: 'group-head' }, h('h2', { class: 'm', text: dest }), h('span', { class: 'muted', text: `files are named “${ts[0].effective_prefix} N”` })),
        ...ts.map((t) =>
          h(
            'div',
            { class: 'tagrow' },
            h('div', { class: 'kws' }, ...t.keywords.map((k) => h('span', { class: 'tagchip', text: k })), ...optionBadges(t)),
            h('button', { class: 'btn small', text: 'Edit', onclick: () => openTagSheet(t, folders) }),
            h('button', {
              class: 'btn small danger',
              text: 'Delete',
              onclick: async () => {
                if (!(await WS.confirmBox(`Delete the tag “${t.keywords.join(', ')}”? Images already sorted stay where they are.`, 'Delete tag', true))) return;
                try {
                  await WS.api('DELETE', `/api/tags/${t.index}`);
                  WS.toast('Tag deleted');
                  WS.refresh();
                } catch (e) {
                  WS.toast(e.message, { error: true });
                }
              },
            })
          )
        )
      )
    );

    return page('Tags', `${WS.plural(tags.length, 'tag')} in ${WS.plural(groups.size, 'folder')}`, h('button', { class: 'btn primary', text: 'Add tag', onclick: () => openTagSheet(null, folders) }), tester, tags.length ? list : WS.empty('No tags yet', 'A tag says which folder an image goes to when its name contains a keyword.'));
  };

  // ---------- Duplicates
  WS.pages.duplicates = async function () {
    const items = await WS.get('/api/duplicates');
    const total = items.reduce((n, i) => n + i.size, 0);
    const emptyBtn = items.length
      ? h('button', {
          class: 'btn danger',
          text: `Empty ${dupFolder()} folder`,
          onclick: async () => {
            if (!(await WS.confirmBox(`Move all ${items.length} copies (${WS.fmtBytes(total)}) to the trash? You can undo this.`, 'Move to trash', true))) return;
            try {
              const r = await WS.post('/api/duplicates/empty');
              WS.toast(`Moved ${WS.plural(r.done.length, 'copy', 'copies')} to the trash`, { undo: () => WS.undoBatch(r.batch) });
              WS.refresh();
            } catch (e) {
              WS.toast(e.message, { error: true });
            }
          },
        })
      : null;
    const rows = items.map((d) => {
      const rel = d.duplicate_of && !d.duplicate_of.startsWith('/');
      return h(
        'div',
        {},
        WS.thumb(d.hash, ''),
        h(
          'div',
          { class: 'grow' },
          h('div', { class: 'm', text: d.name }),
          h('div', { class: 'muted' }, 'Same as ', rel ? h('a', { href: `#/library?folder=${enc(WS.dirname(d.duplicate_of))}`, class: 'm', text: d.duplicate_of }) : h('span', { class: 'm', text: d.duplicate_of || 'an image in the library' }), ` · ${WS.fmtBytes(d.size)}`)
        ),
        h('button', { class: 'btn small danger', text: 'Delete', onclick: () => deleteFiles([d.path], d.name) })
      );
    });
    return page('Duplicates', items.length ? `${WS.plural(items.length, 'copy', 'copies')}, ${WS.fmtBytes(total)}` : '', emptyBtn, items.length ? h('div', { class: 'list' }, rows) : WS.empty('No duplicates', 'Copies of images you already have are moved here instead of being sorted twice.'));
  };

  // ---------- Data
  const dataQ = { q: '', site: '', folder: '', unknown: false, offset: 0 };
  const PAGE = 50;

  function openRecord(rec) {
    const site = h('select', { class: 'select', 'aria-label': 'Site' }, ...SITES.map((s) => h('option', { value: s, text: s })));
    const first = rec.sources[0];
    site.value = first ? first.site : 'Unknown';
    const id = h('input', { class: 'input', value: (first && first.id) || '', 'aria-label': 'Id on the site', placeholder: 'id on the site' });
    const save = h('button', {
      class: 'btn',
      text: 'Save source',
      onclick: async () => {
        try {
          await WS.api('PUT', '/api/origins', { hash: rec.hash, site: site.value, id: id.value.trim() });
          WS.closeLayer();
          WS.toast('Source saved');
          WS.refresh();
        } catch (e) {
          WS.toast(e.message, { error: true });
        }
      },
    });
    WS.openDetail({
      name: rec.name,
      hash: rec.hash,
      origin: rec,
      rows: [['Folder', rec.folder || 'the library folder']],
      extra: h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Set the source by hand' }), h('div', { class: 'row' }, site, id, save)),
    });
  }

  WS.pages.data = async function (params) {
    if (params.has('q')) {
      dataQ.q = params.get('q') || '';
      dataQ.offset = 0;
      history.replaceState(null, '', '#/data');
    }
    const qs = new URLSearchParams({ limit: String(PAGE), offset: String(dataQ.offset) });
    if (dataQ.q) qs.set('q', dataQ.q);
    if (dataQ.site) qs.set('site', dataQ.site);
    if (dataQ.folder) qs.set('folder', dataQ.folder);
    if (dataQ.unknown) qs.set('unknown', '1');
    const [res, unk] = await Promise.all([WS.get('/api/data?' + qs), WS.get('/api/data?unknown=1&limit=1')]);

    const change = (patch) => {
      Object.assign(dataQ, patch, { offset: 0 });
      WS.refresh();
    };
    let timer;
    const debounced = (patch) => {
      clearTimeout(timer);
      timer = setTimeout(() => change(patch), 300);
    };
    const q = h('input', { class: 'input', id: 'data-q', value: dataQ.q, placeholder: 'Search name or id', 'aria-label': 'Search', oninput: (e) => debounced({ q: e.target.value.trim() }) });
    const site = h('select', { class: 'select', 'aria-label': 'Site', onchange: (e) => change({ site: e.target.value }) }, h('option', { value: '', text: 'All sites' }), ...SITES.map((s) => h('option', { value: s, text: s })));
    site.value = dataQ.site;
    const folder = h('input', { class: 'input', id: 'data-folder', value: dataQ.folder, placeholder: 'Folder', 'aria-label': 'Folder', oninput: (e) => debounced({ folder: e.target.value.trim() }) });
    const unknown = h('button', { class: 'btn' + (dataQ.unknown ? ' primary' : ''), text: `Unknown source (${unk.total})`, 'aria-pressed': String(dataQ.unknown), onclick: () => change({ unknown: !dataQ.unknown }) });

    const rows = res.items.map((r) =>
      h(
        'tr',
        { class: 'click', tabindex: '0', onclick: () => openRecord(r), onkeydown: (e) => { if (e.key === 'Enter') openRecord(r); } },
        h('td', {}, WS.thumb(r.hash, '')),
        h('td', { class: 'm', title: r.path, text: r.name }),
        h('td', { class: 'm hide-s', text: r.folder }),
        h('td', {}, ...WS.siteBadges(r)),
        h('td', { class: 'm hide-s', title: r.original_name, text: r.original_name }),
        h('td', { class: 'm hide-s', text: r.width ? `${r.width}×${r.height}` : '' }),
        h('td', { class: 'hide-s', text: WS.fmtDateTime(r.added) })
      )
    );
    const first = res.total ? res.offset + 1 : 0;
    const last = res.offset + res.items.length;
    const pager = h('div', { class: 'row' }, h('span', { class: 'muted', text: `${first}–${last} of ${res.total}` }), h('button', { class: 'btn small', text: 'Previous', disabled: res.offset === 0, onclick: () => { dataQ.offset = Math.max(0, dataQ.offset - PAGE); WS.refresh(); } }), h('button', { class: 'btn small', text: 'Next', disabled: last >= res.total, onclick: () => { dataQ.offset += PAGE; WS.refresh(); } }));

    return page(
      'Data',
      'Where each image came from',
      null,
      h('div', { class: 'row', style: null }, q, site, folder, unknown),
      h('div', { class: 'spacer' }),
      res.total
        ? h('div', {}, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', { text: '' }), h('th', { text: 'Name' }), h('th', { class: 'hide-s', text: 'Folder' }), h('th', { text: 'Source' }), h('th', { class: 'hide-s', text: 'Original name' }), h('th', { class: 'hide-s', text: 'Size' }), h('th', { class: 'hide-s', text: 'Added' }))), h('tbody', {}, rows)), pager)
        : WS.empty('No records match', 'Every image gets a record when it arrives or when the library is first opened.')
    );
  };

  // ---------- Settings
  const GAP_TEXT = {
    keep: 'Keep gaps. The next number is the highest plus one. Nothing is renamed.',
    lowest: 'The next image takes the lowest free number. Nothing is renamed.',
    last: 'The last images are renamed into the gaps whenever an image arrives.',
    renumber: 'Everything is renumbered without gaps whenever an image arrives.',
  };

  WS.pages.settings = async function () {
    const st = await WS.get('/api/status');
    const s = st.settings;
    const gap = h('select', { class: 'select', 'aria-label': 'Gaps in the numbering', onchange: async (e) => {
      try {
        await WS.api('PUT', '/api/settings', { gap_mode: e.target.value });
        note.textContent = GAP_TEXT[e.target.value];
        WS.toast('Saved');
      } catch (err) {
        WS.toast(err.message, { error: true });
      }
    } }, h('option', { value: 'keep', text: 'Keep gaps' }), h('option', { value: 'lowest', text: 'Fill with the next image' }), h('option', { value: 'last', text: 'Move the last image into the gap' }), h('option', { value: 'renumber', text: 'Renumber everything' }));
    gap.value = s.gap_mode;
    const note = h('div', { class: 'muted', text: GAP_TEXT[s.gap_mode] });

    const theme = localStorage.getItem('ws-theme') || 'system';
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Theme' }, ...[['system', 'System'], ['dark', 'Dark'], ['light', 'Light']].map(([v, t]) => h('button', { class: theme === v ? 'on' : '', text: t, onclick: (e) => { WS.setTheme(v); [...seg.children].forEach((b) => b.classList.toggle('on', b === e.target)); } })));

    const trash = h('button', {
      class: 'btn danger',
      text: 'Empty trash',
      onclick: async () => {
        if (!(await WS.confirmBox('Permanently remove everything in the trash? This cannot be undone.', 'Remove for good', true))) return;
        try {
          const r = await WS.post('/api/trash/empty');
          WS.toast(`Removed ${WS.plural(r.removed, 'file')}`);
        } catch (e) {
          WS.toast(e.message, { error: true });
        }
      },
    });

    return page(
      'Settings',
      `version ${st.version}`,
      null,
      h('div', { class: 'panel' }, h('h2', { text: 'Numbering' }), h('div', { class: 'field' }, h('label', { text: 'Gaps in the numbering' }), gap, note)),
      h('div', { class: 'panel watched-folders' }, h('h2', { text: 'Watched folders' }), h('div', { class: 'row' }, h('span', { class: 'm', text: st.library }), WS.badge('library, top level')), ...st.intake.map((i) => h('div', { class: 'row' }, h('span', { class: 'm', text: i.path }), WS.badge('includes subfolders'), i.exists ? null : WS.badge('not found yet', 'warn'))), h('p', { class: 'faint', text: `Edit these in the config file: ${st.config_file || 'not available'}` })),
      h('div', { class: 'panel' }, h('h2', { text: 'Images' }), h('div', { class: 'row' }, ...s.image_extensions.map((e) => h('span', { class: 'tagchip', text: e }))), h('p', { class: 'faint', text: `Copies of images you already have go to the “${s.duplicates_folder}” folder.` })),
      h('div', { class: 'panel' }, h('h2', { text: 'Appearance' }), seg),
      h('div', { class: 'panel' }, h('h2', { text: 'Trash' }), h('p', { class: 'muted', text: 'Deleted images wait in a hidden folder inside the library until you empty it.' }), trash),
      h('div', { class: 'panel' }, h('h2', { text: 'This page' }), h('p', { class: 'muted' }, 'Served from ', h('span', { class: 'm', text: location.host }), ' on this computer only.'))
    );
  };
})();

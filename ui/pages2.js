'use strict';
// The remaining pages: Tags, Duplicates, Data, Settings.
(function () {
  const WS = window.WS;
  const h = WS.h;
  const { page, openAssign, deleteFiles, dupFolder, enc } = WS.ui;
  const SITES = ['Wallhaven', 'Zerochan', 'Konachan', 'yande.re', 'Danbooru', 'Safebooru', 'Pixiv', 'Unknown'];

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
      const spec = { keywords: kws.get(), dest: picker.get(), prefix: prefix.value.trim() || null, match: match.value, strict_words: strict.get(), generic: generic.checked, expected_keywords: tag ? tag.keywords : undefined, expected_dest: tag ? tag.dest : undefined };
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
          ...(r.new_name ? [h('div', { text: 'New name' }), h('div', { class: 'm', text: r.new_name })] : []),
          ...(r.ignored ? [h('div', { text: 'Note' }), h('div', { class: 'muted', text: r.ignored })] : [])
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
                  await WS.api('DELETE', `/api/tags/${t.index}`, { expected_keywords: t.keywords, expected_dest: t.dest });
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
        h('div', { class: 'row actions' }, h('button', {
          class: 'btn small',
          text: 'Restore…',
          onclick: async () => {
            const folders = (await WS.get('/api/folders')).filter((f) => f.path !== dupFolder() && !f.path.startsWith(dupFolder() + '/'));
            const picker = WS.folderPicker({ folders });
            const go = h('button', { class: 'btn primary', text: 'Restore as new image' });
            const problem = h('div', { class: 'error', role: 'alert' });
            go.onclick = async () => {
              const folder = picker.get();
              if (!folder) {
                problem.textContent = 'Choose a folder.';
                return;
              }
              go.disabled = true;
              try {
                const r = await WS.post('/api/duplicates/restore', { paths: [d.path], folder });
                WS.closeLayer();
                WS.toast(`Restored ${WS.plural(r.done.length, 'copy', 'copies')} as new images`, { undo: () => WS.undoBatch(r.batch) });
                WS.refresh();
              } catch (e) {
                problem.textContent = e.message;
                go.disabled = false;
              }
            };
            WS.openSheet('Restore duplicate', h('div', {}, h('p', { class: 'muted', text: d.name }), h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Folder' }), picker.el), problem), [h('button', { class: 'btn', text: 'Cancel', onclick: WS.closeLayer }), go]);
          },
        }), h('button', { class: 'btn small danger', text: 'Delete', onclick: () => deleteFiles([d.path], d.name) }))
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
    const pager = h('div', { class: 'row data-pager' }, h('span', { class: 'muted' }, `${first}–${last} of ${res.total}`), h('button', { class: 'btn small icon-btn', type: 'button', 'aria-label': 'Previous page', title: 'Previous page', disabled: res.offset === 0, onclick: () => { dataQ.offset = Math.max(0, dataQ.offset - PAGE); WS.refresh(); } }, WS.icon('previous')), h('button', { class: 'btn small icon-btn', type: 'button', 'aria-label': 'Next page', title: 'Next page', disabled: last >= res.total, onclick: () => { dataQ.offset += PAGE; WS.refresh(); } }, WS.icon('next')));

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
    const openIntakeSheet = (intake) => {
      const path = h('input', { class: 'input wide', value: intake ? intake.path : '', 'aria-label': 'Intake folder path', placeholder: '/absolute/path/to/downloads' });
      const recursive = h('input', { type: 'checkbox', id: 'intake-recursive' });
      recursive.checked = intake ? intake.recursive : true;
      const removeEmpty = h('input', { type: 'checkbox', id: 'intake-remove-empty' });
      removeEmpty.checked = !!(intake && intake.remove_empty_folders);
      const problem = h('div', { class: 'error', role: 'alert' });
      const save = h('button', { class: 'btn primary', text: 'Save' });
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
          WS.refresh();
        } catch (e) {
          problem.textContent = e.message;
          save.disabled = false;
        }
      });
      WS.openSheet(intake ? 'Edit intake folder' : 'Add intake folder', h('div', {},
        h('div', { class: 'field' }, h('label', { text: 'Folder path' }), path),
        h('div', { class: 'field' }, h('div', { class: 'check-row' }, recursive, h('label', { for: 'intake-recursive', text: 'Include subfolders' }))),
        h('div', { class: 'field' }, h('div', { class: 'check-row' }, removeEmpty, h('label', { for: 'intake-remove-empty', text: 'Remove empty subfolders' })), h('span', { class: 'faint', text: 'Off by default. Hidden folders are never removed.' })),
        problem
      ), [h('button', { class: 'btn', text: 'Cancel', onclick: WS.closeLayer }), save]);
    };

    const watchedEntry = (intake) => h('div', { class: 'watched-entry' },
      h('span', { class: 'm watched-path', text: intake.path }),
      h('span', { class: 'watched-badges' },
        intake.library ? WS.badge('library, top level', 'good') : (intake.watching ? WS.badge('watching', 'good') : WS.badge(intake.exists ? 'not watching' : 'folder not found yet', 'warn')),
        !intake.library && intake.recursive ? WS.badge('includes subfolders') : null,
        !intake.library && intake.remove_empty_folders ? WS.badge('removes empty folders', 'warn') : null),
      !intake.library ? h('span', { class: 'watched-actions' },
        h('button', { class: 'btn small', text: 'Edit', onclick: () => openIntakeSheet(intake) }),
        h('button', { class: 'btn small danger', text: 'Remove', onclick: async () => {
          if (!(await WS.confirmBox(`Stop watching ${intake.path}?`, 'Remove', true))) return;
          try {
            await WS.api('DELETE', `/api/intake/${intake.index}`);
            WS.toast('Intake folder removed');
            WS.refresh();
          } catch (e) {
            WS.toast(e.message, { error: true });
          }
        } })) : null,
      intake.error ? h('p', { class: 'error watched-error', text: intake.error }) : null);

    const addIntake = h('button', { class: 'btn small', text: 'Add folder', onclick: () => openIntakeSheet(null) });

    return page(
      'Settings',
      `version ${st.version}`,
      null,
      h('div', { class: 'panel' }, h('h2', { text: 'Numbering' }), h('div', { class: 'field' }, h('label', { text: 'Gaps in the numbering' }), gap, note)),
      h('div', { class: 'panel watched-folders' }, h('h2', { text: 'Watched folders' }), h('div', { class: 'watched-list' }, watchedEntry({ library: true, path: st.library }), ...st.intake.map((i) => watchedEntry(i))), h('div', { class: 'watched-footer' }, addIntake)),
      h('div', { class: 'panel' }, h('h2', { text: 'Images' }), h('div', { class: 'row' }, ...s.image_extensions.map((e) => h('span', { class: 'tagchip', text: e }))), h('p', { class: 'faint', text: `Copies of images you already have go to the “${s.duplicates_folder}” folder.` })),
      h('div', { class: 'panel' }, h('h2', { text: 'Appearance' }), seg),
      h('div', { class: 'panel' }, h('h2', { text: 'Trash' }), h('p', { class: 'muted', text: 'Deleted images wait in a hidden folder inside the library until you empty it.' }), trash),
      h('div', { class: 'panel' }, h('h2', { text: 'This page' }), h('p', { class: 'muted' }, 'Served from ', h('span', { class: 'm', text: location.host }), ' on this computer only.'))
    );
  };
})();

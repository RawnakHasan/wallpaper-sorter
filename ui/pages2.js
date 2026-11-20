'use strict';
// The remaining pages: Tags and Data.
(function () {
  const WS = window.WS;
  const h = WS.h;
  const { page } = WS.ui;
  const SITES = ['Wallhaven', 'Zerochan', 'Konachan', 'yande.re', 'Danbooru', 'Safebooru', 'Pixiv', 'Unknown'];

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

})();

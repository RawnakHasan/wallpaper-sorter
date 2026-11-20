'use strict';
// Drives the real program (the compiled binary) and its page in jsdom, the way a person would.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { JSDOM } = require('jsdom');

const BIN = process.env.SORTER_BIN || path.join(__dirname, '../../target/debug/wallpaper-sorter');
const STARTER = path.join(__dirname, '../../spec/tags.starter.toml');

// ---------- a minimal valid PNG, different for every seed
const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(seed, w = 64, h = 36) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) {
    row[1 + x * 3] = (x * 3 + seed) % 256;
    row[2 + x * 3] = (seed * 7) % 256;
    row[3 + x * 3] = 120;
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
let seedCounter = 1;
function put(file, seed) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png(seed || seedCounter++));
}

// ---------- start the program on a temporary library
async function startSorter(prep) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-ui-'));
  const lib = path.join(base, 'lib');
  const intake = path.join(base, 'pixiv');
  fs.mkdirSync(lib);
  fs.mkdirSync(intake);
  prep(lib, intake);
  const text = fs
    .readFileSync(STARTER, 'utf8')
    .replace('library = "~/Pictures/Wallpapers"', `library = "${lib}"`)
    .replace('path = "~/Downloads/pixiv"', `path = "${intake}"`);
  const cfg = path.join(base, 'config.toml');
  fs.writeFileSync(cfg, text);
  const child = spawn(BIN, ['--config', cfg, '--port', '0'], { env: { ...process.env, XDG_CACHE_HOME: path.join(base, 'cache') } });
  const url = await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      const m = buf.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (m) resolve(m[0]);
    });
    child.stderr.on('data', (d) => (buf += d));
    child.on('exit', (c) => reject(new Error(`program exited (${c}): ${buf}`)));
    setTimeout(() => reject(new Error('program did not start: ' + buf)), 15000);
  });
  return {
    base, lib, intake, cfg, url,
    stop() {
      child.kill('SIGINT');
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = fn();
      if (last) return last;
    } catch (e) {
      /* not there yet */
    }
    await sleep(25);
  }
  throw new Error('timed out waiting for ' + what);
}

async function fetchText(sorter, path) {
  const res = await fetch(new URL(path, sorter.url));
  assert.ok(res.ok, `GET ${path} returned ${res.status}`);
  return res.text();
}

async function openPage(sorter, hash) {
  // Use Node's fetch for every request. jsdom's HTTP resource loader sometimes
  // receives ECONNRESET while it is loading the deferred scripts from tiny_http.
  // This still runs the real document and scripts, in their browser order.
  const html = await fetchText(sorter, '/');
  const scriptSources = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi)].map((m) => m[1]);
  const documentHtml = html.replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>\s*/gi, '');
  const dom = new JSDOM(documentHtml, {
    url: sorter.url + (hash || ''),
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (u, init) => fetch(new URL(u, w.location.href).href, init);
      w.scrollTo = () => {};
    },
  });
  const w = dom.window;
  const pendingRequests = new Set();
  const d = w.document;
  w.fetch = (u, init) => {
    const request = fetch(new URL(u, w.location.href).href, init);
    pendingRequests.add(request);
    request.then(() => pendingRequests.delete(request), () => pendingRequests.delete(request));
    return request;
  };
  for (const source of scriptSources) w.eval(await fetchText(sorter, source));
  const ui = {
    dom, w, d,
    q: (sel, root) => (root || d).querySelector(sel),
    qa: (sel, root) => [...(root || d).querySelectorAll(sel)],
    byText: (sel, text, root) => [...(root || d).querySelectorAll(sel)].find((e) => e.textContent.trim() === text || e.textContent.trim().startsWith(text)),
    click(el, init) {
      assert.ok(el, 'element to click exists');
      el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, ...(init || {}) }));
    },
    type(el, value) {
      el.value = value;
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
    },
    key(el, key, init) {
      el.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...(init || {}) }));
    },
    toast: () => (ui.q('#toast') && !ui.q('#toast').hidden ? ui.q('#toast').textContent : ''),
    go(hash) {
      w.location.hash = hash;
    },
    async close() {
      w.dispatchEvent(new w.Event('pagehide'));
      for (let i = 0; i < 20 && pendingRequests.size; i++) {
        await Promise.allSettled([...pendingRequests]);
        await sleep(5);
      }
      w.close();
    },
  };
  await waitFor(() => ui.q('#main .page'), 'the first page');
  return ui;
}

const api = (s, method, p, body) =>
  fetch(s.url + p.replace(/^\//, ''), { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }).then((r) => r.json());

async function withSorter(prep, hash, fn) {
  const s = await startSorter(prep);
  let ui;
  try {
    ui = await openPage(s, hash);
    await fn(ui, s);
  } finally {
    if (ui) await ui.close();
    s.stop();
  }
}

// ---------- the tests
test('the overview shows counts, the menu and the connection', () =>
  withSorter(
    (lib) => {
      put(path.join(lib, 'Wuthering-Waves/Chisa/Chisa 1.png'));
      put(path.join(lib, 'wallhaven-1q2le9.png'));
    },
    '',
    async (ui) => {
      assert.equal(ui.qa('.rail .nv').length, 9);
      await waitFor(() => ui.qa('.stat').length === 4, 'the four counts');
      const stats = ui.qa('.stat').map((s) => s.textContent);
      assert.match(stats[0], /1.*waiting in the Inbox/);
      assert.match(stats[1], /2.*images in the library/);
      await waitFor(() => ui.q('.status').textContent.includes('Watching'), 'the connection chip');
      await waitFor(() => ui.q('#inbox-count').textContent === '1', 'the inbox badge');
    }
  ));

test('inbox: select an image, assign it to a folder, undo', () =>
  withSorter(
    (lib) => {
      put(path.join(lib, 'wallhaven-1q2le9.png'));
      put(path.join(lib, 'wallhaven-2zzzzz.png'));
    },
    '#/inbox',
    async (ui, s) => {
      await waitFor(() => ui.qa('.cell').length === 2, 'two images');
      assert.equal(ui.q('.selbar').hidden, true);
      ui.click(ui.qa('.cell')[0]);
      assert.match(ui.q('.selbar').textContent, /1 selected/);
      ui.click(ui.byText('.selbar button', 'Assign to folder'));
      const sheet = await waitFor(() => ui.q('.sheet'), 'the assign sheet');
      const folder = ui.q('input[aria-label="Folder"]', sheet);
      ui.type(folder, 'Nature');
      assert.match(ui.q('.preview-line', sheet).textContent, /Nature 1\.png/);
      ui.click(ui.byText('footer button', 'Assign', sheet));
      await waitFor(() => /Moved 1 image to Nature/.test(ui.toast()), 'the confirmation');
      assert.equal((await api(s, 'GET', '/api/images?folder=Nature')).length, 1);
      await waitFor(() => ui.qa('.cell').length === 1, 'one image left in the inbox');

      ui.click(ui.byText('#toast button', 'Undo'));
      await waitFor(() => ui.qa('.cell').length === 2, 'both back in the inbox');
      assert.equal((await api(s, 'GET', '/api/images?folder=Nature')).length, 0);
    }
  ));

test('inbox: saving a tag with the assignment sorts the other waiting images too', () =>
  withSorter(
    (lib) => {
      put(path.join(lib, 'Violet Evergarden.png'));
      put(path.join(lib, 'Violet.full.1234.png'));
    },
    '#/inbox',
    async (ui, s) => {
      await waitFor(() => ui.qa('.cell').length === 2, 'two images');
      ui.click(ui.byText('.cell', 'Violet Evergarden') || ui.qa('.cell')[0]);
      ui.click(ui.byText('.selbar button', 'Assign to folder'));
      const sheet = await waitFor(() => ui.q('.sheet'), 'the sheet');
      ui.type(ui.q('input[aria-label="Folder"]', sheet), 'Series/Violet');
      const box = ui.q('#also-tag', sheet);
      box.checked = true;
      box.dispatchEvent(new ui.w.Event('change', { bubbles: true }));
      const chips = ui.q('.chip-in', sheet);
      ui.type(chips, 'violet');
      ui.key(chips, 'Enter');
      assert.ok(ui.byText('.tagchip', 'violet', sheet), 'the keyword became a chip');
      ui.click(ui.byText('footer button', 'Assign', sheet));
      await waitFor(() => /Moved 1 image/.test(ui.toast()), 'the confirmation');
      await waitFor(() => ui.q('.empty') && /Inbox clear/.test(ui.q('.empty').textContent), 'an empty inbox: the new tag sorted the other file');
      assert.equal((await api(s, 'GET', '/api/images?folder=Series/Violet')).length, 2);
      assert.match(fs.readFileSync(s.cfg, 'utf8'), /keywords = \["violet"\]/);
    }
  ));

test('inbox: a file name is shown as text, never as HTML', () =>
  withSorter(
    (lib) => put(path.join(lib, '<img src=x onerror=alert(1)> & "quotes".png')),
    '#/inbox',
    async (ui) => {
      const cell = await waitFor(() => ui.q('.cell'), 'the image');
      assert.equal(ui.qa('.grid [onerror]').length, 0, 'no element was made from the name');
      assert.ok(cell.textContent.includes('<img src=x onerror=alert(1)> & "quotes".png'));
      assert.equal(cell.getAttribute('aria-label'), '<img src=x onerror=alert(1)> & "quotes".png');
    }
  ));

test('inbox: keyboard shortcuts select everything and clear it', () =>
  withSorter(
    (lib) => {
      for (const n of ['wallhaven-aaaaaa.png', 'wallhaven-bbbbbb.png', 'wallhaven-cccccc.png']) put(path.join(lib, n));
    },
    '#/inbox',
    async (ui) => {
      await waitFor(() => ui.qa('.cell').length === 3, 'three images');
      ui.key(ui.d.body, 'a', { ctrlKey: true });
      assert.match(ui.q('.selbar').textContent, /3 selected/);
      ui.key(ui.d.body, 'Escape');
      await waitFor(() => ui.q('.selbar').hidden, 'the selection to clear');
      ui.click(ui.qa('.cell')[0]);
      ui.click(ui.qa('.cell')[2], { shiftKey: true });
      assert.match(ui.q('.selbar').textContent, /3 selected/, 'shift-click selects the range');
    }
  ));

test('inbox: files in the intake folder wait there with their artist', () =>
  withSorter(
    (lib, intake) => put(path.join(intake, 'BLACKmeow-91709880/151861634_p0--.png')),
    '#/inbox',
    async (ui) => {
      const cell = await waitFor(() => ui.q('.cell'), 'the Pixiv image');
      assert.match(cell.textContent, /Pixiv/);
      ui.click(ui.q('.open', cell));
      const sheet = await waitFor(() => ui.q('.sheet'), 'the details');
      assert.match(sheet.textContent, /BLACKmeow \(91709880\)/);
      const link = ui.q('a[href^="https://www.pixiv.net/artworks/151861634"]', sheet);
      assert.ok(link && link.rel.includes('noopener'));
    }
  ));

test('tags: the filename tester follows the rules', () =>
  withSorter(() => {}, '#/tags', async (ui) => {
    const input = await waitFor(() => ui.q('#tester-in'), 'the tester');
    ui.type(input, 'Chisa Skadi.png');
    await waitFor(() => /Conflict/.test(ui.q('.tester .result').textContent), 'the conflict');
    assert.match(ui.q('.tester .result').textContent, /Stays in the Inbox/);
    ui.type(input, 'Chisa waterfall.png');
    await waitFor(() => /Specific beats generic/.test(ui.q('.tester .result').textContent), 'the generic rule');
    assert.match(ui.q('.tester .result').textContent, /Wuthering-Waves\/Chisa/);
    assert.match(ui.q('.tester .result').textContent, /Chisa 1\.png/);
    assert.doesNotMatch(ui.q('.tester .result').textContent, /\bnull\b/);
    assert.ok(ui.byText('.tester .tagchip.hit', 'chisa'), 'the word that matched is marked');
    ui.type(input, 'Lily.png');
    await waitFor(() => /Wuthering-Waves\/Lily/.test(ui.q('.tester .result').textContent), 'the new character tag');
    assert.match(ui.q('.tester .result').textContent, /Lily 1\.png/);
    ui.type(input, 'wallhaven-1q2le9.png');
    await waitFor(() => /No match/.test(ui.q('.tester .result').textContent), 'a no-match filename');
    assert.doesNotMatch(ui.q('.tester .result').textContent, /\bnull\b/);
  }));

test('tags: add a tag and delete it again', () =>
  withSorter(() => {}, '#/tags', async (ui, s) => {
    await waitFor(() => ui.byText('button', 'Add tag'), 'the Add tag button');
    ui.click(ui.byText('button', 'Add tag'));
    const sheet = await waitFor(() => ui.q('.sheet'), 'the sheet');
    const kw = ui.q('.chip-in', sheet);
    ui.type(kw, 'lumi');
    ui.key(kw, 'Enter');
    ui.type(ui.q('input[aria-label="Folder"]', sheet), 'Originals/Lumi');
    ui.click(ui.byText('footer button', 'Save', sheet));
    await waitFor(() => /Tag saved/.test(ui.toast()), 'the confirmation');
    await waitFor(() => ui.byText('.group-head h2', 'Originals/Lumi'), 'the new group');
    assert.match(fs.readFileSync(s.cfg, 'utf8'), /Originals\/Lumi/);

    const row = ui.qa('.tagrow').find((r) => r.textContent.includes('lumi'));
    ui.click(ui.byText('button', 'Delete', row));
    const dialog = await waitFor(() => ui.q('.dialog'), 'the confirmation dialog');
    ui.click(ui.byText('button', 'Delete tag', dialog));
    await waitFor(() => !ui.byText('.group-head h2', 'Originals/Lumi'), 'the group to go');
  }));

test('tags: a bad folder is explained, not silently ignored', () =>
  withSorter(() => {}, '#/tags', async (ui) => {
    await waitFor(() => ui.byText('button', 'Add tag'), 'the button');
    ui.click(ui.byText('button', 'Add tag'));
    const sheet = await waitFor(() => ui.q('.sheet'), 'the sheet');
    const kw = ui.q('.chip-in', sheet);
    ui.type(kw, 'x');
    ui.key(kw, 'Enter');
    ui.type(ui.q('input[aria-label="Folder"]', sheet), '../escape');
    ui.click(ui.byText('footer button', 'Save', sheet));
    await waitFor(() => ui.q('[role="alert"]', sheet).textContent.length > 0, 'an error message');
    assert.ok(ui.q('.sheet'), 'the sheet stays open');
  }));

test('library: browse a folder and close the gaps', () =>
  withSorter(
    (lib) => {
      for (const n of [1, 3, 4]) put(path.join(lib, `Wuthering-Waves/Chisa/Chisa ${n}.png`));
    },
    '#/library?folder=Wuthering-Waves%2FChisa',
    async (ui, s) => {
      await waitFor(() => ui.qa('.cell').length === 3, 'three images');
      assert.equal(ui.q('.more').textContent, '', 'no literal null after the final image chunk');
      assert.equal(ui.q('.cell img').alt, 'Chisa 1.png');
      assert.ok(ui.q('.cell').classList.contains('loading'));
      assert.ok(ui.q('#main.library-scroll-shell .tree'), 'the folder tree has its own scroll region');
      assert.ok(ui.q('#main.library-scroll-shell .grid-scroll'), 'the thumbnail list has its own scroll region');
      ui.q('.cell img').dispatchEvent(new ui.w.Event('load'));
      assert.equal(ui.q('.cell').classList.contains('loading'), false);
      const details = ui.q('.cell .open');
      assert.match(details.getAttribute('aria-label'), /^Details of /);
      assert.ok(details.querySelector('svg[aria-hidden="true"]'), 'details uses an accessible icon button');
      const css = await fetchText(s, '/assets/app.css');
      assert.match(css, /\.cell \.open\{[^}]*top:\s*4px/);
      assert.match(css, /\.cell \.check\{[^}]*right:\s*34px/);
      assert.match(css, /\.cell img\{[^}]*object-fit:\s*contain/);
      assert.match(css, /\.cell\.loading\{[^}]*animation:thumb-shimmer/);
      assert.match(css, /@keyframes thumb-shimmer/);
      assert.match(css, /prefers-reduced-motion:reduce[^}]*\.cell\.loading\{animation:none\}/);
      assert.match(css, /\.library-scroll-shell \.grid-scroll\{[^}]*overflow:auto/);
      assert.match(ui.q('.facts').textContent, /Prefix\s*Chisa/);
      assert.match(ui.q('.facts').textContent, /Next number\s*5/);
      assert.match(ui.q('.facts').textContent, /Gaps\s*1 \(2\)/);
      ui.click(ui.byText('button', 'Close gaps'));
      const sheet = await waitFor(() => ui.q('.sheet'), 'the sheet');
      await waitFor(() => /Chisa 4\.png → Chisa 2\.png/.test(sheet.textContent), 'the preview of renames');
      assert.doesNotMatch(sheet.textContent, /\bnull\b/);
      ui.click(ui.byText('footer button', 'Apply', sheet));
      await waitFor(() => /Renamed 1 file/.test(ui.toast()), 'the confirmation');
      const names = (await api(s, 'GET', '/api/images?folder=Wuthering-Waves/Chisa')).map((i) => i.name);
      assert.deepEqual(names, ['Chisa 1.png', 'Chisa 2.png', 'Chisa 3.png']);
      await waitFor(() => !ui.byText('button', 'Close gaps'), 'the button to go once there are no gaps');
    }
  ));

test('thumbnails can be rebuilt from details or the selection toolbar', () =>
  withSorter(
    (lib) => {
      put(path.join(lib, 'Nature/Nature 1.png'));
      put(path.join(lib, 'Nature/Nature 2.png'));
    },
    '#/library?folder=Nature',
    async (ui, s) => {
      await waitFor(() => ui.qa('.cell').length === 2, 'two library images');
      const images = await api(s, 'GET', '/api/images?folder=Nature');
      ui.click(ui.qa('.cell')[0]);
      ui.click(ui.qa('.cell')[1]);
      ui.click(ui.byText('button', 'Rebuild thumbnails'));
      await waitFor(() => ui.toast().includes('Rebuilt 2 thumbnails'), 'selected thumbnail rebuild');
      for (const image of images) {
        assert.ok(fs.existsSync(path.join(s.base, 'cache/wallpaper-sorter/thumbs', `${image.hash}.jpg`)));
      }

      const cache = path.join(s.base, 'cache/wallpaper-sorter/thumbs', `${images[0].hash}.jpg`);
      fs.writeFileSync(cache, 'stale thumbnail');
      ui.click(ui.q('.cell .open'));
      const sheet = await waitFor(() => ui.q('.sheet'), 'image details');
      ui.click(ui.byText('footer button', 'Rebuild thumbnail', sheet));
      await waitFor(() => ui.toast().includes('Rebuilt 1 thumbnail'), 'details thumbnail rebuild');
      assert.deepEqual(fs.readFileSync(cache).subarray(0, 2), Buffer.from([0xff, 0xd8]));
      assert.match(ui.q('.cell img').getAttribute('src'), /\?v=/);
    }
  ));

test('thumbnail loading retries busy responses and labels unsupported formats', () =>
  withSorter(
    () => {},
    '',
    async (ui) => {
      let requests = 0;
      let unsupported = false;
      const revoked = [];
      ui.w.URL.createObjectURL = () => 'blob:thumbnail';
      ui.w.URL.revokeObjectURL = (url) => revoked.push(url);
      ui.w.fetch = async () => {
        requests++;
        if (unsupported) return new Response('', { status: 415 });
        if (requests === 1) return new Response('', { status: 503, headers: { 'Retry-After': '0' } });
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
      };

      const retrying = ui.w.WS.thumb('a'.repeat(64), 'Chisa 6.jpg');
      ui.d.body.append(retrying);
      retrying.dispatchEvent(new ui.w.Event('error'));
      await waitFor(() => retrying.src === 'blob:thumbnail', 'thumbnail retry after a busy response');
      assert.equal(requests, 2);
      retrying.dispatchEvent(new ui.w.Event('load'));
      assert.deepEqual(revoked, ['blob:thumbnail']);

      unsupported = true;
      const failed = ui.w.WS.thumb('b'.repeat(64), 'wallpaper.avif');
      ui.d.body.append(failed);
      failed.dispatchEvent(new ui.w.Event('error'));
      await waitFor(() => ui.q('.thumb-placeholder'), 'unsupported format placeholder');
      assert.equal(ui.q('.thumb-placeholder').textContent, 'AVIF');
    }
  ));

test('library: shows image counts grouped by source', () =>
  withSorter(
    (lib) => {
      put(path.join(lib, 'Wuthering-Waves/Chisa/wallhaven-1q2le9.png'));
      put(path.join(lib, 'Wuthering-Waves/Chisa/Kuchiba.Chisa.full.4511113.png'));
      put(path.join(lib, 'Wuthering-Waves/Chisa/opaque-hash.png'));
    },
    '#/library?folder=Wuthering-Waves%2FChisa',
    async (ui) => {
      await waitFor(() => ui.qa('.cell').length === 3, 'three images');
      const counts = ui.q('.source-counts');
      assert.ok(counts, 'source summary is shown in the folder header');
      assert.match(counts.textContent, /Wallhaven\s*1/);
      assert.match(counts.textContent, /Zerochan\s*1/);
      assert.match(counts.textContent, /Unknown\s*1/);
    }
  ));

test('library: create folders and manage prefix, rename, and merge', () =>
  withSorter(
    (lib) => {
      put(path.join(lib, 'Nature/Nature 1.png'));
      put(path.join(lib, 'Archive/old.png'));
    },
    '#/library?folder=Nature',
    async (ui, s) => {
      await waitFor(() => ui.qa('.cell').length === 1, 'the Nature image');
      ui.click(ui.byText('button', 'New folder'));
      let sheet = await waitFor(() => ui.q('.sheet'), 'the create folder sheet');
      ui.type(ui.q('input[aria-label="New folder path"]', sheet), 'Originals/Empty');
      ui.click(ui.byText('footer button', 'Create folder', sheet));
      await waitFor(() => (ui.q('.page') || {}).textContent.includes('No images'), 'the empty folder page');
      assert.equal((await api(s, 'GET', '/api/folders')).some((f) => f.path === 'Originals/Empty'), true);
      ui.click(ui.byText('button', 'Manage folder'));
      sheet = await waitFor(() => ui.q('.sheet'), 'empty folder management sheet');
      ui.click(ui.byText('button', 'Preview prefix', sheet));
      await waitFor(() => /0 files will change/.test(ui.qa('.folder-preview', sheet)[2].textContent), 'empty prefix preview');
      assert.doesNotMatch(ui.qa('.folder-preview', sheet)[2].textContent, /\bnull\b/);
      ui.click(ui.byText('footer button', 'Done', sheet));

      ui.go('#/library?folder=Nature');
      await waitFor(() => ui.q('.page-head h1').textContent === 'Nature', 'Nature folder');
      ui.click(ui.byText('button', 'Manage folder'));
      sheet = await waitFor(() => ui.q('.sheet'), 'the folder management sheet');
      ui.type(ui.q('input[aria-label="File prefix"]', sheet), 'Scenery');
      ui.click(ui.byText('button', 'Preview prefix', sheet));
      const prefixPreview = () => ui.qa('.folder-preview', sheet)[2];
      await waitFor(() => prefixPreview().textContent, 'prefix preview');
      assert.match(prefixPreview().textContent, /1 file will change/);
      assert.doesNotMatch(prefixPreview().textContent, /\bnull\b/);
      ui.click(ui.byText('button', 'Save prefix', sheet));
      let dialog = await waitFor(() => ui.q('.dialog'), 'prefix confirmation');
      ui.click(ui.byText('button', 'Save prefix', dialog));
      await waitFor(() => /Prefix changed/.test(ui.toast()), 'prefix update');
      assert.ok(fs.existsSync(path.join(s.lib, 'Nature/Scenery 1.png')));
      ui.click(ui.byText('#toast button', 'Undo'));
      await waitFor(() => fs.existsSync(path.join(s.lib, 'Nature/Nature 1.png')), 'prefix undo');

      ui.click(ui.byText('button', 'Manage folder'));
      sheet = await waitFor(() => ui.q('.sheet'), 'the folder management sheet');
      ui.type(ui.q('input[aria-label="File prefix"]', sheet), 'Scenery');
      ui.click(ui.byText('button', 'Preview prefix', sheet));
      await waitFor(() => /1 file will change/.test(ui.qa('.folder-preview', sheet)[2].textContent), 'prefix preview again');
      ui.click(ui.byText('button', 'Save prefix', sheet));
      dialog = await waitFor(() => ui.q('.dialog'), 'prefix confirmation again');
      ui.click(ui.byText('button', 'Save prefix', dialog));
      await waitFor(() => fs.existsSync(path.join(s.lib, 'Nature/Scenery 1.png')), 'prefix reapply');

      ui.click(ui.byText('button', 'Manage folder'));
      sheet = await waitFor(() => ui.q('.sheet'), 'the folder management sheet');
      ui.type(ui.q('input[aria-label="New folder path"]', sheet), 'Nature-Scenes');
      ui.click(ui.byText('button', 'Preview rename', sheet));
      await waitFor(() => /Nature → Nature-Scenes/.test(ui.q('.folder-preview', sheet).textContent), 'rename preview');
      ui.click(ui.byText('button', 'Rename folder', sheet));
      dialog = await waitFor(() => ui.q('.dialog'), 'rename confirmation');
      ui.click(ui.byText('button', 'Rename folder', dialog));
      await waitFor(() => /Renamed Nature/.test(ui.toast()), 'rename update');
      assert.ok(fs.existsSync(path.join(s.lib, 'Nature-Scenes/Scenery 1.png')));

      await waitFor(() => ui.q('.page-head h1').textContent === 'Nature-Scenes', 'the renamed folder page');
      ui.click(ui.byText('button', 'Manage folder'));
      sheet = await waitFor(() => ui.q('.sheet'), 'the folder management sheet');
      ui.q('select[aria-label="Merge destination"]', sheet).value = 'Archive';
      ui.click(ui.byText('button', 'Preview merge', sheet));
      await waitFor(() => /1 file will change/.test(ui.qa('.folder-preview', sheet)[1].textContent), 'merge preview');
      ui.click(ui.byText('button', 'Merge folders', sheet));
      dialog = await waitFor(() => ui.q('.dialog'), 'merge confirmation');
      ui.click(ui.byText('button', 'Merge folders', dialog));
      await waitFor(() => /Merged Nature-Scenes/.test(ui.toast()), 'merge update');
      assert.ok(fs.existsSync(path.join(s.lib, 'Archive/Archive 1.png')));
      await waitFor(() => ui.q('.page-head h1').textContent === 'Archive', 'the merge destination page');
    }
  ));

test('library: delete asks first, goes to the trash, and can be undone', () =>
  withSorter(
    (lib) => {
      put(path.join(lib, 'Nature/Nature 1.png'));
      put(path.join(lib, 'Nature/Nature 2.png'));
    },
    '#/library?folder=Nature',
    async (ui, s) => {
      await waitFor(() => ui.qa('.cell').length === 2, 'two images');
      ui.click(ui.qa('.cell')[0]);
      ui.click(ui.byText('.selbar button', 'Delete'));
      const dialog = await waitFor(() => ui.q('.dialog'), 'the confirmation');
      assert.match(dialog.textContent, /trash and can be undone/);
      ui.click(ui.byText('button', 'Cancel', dialog));
      assert.equal(ui.qa('.cell').length, 2, 'cancel changes nothing');
      ui.click(ui.byText('.selbar button', 'Delete'));
      ui.click(ui.byText('.dialog button', 'Delete'));
      await waitFor(() => /Deleted 1 image/.test(ui.toast()), 'the confirmation');
      await waitFor(() => ui.qa('.cell').length === 1, 'one image left');
      ui.click(ui.byText('#toast button', 'Undo'));
      await waitFor(() => ui.qa('.cell').length === 2, 'both back');
      assert.equal((await api(s, 'GET', '/api/images?folder=Nature')).length, 2);
    }
  ));

test('re-sort: previews a folder, applies it, and offers batch undo', () =>
  withSorter(
    (lib) => {
      put(path.join(lib, 'Archive/Chisa original.png'));
      put(path.join(lib, 'Archive/mystery.png'));
      put(path.join(lib, 'Wuthering-Waves/Chisa/Chisa 1.png'));
    },
    '#/resort',
    async (ui, s) => {
      const scope = await waitFor(() => ui.q('select[aria-label="Re-sort scope"]'), 'the scope picker');
      scope.value = 'Archive';
      scope.dispatchEvent(new ui.w.Event('change', { bubbles: true }));
      await waitFor(() => ui.byText('button', 'Scan and preview'), 'the preview button');
      ui.click(ui.byText('button', 'Scan and preview'));
      await waitFor(() => ui.q('.resort-summary') || ui.toast(), 'the re-sort response');
      assert.ok(ui.q('.resort-summary'), ui.toast());
      await waitFor(() => /1 change ready/.test(ui.q('.resort-summary').textContent), 'the re-sort preview');
      assert.doesNotMatch(ui.q('.resort-output').textContent, /\bnull\b/);
      assert.match(ui.q('.resort-list').textContent, /Chisa 2\.png/);
      assert.match(ui.q('.resort-output').textContent, /1 no match/);
      assert.doesNotMatch(ui.q('.resort-output').textContent, /Needs a decision/);
      assert.ok(fs.existsSync(path.join(s.lib, 'Archive/Chisa original.png')), 'preview does not move the file');
      ui.click(ui.byText('.resort-summary button', 'Apply 1 change'));
      const dialog = await waitFor(() => ui.q('.dialog'), 'the confirmation');
      ui.click(ui.byText('button', 'Apply re-sort', dialog));
      await waitFor(() => /Re-sorted 1 file/.test(ui.toast()), 'the confirmation toast');
      assert.ok(fs.existsSync(path.join(s.lib, 'Wuthering-Waves/Chisa/Chisa 2.png')));
      const beforeUndoRefresh = ui.q('.resort-output');
      ui.click(ui.byText('#toast button', 'Undo'));
      await waitFor(() => fs.existsSync(path.join(s.lib, 'Archive/Chisa original.png')), 'the batch undo');
      await waitFor(() => ui.q('.resort-output') !== beforeUndoRefresh, 'the restored Re-sort page');
    }
  ));

test('re-sort: unmatched files are counted without rendering an unbounded list', () =>
  withSorter(
    (lib) => {
      for (let n = 0; n < 300; n++) {
        const file = path.join(lib, `wallhaven-${String(n).padStart(6, '0')}.png`);
        put(file);
        fs.appendFileSync(file, String(n));
      }
    },
    '#/resort',
    async (ui) => {
      ui.click(await waitFor(() => ui.byText('button', 'Scan and preview'), 'the preview button'));
      const summary = await waitFor(() => ui.q('.resort-summary'), 'the re-sort response');
      assert.match(summary.textContent, /300 no match/);
      assert.ok(ui.qa('.resort-row').length < 250, 'unmatched files are not all rendered');
    }
  ));

test('duplicates: a copy is listed with its original and can be cleared', () =>
  withSorter(
    (lib) => {
      put(path.join(lib, 'Wuthering-Waves/Chisa/Chisa 1.png'), 77);
      put(path.join(lib, 'Chisa copy.png'), 77);
    },
    '#/duplicates',
    async (ui) => {
      const row = await waitFor(() => ui.q('.list > div'), 'the copy');
      assert.match(row.textContent, /Chisa copy\.png/);
      assert.match(row.textContent, /Same as Wuthering-Waves\/Chisa\/Chisa 1\.png/);
      const original = ui.q('a', row);
      assert.ok(original);
      assert.match(original.getAttribute('href'), /#\/library\?folder=Wuthering-Waves%2FChisa$/);
      ui.click(ui.byText('button', 'Restore…', row));
      const sheet = await waitFor(() => ui.q('.sheet'), 'the restore sheet');
      const folder = sheet.querySelector('input[aria-label="Folder"]');
      ui.type(folder, 'Wuthering-Waves/Chisa');
      ui.click(ui.byText('button', 'Restore as new image', sheet));
      await waitFor(() => ui.q('.empty') && /No duplicates/.test(ui.q('.empty').textContent), 'an empty list');
    }
  ));

test('duplicates: deleting one or emptying the folder can be undone', () =>
  withSorter(
    (lib) => {
      put(path.join(lib, 'Wuthering-Waves/Chisa/Chisa 1.png'), 91);
      put(path.join(lib, 'Chisa copy.png'), 91);
    },
    '#/duplicates',
    async (ui) => {
      let row = await waitFor(() => ui.q('.list > div'), 'the duplicate');
      ui.click(ui.byText('button', 'Delete', row));
      let dialog = await waitFor(() => ui.q('.dialog'), 'delete confirmation');
      ui.click(ui.byText('button', 'Delete', dialog));
      await waitFor(() => ui.q('.empty') && /No duplicates/.test(ui.q('.empty').textContent), 'the empty duplicate view');
      ui.click(ui.byText('#toast button', 'Undo'));
      row = await waitFor(() => ui.q('.list > div'), 'the restored duplicate');

      ui.click(ui.byText('button', 'Empty Duplicates folder'));
      dialog = await waitFor(() => ui.q('.dialog'), 'empty-folder confirmation');
      ui.click(ui.byText('button', 'Move to trash', dialog));
      await waitFor(() => /Moved 1 copy to the trash/.test(ui.toast()), 'the empty-folder result');
      await waitFor(() => ui.q('.empty') && /No duplicates/.test(ui.q('.empty').textContent), 'the cleared duplicate view');
      ui.click(ui.byText('#toast button', 'Undo'));
      await waitFor(() => ui.qa('.list > div').length === 1, 'the duplicate restored from trash');
    }
  ));

test('data: filter, find unknown sources and set one by hand', () =>
  withSorter(
    (lib) => {
      put(path.join(lib, 'wallhaven-1q2le9.png'));
      put(path.join(lib, 'Arknights/Skadi/Skadi 1.png'));
      put(path.join(lib, 'Wuthering-Waves/Chisa/Chisa 1.png'));
    },
    '#/data',
    async (ui, s) => {
      await waitFor(() => ui.qa('.tbl tbody tr').length === 3, 'three records');
      const pager = ui.q('.data-pager');
      assert.ok(pager, 'data pager has its own layout spacing');
      assert.ok(ui.q('button[aria-label="Previous page"] svg', pager));
      assert.ok(ui.q('button[aria-label="Next page"] svg', pager));
      const css = await fetchText(s, '/assets/app.css');
      assert.match(css, /\.data-pager\{[^}]*margin-top:/);
      ui.click(ui.byText('button', 'Unknown source (2)'));
      await waitFor(() => ui.qa('.tbl tbody tr').length === 2, 'only the unknown ones');
      ui.click(ui.qa('.tbl tbody tr')[0]);
      const sheet = await waitFor(() => ui.q('.sheet'), 'the record');
      const close = ui.q('.sheet header button', sheet);
      assert.equal(close.getAttribute('aria-label'), 'Close');
      assert.ok(close.querySelector('svg[aria-hidden="true"]'), 'sheet close is an accessible icon button');
      ui.q('select[aria-label="Site"]', sheet).value = 'Safebooru';
      ui.type(ui.q('input[aria-label="Id on the site"]', sheet), 'abc123');
      ui.click(ui.byText('button', 'Save source', sheet));
      await waitFor(() => /Source saved/.test(ui.toast()), 'the confirmation');
      await waitFor(() => ui.byText('button', 'Unknown source (1)'), 'the unknown count to drop');
      const found = await api(s, 'GET', '/api/data?q=abc123');
      assert.equal(found.total, 1);
      assert.equal(found.items[0].sources[0].site, 'Safebooru');
      assert.equal(found.items[0].sources[0].url, 'https://safebooru.org/index.php?page=post&s=view&id=abc123');
    }
  ));

test('search in the top bar opens the data page filtered', () =>
  withSorter(
    (lib) => {
      put(path.join(lib, 'wallhaven-1q2le9.png'));
      put(path.join(lib, 'Arknights/Skadi/Skadi 1.png'));
    },
    '',
    async (ui) => {
      const box = ui.q('input[type="search"]');
      box.value = 'skadi';
      ui.key(box, 'Enter');
      await waitFor(() => ui.qa('.tbl tbody tr').length === 1, 'one matching record');
      assert.match(ui.q('.tbl tbody').textContent, /Skadi 1\.png/);
      assert.equal(ui.q('#data-q').value, 'skadi');
    }
  ));

test('activity: the log lists what happened and undoes it', () =>
  withSorter(
    (lib) => put(path.join(lib, 'wallhaven-1q2le9.png')),
    '',
    async (ui, s) => {
      const inbox = await api(s, 'GET', '/api/inbox');
      await api(s, 'POST', '/api/assign', { paths: [inbox[0].path], folder: 'Nature' });
      ui.go('#/activity');
      const row = await waitFor(() => ui.q('.act'), 'a log row');
      assert.match(row.textContent, /Assigned/);
      assert.match(row.textContent, /Nature\/Nature 1\.png/);
      ui.click(ui.byText('.act button', 'Undo'));
      await waitFor(() => /Undone/.test(ui.toast()), 'the confirmation');
      await waitFor(() => ui.qa('.act').some((r) => /Undone/.test(r.textContent)) && ui.byText('.badge', 'undone'), 'the row to show it was undone');
      assert.equal((await api(s, 'GET', '/api/images?folder=Nature')).length, 0);
    }
  ));

test('settings: change how gaps are handled, and the theme', () =>
  withSorter(() => {}, '#/settings', async (ui, s) => {
    const gap = await waitFor(() => ui.q('select[aria-label="Gaps in the numbering"]'), 'the select');
    assert.equal(gap.value, 'keep');
    gap.value = 'last';
    gap.dispatchEvent(new ui.w.Event('change', { bubbles: true }));
    await waitFor(() => /Saved/.test(ui.toast()), 'the confirmation');
    assert.equal((await api(s, 'GET', '/api/settings')).gap_mode, 'last');
    ui.click(ui.byText('.seg button', 'Dark'));
    assert.equal(ui.d.documentElement.dataset.theme, 'dark');
    ui.click(ui.byText('.seg button', 'System'));
    assert.equal(ui.d.documentElement.dataset.theme, undefined);

    ui.click(ui.byText('.watched-footer button', 'Add folder'));
    const intakePath = await waitFor(() => ui.q('input[aria-label="Intake folder path"]'), 'the intake path field');
    const addedPath = path.join(s.lib, 'incoming-ui-test');
    intakePath.value = addedPath;
    ui.click(ui.byText('.sheet button', 'Save'));
    await waitFor(() => ui.toast().includes('Intake folder added'), 'the intake confirmation');
    const status = await api(s, 'GET', '/api/status');
    assert.equal(status.intake.some((i) => i.path === addedPath), true);
  }));

test('the page follows the sorter: a file that arrives shows up without reloading', () =>
  withSorter(() => {}, '#/inbox', async (ui, s) => {
    await waitFor(() => ui.q('.empty') && /Inbox clear/.test(ui.q('.empty').textContent), 'an empty inbox');
    put(path.join(s.lib, 'wallhaven-1q2le9.png'));
    await waitFor(() => ui.qa('.cell').length === 1, 'the new image (the page checks every few seconds)', 12000);
  }));

test('the page says so when the sorter stops', () =>
  withSorter(() => {}, '', async (ui, s) => {
    await waitFor(() => ui.q('.status').textContent.includes('Watching'), 'the chip');
    s.stop();
    await waitFor(() => ui.q('.status').textContent.includes('Not connected'), 'the chip to change', 12000);
  }));

test('first-run setup shows a welcome card and can be completed', () =>
  withSorter(
    (lib) => put(path.join(lib, 'Nature/Nature 1.png'), 1),
    '#/',
    async (ui, s) => {
      await api(s, 'PUT', '/api/settings', { setup_complete: false });
      ui.go('#/settings');
      await waitFor(() => ui.q('#main h1')?.textContent === 'Settings', 'the settings route');
      ui.go('#/');
      await waitFor(() => ui.q('.welcome'), 'the welcome card');
      ui.click(ui.byText('button', 'Finish setup'));
      await waitFor(() => !ui.q('.welcome'), 'setup completed');
      assert.equal((await api(s, 'GET', '/api/status')).setup_complete, true);
    }
  ));

# Wallpaper Sorter: handoff guide

For two readers: **the owner**, who builds and tests it on their own machine (part 2), and **another AI** that
continues the work (part 3). Everyone should read part 1 and part 4 first.

---

## 1. What it is, and where it stands

A small background program for Linux, written in Rust. It watches `~/Pictures/Wallpapers` (top level only) and any
"intake" folders you list in its config (for example `~/Downloads/pixiv`, where a browser extension saves images).
When an image is finished downloading it:

1. looks for duplicates by content hash and sends copies to a `Duplicates` folder inside the library;
2. matches filename words and any saved site-tag hints against tags (keyword lists), then picks a folder (for example
   `Wuthering-Waves/Chisa/`);
3. moves and renames the file to `<Prefix> <number>.<same extension>` (for example `Chisa 19.png`);
4. writes a permanent record of where the image came from (site, id, artist, link, tags, rating) and logs every action
   so it can be undone.

Images it cannot place wait in an **Inbox**. A web page on `http://127.0.0.1:8421/` shows the Inbox (assign images to
folders with thumbnails and multi-select), the library folders, the tags (with a filename tester), duplicates, the data
about each image's origin, the activity log with undo, and settings.

### State at handoff

| Part | State |
|---|---|
| Matching rules, numbering, the plan (list of actions), source detection from filenames | Done. Driven by hand-checked tables in `spec/`; all passed at my last run. |
| Engine: applying a plan, log, undo, hash index, origin records, library operations, config editing | Done. Tests passed. |
| Folder watcher (inotify), debounce, run loop, command line | Done. Tested on real inotify; the real binary was smoke-tested. |
| Web server and JSON API, thumbnails | Done. HTTP and thumbnail tests pass. |
| Web UI (`ui/`) | All ten routes use React/TypeScript with TanStack Router and Query. The legacy `window.WS` runtime bridge is removed. Vitest and real-binary jsdom tests cover shared components and page flows; use the browser checklist below for visual checks. Phases 1–5 support Wallhaven, Danbooru, yande.re, and Safebooru; Konachan.com remains pending verification. |
| Not built | Size caps for the log and the thumbnail cache; videos. |

Phase 5 verification: `cargo test --workspace` (141 Rust tests), `cargo fmt --all -- --check`,
`npm --prefix ui run typecheck`, `npm --prefix ui test -- --run` (42 Vitest tests), and
`npm --prefix ui run build` passed. The generated minified bundle reports upstream Rollup annotation and chunk-size
warnings. The real-binary jsdom run previously passed 26 of 27 tests; the folder-rename preview test timed out in the
full run, although it passed once when run alone after a short settle delay. Treat that integration test as unresolved.
Live-site fetching/search and real-browser visual checks have not been completed.

---

## 2. Guide for the owner

### 2.1 What you need

- Linux (the watcher uses inotify). Rust from rustup, stable, 1.75 or newer. No C compiler is needed.
- Node.js 20 or newer and npm for frontend development and UI tests. The checked-in `daemon/ui-dist/` bundle lets Cargo builds and installs work without Node.
- A browser, for looking at the page.

### 2.2 Get a test report (one command)

```
cd wallpaper-sorter
scripts/collect-report.sh
```

It builds everything, runs the Rust tests and all UI checks, and writes **`test-report.txt`** (plus full build, Rust,
npm, typecheck, Vitest, and integration logs next to it). The first build takes several minutes on a small machine.
Send me `test-report.txt`. If the script itself fails, send what it printed, and run the pieces by hand:

```
cargo build --all-targets
cargo test --workspace --no-fail-fast 2>&1 | tee cargo.log
npm --prefix ui ci
npm --prefix ui run typecheck
npm --prefix ui test
SORTER_BIN=./target/debug/wallpaper-sorter node --test --test-reporter=tap ui/test/ui.test.js 2>&1 | tee ui.log
```

The report has: environment, a summary table (build, Rust tests, UI typecheck, Vitest, and browser integrations), the
per-binary Rust results, failing tests with their output, and a "Notes" section for you to fill in.

**Expected now:** the Rust and UI tests should pass. The report is still useful for spotting environment or browser-specific failures.

### 2.3 What to send back besides the report

- For something that looks wrong: a screenshot, the page width, and the text from the browser console (F12, Console).
- For something that behaves wrongly: what you clicked, what you expected, what happened, and the last lines of the
  program's output (the terminal, or `journalctl --user -u wallpaper-sorter` if it runs as a service).
- Optional: the last ten lines of `<library>/.sorter/log.jsonl`.

### 2.4 Trying it on your real library, safely

1. **Start with a temporary copy:** `scripts/try-on-copy.sh "$HOME/Pictures/Wallpapers"`. Optional arguments are a
  config file and port. It uses your user config if present, otherwise the starter tags, and defaults to port 8422.
  It excludes the original `.sorter` metadata and redirects every intake to a temporary empty folder.
2. The script tries hard links first and falls back to a full copy. Sorter moves and renames affect only the temporary
  copy's directory entries, but hard-linked image contents are shared. Do not edit image contents through the test copy.
  The temporary folder is removed when you stop the program with Ctrl+C.
3. If you want to test the real library afterwards, build it in release mode with `cargo build --release`. `--dry-run`
  moves nothing but still creates `.sorter` and hashes the library. `--once` processes images waiting at startup; with
  no mode option it keeps running. Use `--port N` to change the web port or `--no-web` to disable the web server.
4. Open the address printed at startup (the default is http://127.0.0.1:8421/).

What to expect on your current library (from the 264 images in the tree you showed me): only about 5 of the 93 loose
images in the library folder match a tag; the rest wait in the Inbox (62 are Wallhaven files whose names say nothing).
Files inside existing subfolders are never touched automatically. Use the Re-sort page to preview applying current tags to the whole library or one folder, then apply its one undoable batch.

Safety facts: nothing is ever overwritten; "Delete" moves to `<library>/.sorter/trash` and can be undone; every move,
rename and delete is in the log and has an Undo button. Deleting `<library>/.sorter` loses only the records (origins,
hash cache, log), never images.

### 2.5 A checklist for looking at the page

Do these in a real browser, at a wide window and at a phone-width window (about 390 px), in dark and light:

1. **Overview**: counts match reality; "Scan now" shows a message.
2. **Inbox**: thumbnails appear; select images and use **Rebuild thumbnails** if needed; click selects (outline and tick); shift-click selects a range; Ctrl+A selects all;
   Esc clears; "Details" opens a side panel with the full image and its origin link.
3. **Assign**: pick a folder by typing (suggestions appear), see the new file name in the preview, tick "Also save a
   tag", add a keyword, assign. A message with **Undo** appears. Undo it. Assign again.
4. **Library**: pick a folder in the tree; images show in number order; "Close gaps" shows a preview of renames.
5. **Tags**: the filename tester updates as you type (try `Chisa waterfall.png` and `Chisa Skadi.png`); add, edit and
   delete a tag.
6. **Duplicates**, **Data** (search, site filter, "Unknown source", select rows manually or all unknown, set a common
   source and optional per-image IDs), **Activity** (Undo per row),
   **Settings** (gap mode, theme, empty trash).
7. Save an image into the library folder from your browser and watch it appear or get sorted within a few seconds
   without reloading.
8. Anything that looks broken, cut off, unreadable, or slow.

### 2.6 Run it as a service

```
cargo install --path daemon
mkdir -p ~/.config/systemd/user && cp contrib/wallpaper-sorter.service ~/.config/systemd/user/
systemctl --user enable --now wallpaper-sorter
journalctl --user -u wallpaper-sorter -f
```

### 2.7 Where things live

| What | Where |
|---|---|
| Config (tags, intake folders, settings) | `~/.config/wallpaper-sorter/config.toml` (the page edits tags and gap mode in place and keeps your comments) |
| Records, hash cache, log, trash, folder config undo | `<library>/.sorter/` (`origins.jsonl`, `index.jsonl`, `log.jsonl`, `folder-config-undo.json`, `trash/`) |
| Thumbnails | `~/.cache/wallpaper-sorter/thumbs/` (safe to delete) |

### 2.8 If something goes wrong

- Use **Undo** (page, Activity) for any move, rename or delete.
- "cannot watch ...: is the inotify watch limit reached?" means the system limit on watched folders is too low.
  Raise `fs.inotify.max_user_watches`.
- Stop the program with Ctrl+C (or `systemctl --user stop wallpaper-sorter`).

---

## 3. Guide for another AI

### 3.1 Read in this order

1. This file. 2. `README.md` (crate layout, API table). 3. `spec/` (the rules as data). 4. `core/src/` then `engine/src/`
then `daemon/src/`. 5. `ui/` last.

The owner also has a design document ("Wallpaper Sorter: Design Notes", a Claude Doc). Section 5 below carries its
decisions, so you do not need it.

### 3.2 How the owner likes to work

- They want to **discuss before big steps** and to be told your concerns. When they say "discuss first", do not write
  code. When they say "change as you wish" or "do whatever you think is best", decide, then tell them what you chose.
- They run the tests on their own machine and send reports or screenshots. Give them commands, not guesses.
- They want it **minimal and lightweight**: Rust, few dependencies, no database, no desktop notifications, flat quiet UI.
  Their laptop is old (2 cores, no GPU): keep compile times and idle cost low.
- Keep explanations short and plain. Use tables for facts that compare. Do not pad.
- Never claim something works that you did not run. Say what you ran and what you did not.

### 3.3 Architecture

```
core/     pure logic, no file access
  config      Config, Tag, Settings, Intake (TOML)
  matcher     filename -> Decision (folder, rule, matched keywords)
  numbering   "<Prefix> <N>.<ext>", next number, four gap modes
  plan        build_plan_with(config, library snapshot, incoming files, options) -> Plan (list of Actions)
  origin      filename -> site / id / artist / url
engine/   touches the disk
  scan        library snapshot from a folder        exec     applies a plan (never overwrites) + report
  log         append-only JSON lines                undo     undo one entry or a whole batch
  index       BLAKE3 hash cache (size + mtime)      origins  permanent record per image, keyed by hash
  pipeline    hash -> plan -> apply -> keep index and records current; open(); reconcile(); undo_*()
  ops         what the UI needs: inbox, folders, images, duplicates, assign, re-sort, delete, fill_gaps, edit_origin
  cfgedit     edit tags in config.toml with toml_edit (keeps comments)
daemon/   the program
  watcher     inotify (CLOSE_WRITE / MOVED_TO only)  debounce  "finished" = quiet and size unchanged for 1 s
  daemon      run loop; `Shared` (Mutex<Pipeline> + wake channel) is what the web server uses
  web         tiny_http server, JSON API, serves ui/ with a strict Content-Security-Policy
  thumbs      400 px JPEG thumbnails cached by content hash
  main        command line (--config --library --dry-run --once --resort-preview --folder --verbose --port --no-web)
ui/       Vite-built static assets embedded in the binary; source and the npm build are in ui/
spec/     the tables and the reference matcher (Python)
```

Data flow for a new local file: watcher event -> debounce -> `Pipeline::process` -> `prepare_with` (hash, snapshot) ->
`build_plan_with` -> `apply` (moves + log) -> `record` (index + origin records). Fetch writes metadata to the origin
store by content hash before passing its completed temporary file to this same planning path. The UI's "assign" uses
the same path with `PlanOptions { forced_dest }`.

### 3.4 Spec first: how a rule is changed

The behaviour lives in tables, and the Rust code must match them.

| Table | What it pins down | How it is made |
|---|---|---|
| `spec/cases.csv` (324 rows) | matcher results for 264 real filenames + 60 edge cases | `cd spec && python3 gen_cases.py` (uses `ref_matcher.py`, `tags.starter.toml`, `tree_images.txt`) |
| `spec/numbering.csv` (29) | next number, gap modes | hand-written (`gen_numbering.py` only formats it) |
| `spec/plan_cases.toml` (40) | batches, duplicates, assign, gap modes, re-sort stays, metadata hints, and conflict candidates | hand-written |
| `spec/origins.csv` (26) | site/id parsing and manual-source URLs | hand-written |

To change a rule: edit the reference or the table first, regenerate, then make `cargo test` pass. Hand-written
tables are the real specification; do not regenerate them from the code.

### 3.5 Invariants (do not break these)

- **Never overwrite or lose a file.** Moves use atomic no-replace operations; cross-drive copies create the target
  exclusively and sync it before removing the source. Delete = move to `.sorter/trash`. Everything is logged and
  undoable. `apply` stops at the first real error; a vanished source is skipped.
- Output name is `<Prefix> <N>.<extension exactly as saved>`. Prefix per folder, default the folder name with hyphens
  turned into spaces. Next number = highest + 1; gaps stay unless the gap mode says otherwise.
- Matching is on whole words; words are split at non-letters, camelCase and letter/digit boundaries; long hex runs and
  everything after `drawn_by_` are dropped. API metadata tags are separate hint phrases and do not count toward the
  generic word limit. The deepest folder wins; different characters of one game go to the shared parent; unrelated
  tags are a conflict and wait in the Inbox. A **generic** tag applies only if no specific tag matched and the cleaned
  filename has at most 4 words. A **strict** tag also needs one of its `strict_words` in the filename.
- Duplicates are found by BLAKE3 content hash, **before** tag matching, across the whole library (not the Duplicates
  folder itself). A file already in the library must never count as the original of itself (`library_hashes_except`).
- Origin records are permanent and keyed by content hash; a file moved by hand is followed on the next `reconcile()`.
- Library-relative paths use `/`. Anything the UI sends is checked by `Pipeline::resolve` (inside the library or an
  intake folder, no `..`).
- The web server listens on 127.0.0.1 only, rejects other `Host` headers, requires JSON for changing requests and
  checks `Origin`. The page is served with a CSP that forbids inline scripts and styles.
- Fetching accepts supported Wallhaven, Danbooru, yande.re, and Safebooru post IDs or page links, never arbitrary URLs. Remote requests use
  HTTPS, exact site host allowlists for image URLs and redirects, per-site pacing, and a 32 MiB image limit. API
  credentials are sent only to the API host, stored beside the active config in `secrets.toml` with owner-only
  permissions, and never returned by the API. Failed partial downloads are removed when possible; download staging
  and startup recovery reject symlinked `.sorter` staging directories.
- Site search uses fixed per-site API endpoints, validates returned preview hosts and every redirect, limits previews
  to 5 MiB and 40 million pixels, and serves content-hash-cached thumbnails through the daemon; the browser never
  loads remote images. Danbooru requests require a numeric user ID in the User-Agent.
- Fetch rating defaults are Wallhaven `sfw`, Danbooru `g`, yande.re `s`, and Safebooru `general`; Settings can widen
  each implemented site's limit. Fetch jobs report per-entry queued, downloading, and final states, and a 429 response
  is retried once when it supplies `Retry-After`.
- Origin records retain fetched tags, rating, and artist metadata with serde defaults for old records. Wallhaven tags
  are all matching hints; Danbooru character and copyright tags are hints, while artist tags are stored only as artist
  metadata. Inbox conflict choices expose the deepest conflicting folder and matching phrase. Confirmed tag creation
  can immediately sort other waiting files. Details supports manual source edits and metadata-only lookup for all four
  implemented sites; a lookup that makes an Inbox match is undoable.
- Phase 3 API support currently includes yande.re and Safebooru, with a one-request-per-second client pace, descriptive
  User-Agent, safe-default rating limits, and exact API/image host allowlists. Konachan.com remains unsupported for
  fetching: its official pages were inaccessible during verification, and the accessible Konachan.net API is a
  different host that must not be assumed interchangeable.
- The Library folder tree keeps `style={{ paddingLeft }}` for depth indentation. React applies this through the CSSOM,
  which the CSP allows; confirm in a real browser console before claiming it is CSP-clean.
- Filenames are untrusted: React renders them as text; do not use `dangerouslySetInnerHTML` or `innerHTML`.

### 3.6 UI notes

- `ui/src/main.tsx` provides TanStack Query and the TanStack hash router. `ui/src/components/AppShell.tsx` is the
  typed React shell; all nine routes render React/TypeScript feature pages. Server data uses TanStack Query and
  Zod-validated API clients; Zustand stores hold selection, keyboard actions, theme, recent folders, and toasts.
- The legacy `core.js`, `pages.js`, `pages2.js`, `legacy-app.jsx`, `legacy.ts`, `window.WS`, and `LegacyPage`
  bridge have been removed. `components/dialogs.ts` remains a small native-`<dialog>` helper for promise-based
  confirmations and simple sheets.
- The shell owns 3-second status polling, keyboard shortcuts, navigation, and the Inbox count. Feature mutations
  invalidate their TanStack Query data after success or Undo.
- Styling uses CSS variables copied from the design mock-up (`ui/design-mock.html`); four font sizes, no shadows or
  gradients, dark first. Fonts are self-hosted from `ui/fonts/`.
- The Library folder header shows source counts; each image counts under its first known source, or Unknown if none.
- The Overview fetch panel accepts one ID or post-page link per line. Bare IDs use the selected site; a supported
  link identifies its site. Settings stores Wallhaven and Danbooru credentials and the maximum accepted ratings.
- When a fetched Danbooru character has no matching tag, the Overview offers to create one and assign that image
  into the new destination; the suggestion defaults under a matching series tag when one exists.
- Because of the CSP, never set `style="..."` attributes or use inline handlers. Setting `el.style.x = ...` from
  script is fine.
- `npm --prefix ui test` runs the Vitest component/store tests in one worker because the MSW server is shared across
  test files. `ui/test/ui.test.js` starts the compiled binary on
  a temporary library and drives it in jsdom. jsdom has no layout or real image rendering, so use the browser
  checklist in section 2.5 for visual verification.

### 3.7 Working in a sandbox

- `apt-get install rustc cargo` gives Rust 1.75. Newer crates need newer Rust, so `Cargo.lock` pins `indexmap`,
  `hashbrown`, `blake3` and `image` to older releases (`cargo update -p NAME --precise X`). On a current toolchain
  `cargo update` is fine.
- BLAKE3 is built with its `pure` feature (no C compiler). `image` uses only png, jpeg and webp.
- No real browser is available in a typical sandbox; use jsdom, and say plainly what that cannot show.

### 3.8 Pitfalls already met

- tiny_http sends bodies over about 32 KB with `Transfer-Encoding: chunked`; raw HTTP clients in tests must decode it.
- `tiny_http::HeaderField::equiv` needs a `'static` string; compare names with `to_string().eq_ignore_ascii_case`.
- A filename can contain `<`, `"` and `&` but **not `/`**: a test that "creates a file named `<b>x</b>`" creates a folder.
- A loose file in the library root is in the hash index; processing it again must not treat it as a duplicate of itself.
- inotify does not report moves inside folders that are not watched; the library root is watched non-recursively on
  purpose, so the sorter's own moves into subfolders do not loop.
- After an undo, the restored file is held using a persisted size and modification-time fingerprint, so it is left alone across daemon restarts until it changes.
- Re-sort reserves hashes for numbered in-place files before duplicate matching, and uses exact library-relative paths for destination checks so nested folders with matching tails are not mistaken for stays.
- Index refresh skips unreadable files and child directories; it retains cached entries when access fails, removes entries only for confirmed missing paths, and still reports library-root errors.
- Startup truncates a malformed final log record, discards and rebuilds a corrupt hash index, and preserves corrupt origin data in a uniquely named `.corrupt` backup before rebuilding.

---

## 4. Known issues and what to do next

### 4.1 UI automated tests

The 27 jsdom integration tests load the built app against the real binary and API. The 36 Vitest tests cover shared
components, feature components, and stores. Neither suite validates visual layout or real image loading.

### 4.2 Check the UI in a real browser

Follow the checklist in section 2.5. Things most likely to need work: layout at narrow widths, long filenames overflowing
(Inbox and Data), the thumbnail grid on thousands of images (it shows 240 at a time with a "show more" button, there is
no virtual scrolling), focus handling after the page refreshes itself, and any Content-Security-Policy complaints in the
console.

### 4.3 Features not built, with a sketch

Folder creation, rename, merge, and prefix changes are implemented in the Library page and JSON API. File changes are
previewed and logged; rename pins an old effective prefix only when the new path would change it, and undo restores
the original config text.

Current update: Phases 1 and 2 are implemented for Wallhaven and Danbooru. Phase 2 adds metadata-backed matcher hints,
conflict candidates, explicit tag creation from Inbox, source editing, and metadata-only lookup. Phase 3 adds fetch
and lookup support for yande.re and Safebooru. Phase 4 adds bulk metadata enrichment from selected Data records by
their saved source site and ID. Phase 5 adds in-app search/browsing for Wallhaven, Danbooru, yande.re, and Safebooru,
with daemon-served, content-hash-cached previews. Zerochan remains optional and is not implemented. Konachan.com is
deferred because its official API/terms pages could not be verified; do not infer that the accessible Konachan.net
docs apply to it.

| Feature | Sketch |
|---|---|
| First-run welcome | Implemented: missing config plus `--library` creates a starter config; the Overview page tracks setup completion. |
| Size caps | Thumbnail cache (delete oldest), `log.jsonl` (keep recent entries; origin records stay forever). |
| Videos | The extension list is a setting; `Video/` files would need their own thumbnails. Parked by the owner ("later"). |
| Additional site APIs | Phase 3: yande.re and Safebooru implemented; Konachan.com pending official verification. Phase 4: bulk origin enrichment implemented. Phase 5: in-app search/browsing for the four supported sites, with daemon-local previews. Zerochan remains optional. Pixiv remains out of scope. |

### 4.4 Smaller known limits

- A second copy of an unsorted Pixiv file that sits **outside** the library is not recognised as a duplicate until the
  first one is inside the library.
- Adding or changing a tag makes the program look at waiting files again, so files that now match get sorted at once
  (chosen on purpose, undoable). Inbox tag creation reports and supports undo for additional files sorted.
- If the config changes after a folder change, undo is blocked rather than overwriting the newer config. The API returns
  HTTP 409 with a plain-language explanation, and the failed undo leaves both the files and current config untouched.
- `GET /api/status` lists the Inbox and Duplicates on every call and the page polls it every 3 seconds; fine for hundreds
  of files, worth caching for tens of thousands. The pipeline sits behind one mutex, so API calls wait while a large
  batch is being hashed.
- "Close gaps: move the last images into the gaps" fills **every** gap at once.
- Fetching, search, and previews have only been exercised against local fake API/CDN servers; confirm live response
  fields, CDN redirects, and rating behavior before relying on them against the sites.

### 4.5 Consolidated backlog

- Complete the real-browser checklist in section 2.5 at wide and 390 px widths, in dark and light.
- Verify Wallhaven and Danbooru fetching, metadata lookup, search, and previews against the live sites, including redirects and rating filters. Danbooru's official API documentation requires a unique User-Agent containing the user's ID; requests now stop with an actionable error unless the numeric ID is configured.
- Review official terms and verify live API redirect/rate-limit behavior for yande.re and Safebooru. Their official API/rating docs do not specify a required User-Agent, numeric request limit, or redirect behavior; the client uses a descriptive User-Agent, one request per second, and strict allowlists. Safebooru documents General as a rating but does not define its semantics; the client uses it as the default most restrictive choice.
- Implement Konachan.com only after its official API documentation and terms are accessible and verified. Do not reuse Konachan.net endpoints or assume IDs/domains are interchangeable.
- Zerochan search remains optional; Konachan.com remains unsupported pending accessible official API and terms documentation.
- Add a thumbnail-cache size limit and a `log.jsonl` size limit; keep origin records permanent.
- Videos remain parked.
- Pixiv API fetching remains parked.
- Cache or reduce `/api/status` work if it becomes slow with tens of thousands of files.
- Confirm the remaining Library tree indentation in a real browser console; React sets it through CSSOM, but jsdom
  cannot verify CSP behavior.

---

## 5. Decisions already made

- Rust; one library, `~/Pictures/Wallpapers`; plain files, no database; hidden `.sorter/` folder inside the library.
- Tags: keywords plus a destination folder; many tags per folder; folders nest; whole-word matching; per-tag options:
  substring, strict, generic; deepest folder wins, then shared parent, else conflict.
- Names: `<Prefix> <N>.<ext>`; prefix editable per folder; extension kept; gaps kept by default, with three optional
  modes (lowest free, move the last into the gap, renumber).
- Duplicates: exact (hash), moved to `Duplicates` inside the library, never deleted automatically; a copy from another
  site adds a source to the original's record ("also seen on").
- Intake folders: images are **moved** out (not copied); unsorted ones stay where they are until assigned; empty subfolders
  are removed after ten minutes.
- Notifications are inside the page only (Inbox count), no desktop pop-ups.
- Delete goes to a trash inside the library and is undoable; the trash is emptied only on request.
- UI: minimal and flat, dark first, one accent colour, self-hosted fonts (Hanken Grotesk, JetBrains Mono), runs offline.
- Pixiv stays with the owner's browser extension; no Pixiv API.
- API metadata tags are matching hint phrases, not filename words; Wallhaven uses all tags, Danbooru uses character and copyright categories only.
- Metadata lookup updates origin records without downloading an image. It supports Wallhaven, Danbooru, yande.re, and Safebooru.
- Bulk metadata enrichment runs selected Data records sequentially through the metadata-only lookup API. It uses each record's first supported stored source with a nonempty ID, continues after per-record errors, refreshes the Data/Inbox/Library views, and offers undo for any Inbox files sorted during lookup.
- yande.re API documentation: [API](https://yande.re/help/api), [ratings](https://yande.re/help/ratings). Safebooru documentation: [DAPI](https://safebooru.org/index.php?page=help&topic=dapi), [ratings](https://safebooru.org/index.php?page=help&topic=rating). The DAPI endpoint and JSON fields were also checked using a read-only sample response; automated tests use local fixtures only.
- Search documentation reviewed: [Wallhaven API](https://wallhaven.cc/help/api) and [Terms of Service](https://wallhaven.cc/terms); [Danbooru API](https://danbooru.donmai.us/wiki_pages/help%3Aapi) and [Terms of Service](https://danbooru.donmai.us/terms_of_service). Wallhaven documents 24 results/page and 45 requests/minute; the client spaces requests at 1.35 seconds and applies its configured purity filter. Danbooru requires a unique User-Agent containing the numeric user ID, allows 10 read requests/second globally, and recommends about 1/second for longer sessions; the client requires that ID and paces requests at 1/second.
- yande.re `/terms` returned 404 and the checked Safebooru terms URL redirected to the site homepage, so their current terms were not verified. The API/rating docs were reviewed; neither specifies a numeric request limit, required User-Agent, or redirect policy. Client requests are paced at 1/second and constrained to exact site/CDN allowlists. Safebooru's rating docs warn that ratings can be wrong and do not define General semantics; General remains the configured conservative default.
- Konachan.net publishes [Moebooru API documentation](https://konachan.net/help/api) and [rating help](https://konachan.net/help/ratings), but this does not verify Konachan.com. The `.com` help pages returned 403 during this work.

---

## 6. Commands

```
cargo build --release                 build the program
cargo test --workspace                all Rust tests
scripts/collect-report.sh             everything, as one report file
scripts/try-on-copy.sh "$HOME/Pictures/Wallpapers"  safe browser trial on a temporary copy
cd spec && python3 gen_cases.py       regenerate spec/cases.csv from the reference matcher
python3 spec/ref_matcher.py spec/tags.starter.toml "Chisa waterfall.png"    try one name
target/release/wallpaper-sorter --help
target/release/wallpaper-sorter --resort-preview [--folder F]  preview a whole library or folder scope without moving images
```

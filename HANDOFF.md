# Wallpaper Sorter: handoff guide

For two readers: **the owner**, who builds and tests it on their own machine (part 2), and **another AI** that
continues the work (part 3). Everyone should read part 1 and part 4 first.

---

## 1. What it is, and where it stands

A small background program for Linux, written in Rust. It watches `~/Pictures/Wallpapers` (top level only) and any
"intake" folders you list in its config (for example `~/Downloads/pixiv`, where a browser extension saves images).
When an image is finished downloading it:

1. looks for duplicates by content hash and sends copies to a `Duplicates` folder inside the library;
2. looks at the filename, finds tags (keyword lists) that match, and picks a folder (for example
   `Wuthering-Waves/Chisa/`);
3. moves and renames the file to `<Prefix> <number>.<same extension>` (for example `Chisa 19.png`);
4. writes a permanent record of where the image came from (site, id, artist, link) and logs every action so it can be
   undone.

Images it cannot place wait in an **Inbox**. A web page on `http://127.0.0.1:8421/` shows the Inbox (assign images to
folders with thumbnails and multi-select), the library folders, the tags (with a filename tester), duplicates, the data
about each image's origin, the activity log with undo, and settings.

### State at handoff

| Part | State |
|---|---|
| Matching rules, numbering, the plan (list of actions), source detection from filenames | Done. Driven by hand-checked tables in `spec/`; all passed at my last run. |
| Engine: applying a plan, log, undo, hash index, origin records, library operations, config editing | Done. Tests passed. |
| Folder watcher (inotify), debounce, run loop, command line | Done. Tested on real inotify; the real binary was smoke-tested. |
| Web server and JSON API, thumbnails | Done. 16 HTTP tests passed; smoke-tested with curl. |
| Web UI (`ui/`) | Written and served. The 22 jsdom UI tests cover the pages, Re-sort, folder management, and Library source counts; use the browser checklist below for visual checks. |
| Not built | First-run welcome flow; "restore a duplicate as a new image"; editing watched folders from the page; size caps for the log and the thumbnail cache; videos. |

Final verification for this handoff: `cargo build --all-targets` completed with 0 warnings; `cargo test --workspace`
passed 86 Rust tests; and `cd ui/test && SORTER_BIN=../../target/debug/wallpaper-sorter node --test --test-reporter=tap`
passed 22 UI tests. Many Rust tests are table-driven with hundreds of rows.

---

## 2. Guide for the owner

### 2.1 What you need

- Linux (the watcher uses inotify). Rust from rustup, stable, 1.75 or newer. No C compiler is needed.
- Node.js 20 or newer and npm, **only** for the UI tests. Without them `scripts/collect-report.sh` skips them.
- A browser, for looking at the page.

### 2.2 Get a test report (one command)

```
cd wallpaper-sorter
scripts/collect-report.sh
```

It builds everything, runs the Rust tests and the UI tests, and writes **`test-report.md`** (plus the full logs next to
it: `test-report.build.log`, `.cargo.log`, `.ui.log`). The first build takes several minutes on a small machine.
Send me `test-report.md`. If the script itself fails, send what it printed, and run the pieces by hand:

```
cargo build --all-targets
cargo test --workspace --no-fail-fast 2>&1 | tee cargo.log
cd ui/test && npm install && SORTER_BIN=../../target/debug/wallpaper-sorter node --test --test-reporter=tap 2>&1 | tee ../../ui.log
```

The report has: environment, a summary table (build, Rust tests, UI tests), the per-binary Rust results, the failing
tests with their output, the UI test list with failures in detail, and a "Notes" section for you to fill in.

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
2. **Inbox**: thumbnails appear; click selects (outline and tick); shift-click selects a range; Ctrl+A selects all;
   Esc clears; "Details" opens a side panel with the full image and its origin link.
3. **Assign**: pick a folder by typing (suggestions appear), see the new file name in the preview, tick "Also save a
   tag", add a keyword, assign. A message with **Undo** appears. Undo it. Assign again.
4. **Library**: pick a folder in the tree; images show in number order; "Close gaps" shows a preview of renames.
5. **Tags**: the filename tester updates as you type (try `Chisa waterfall.png` and `Chisa Skadi.png`); add, edit and
   delete a tag.
6. **Duplicates**, **Data** (search, site filter, "Unknown source", set a source by hand), **Activity** (Undo per row),
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
ui/       plain HTML/CSS/JS, no build step, embedded in the binary with include_str!
spec/     the tables and the reference matcher (Python)
```

Data flow for a new file: watcher event -> debounce -> `Pipeline::process` -> `prepare_with` (hash, snapshot) ->
`build_plan_with` -> `apply` (moves + log) -> `record` (index + origin records). The UI's "assign" uses the same path
with `PlanOptions { forced_dest }`.

### 3.4 Spec first: how a rule is changed

The behaviour lives in tables, and the Rust code must match them.

| Table | What it pins down | How it is made |
|---|---|---|
| `spec/cases.csv` (324 rows) | matcher results for 264 real filenames + 60 edge cases | `cd spec && python3 gen_cases.py` (uses `ref_matcher.py`, `tags.starter.toml`, `tree_images.txt`) |
| `spec/numbering.csv` (29) | next number, gap modes | hand-written (`gen_numbering.py` only formats it) |
| `spec/plan_cases.toml` (31) | batches, duplicates, assign, gap modes, re-sort stays | hand-written |
| `spec/origins.csv` (26) | site/id parsing and manual-source URLs; Safebooru is manual only | hand-written |

To change a rule: edit the reference or the table first, regenerate, then make `cargo test` pass. Hand-written
tables are the real specification; do not regenerate them from the code.

### 3.5 Invariants (do not break these)

- **Never overwrite or lose a file.** Moves fail if the target exists. Delete = move to `.sorter/trash`. Everything is
  logged and undoable. `apply` stops at the first real error; a vanished source is skipped.
- Output name is `<Prefix> <N>.<extension exactly as saved>`. Prefix per folder, default the folder name with hyphens
  turned into spaces. Next number = highest + 1; gaps stay unless the gap mode says otherwise.
- Matching is on whole words; words are split at non-letters, camelCase and letter/digit boundaries; long hex runs and
  everything after `drawn_by_` are dropped. The deepest folder wins; different characters of one game go to the shared
  parent; unrelated tags are a conflict and wait in the Inbox. A **generic** tag applies only if no specific tag matched
  and the cleaned name has at most 4 words. A **strict** tag also needs one of its `strict_words` in the name.
- Duplicates are found by BLAKE3 content hash, **before** tag matching, across the whole library (not the Duplicates
  folder itself). A file already in the library must never count as the original of itself (`library_hashes_except`).
- Origin records are permanent and keyed by content hash; a file moved by hand is followed on the next `reconcile()`.
- Library-relative paths use `/`. Anything the UI sends is checked by `Pipeline::resolve` (inside the library or an
  intake folder, no `..`).
- The web server listens on 127.0.0.1 only, rejects other `Host` headers, requires JSON for changing requests and
  checks `Origin`. The page is served with a CSP that forbids inline scripts and styles.
- Filenames are untrusted: the UI builds elements with `textContent` only (`WS.h`), never `innerHTML`.

### 3.6 UI notes

- Files: `core.js` (helpers, API client, toast, sheets, pickers), `pages.js` (grid, assign and detail sheets, Overview,
  Inbox, Library), `pages2.js` (Activity, Tags, Duplicates, Data, Settings), `main.js` (shell, hash routing, 3-second
  status polling, keyboard). Everything hangs off `window.WS`. `WS.refresh()` re-renders the current page.
- Styling uses CSS variables copied from the design mock-up (`ui/design-mock.html`); four font sizes, no shadows or
  gradients, dark first. Fonts are self-hosted from `ui/fonts/`.
- The Library folder header shows source counts; each image counts under its first known source, or Unknown if none.
- Because of the CSP, never set `style="..."` attributes or use inline handlers. Setting `el.style.x = ...` from
  script is fine.
- The tests in `ui/test/ui.test.js` start the compiled binary on a temporary library, load the page in jsdom and
  click through it. jsdom has no layout, no images and no `fetch`; the tests give it Node's `fetch`.

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

---

## 4. Known issues and what to do next

### 4.1 UI automated tests

The previous UI failures are fixed. The 22 jsdom tests load the page scripts through Node's `fetch` (rather than
jsdom's intermittent HTTP loader), then exercise the real binary and API. They include the Re-sort preview, apply and
batch undo flow. This does not validate visual layout or real image loading.

### 4.2 Check the UI in a real browser

Follow the checklist in section 2.5. Things most likely to need work: layout at narrow widths, long filenames overflowing
(Inbox and Data), the thumbnail grid on thousands of images (it shows 240 at a time with a "show more" button, there is
no virtual scrolling), focus handling after the page refreshes itself, and any Content-Security-Policy complaints in the
console.

### 4.3 Features not built, with a sketch

Folder creation, rename, merge, and prefix changes are implemented in the Library page and JSON API. File changes are
previewed and logged; rename pins an old effective prefix only when the new path would change it, and undo restores
the original config text.

| Feature | Sketch |
|---|---|
| Restore a duplicate as a new image | Needs an option to skip the duplicate check once; probably "move back to the library folder and hold it". |
| First-run welcome | Pick library and intake folders, run the first scan, offer the re-sort. Needs config writing for `library` and `[[intake]]`. |
| Size caps | Thumbnail cache (delete oldest), `log.jsonl` (keep recent entries; origin records stay forever). |
| Videos | The extension list is a setting; `Video/` files would need their own thumbnails. Parked by the owner ("later"). |
| Fetch wallpapers from site APIs | Parked by the owner. The matcher takes a plain list of words, so API tags can feed it later. Not Pixiv. |

### 4.4 Smaller known limits

- A second copy of an unsorted Pixiv file that sits **outside** the library is not recognised as a duplicate until the
  first one is inside the library.
- Adding or changing a tag makes the program look at waiting files again, so files that now match get sorted at once
  (chosen on purpose, undoable).
- If the config changes after a folder change, undo is blocked rather than overwriting the newer config. The API returns
  HTTP 409 with a plain-language explanation, and the failed undo leaves both the files and current config untouched.
- `GET /api/status` lists the Inbox and Duplicates on every call and the page polls it every 3 seconds; fine for hundreds
  of files, worth caching for tens of thousands. The pipeline sits behind one mutex, so API calls wait while a large
  batch is being hashed.
- "Close gaps: move the last images into the gaps" fills **every** gap at once.

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

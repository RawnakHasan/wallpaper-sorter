# Wallpaper Sorter: audit and next steps

Written 2026-11-19 from a read-through of the repository snapshot (`repomix-output.xml`).
Keep this file in the repo root next to `HANDOFF.md`. When a task is done, tick it in section 9 and, if behaviour
changed, update `HANDOFF.md`, `App.md` and `README.md` in the same change.

---

## 0. How this audit was made (and its limits)

**Read in full or nearly in full:** `HANDOFF.md`, `README.md`, `App.md`, `daemon/src/{web,daemon,watcher,thumbs,main}.rs`,
`engine/src/{exec,undo,log,index,pipeline,util}.rs`, `engine/src/cfgedit.rs` (first half), `core/src/config.rs`,
the path-safety part of `engine/src/ops.rs`, `.gitignore`, workspace `Cargo.toml`, the systemd unit.

**Not read (do not assume they are fine or broken):** `core/src/{matcher,plan,numbering,origin,paths}.rs`,
`engine/src/origins.rs`, most of `ui/*.js` and `ui/app.css`, and the bodies of the test files.

**Not run:** the audit sandbox had no Rust toolchain, so nothing was built and no test was executed. The counts
"86 Rust tests" and "22 UI tests" come from `HANDOFF.md`. Treat every finding below as "verified by reading the
code", not "reproduced". Items marked **(likely)** are inferences that still need a measurement.

---

## 1. Where the project stands

Per its own handoff, the program is feature-complete for its v1 scope:

- Pure logic in `core/` (matching, numbering, plan, origin parsing), driven by hand-checked tables in `spec/`.
- Disk engine in `engine/` (apply, log, undo, BLAKE3 index, origin records, library operations, config editing).
- inotify daemon, debounce, tiny_http web server with JSON API, jsdom-tested plain-JS web UI in `ui/`.

What is **not** done:

1. The UI has never been checked in a real browser (HANDOFF section 2.5 checklist is still open). jsdom has no
   layout and no real image loading, so passing UI tests say nothing about how it looks.
2. A handful of robustness bugs in the engine and watcher (section 4).
3. Documentation drift (section 6).
4. Parked by the owner: videos, fetching from site APIs, size caps for log and thumbnail cache.

---

## 2. What is solid (do not regress)

- Spec-first testing: `spec/*.csv` and `plan_cases.toml` are the real specification; the hand-written ones must never be
  regenerated from the code.
- Log-then-undo design, undo of whole batches, trash instead of delete, hash-addressed images and thumbnails.
- Config editing with `toml_edit` keeps comments; config writes are atomic (temp file + rename + `sync_data`).
- Web hardening: 127.0.0.1 only, `Host` and `Origin` checks, JSON content type required for changes, strict CSP,
  `X-Content-Type-Options: nosniff`, hash validated as 64 hex digits before touching the disk.
- UI builds DOM with `textContent` only (`WS.h`), never `innerHTML`.
- Thumbnails are drawn one at a time behind a mutex and the grid uses `loading="lazy"`.
- Lock ordering looks consistent (config edit lock, then pipeline lock). No deadlock was found.

---

## 3. Invariants every change must keep

Copied from `HANDOFF.md` section 3.5 so they are in front of whoever works on this:

- **Never overwrite or lose a file.** Moves fail if the target exists. Delete means move to `.sorter/trash`.
  Everything is logged and undoable. `apply` stops at the first real error; a vanished source is skipped.
- Output name is `<Prefix> <N>.<extension exactly as saved>`; next number is highest + 1; gaps stay unless the gap mode says otherwise.
- Duplicates are found by BLAKE3 hash before tag matching, across the whole library, and a file must never count as
  the original of itself (`library_hashes_except`).
- Origin records are permanent, keyed by content hash.
- Library-relative paths use `/`. Anything from the UI goes through `Pipeline::resolve`.
- The server listens on 127.0.0.1 only, checks `Host` and `Origin`, requires JSON for changing requests, serves a CSP
  that forbids inline scripts and styles. No `style="..."` attributes and no inline handlers in the UI.
- Filenames are untrusted: never `innerHTML`.
- The library root is watched non-recursively on purpose, so the sorter's own moves never loop.
- Must still build on Rust 1.75 (`Cargo.lock` pins `indexmap`, `hashbrown`, `blake3`, `image`). BLAKE3 stays on the
  `pure` feature (no C compiler). Do not add heavy dependencies; the owner's laptop is 2 cores, no GPU.

---

## 4. Findings and tasks

Severity: **S1** data safety or the program will not start; **S2** reliability, correctness or usability;
**S3** cleanup. Each task lists where, the problem, the fix, and what proves it is done.

### Phase 1: data safety and startup (do these first)

#### T1 (S1): "never overwrite" is not airtight
- **Where:** `engine/src/exec.rs`, `move_no_replace`.
- **Problem:** It checks `symlink_metadata(to)` and then calls `fs::rename`. On Linux, `rename` silently replaces an
  existing file, so a file created at the target between the check and the rename (for example a browser saving into
  the library) is destroyed. The cross-drive branch (errno 18, EXDEV) uses `fs::copy`, which also truncates and
  overwrites an existing target, and it deletes the source without syncing the copy first, so a crash right after can
  leave an empty or partial file and no source.
- **Fix:**
  - Use `renameat2(AT_FDCWD, from, AT_FDCWD, to, RENAME_NOREPLACE)` through `libc::syscall(libc::SYS_renameat2, ...)`.
    Map `EEXIST` to `ExecError::TargetExists`. On `ENOSYS` or `EINVAL` (filesystem does not support the flag) fall back to
    the current check + rename. Keep the EXDEV fallback.
  - Copy branch: open the target with `OpenOptions::new().write(true).create_new(true)`, copy, `sync_all()` the target,
    compare size, only then remove the source. On any failure remove the half-written target.
  - Check whether `libc` is already a dependency of `engine/Cargo.toml`; if not, add it (it is already used by `daemon`).
    Keep it Rust 1.75 compatible.
- **Tests:** in `engine/tests/flow.rs` (or a new `engine/tests/exec.rs`): target exists before call returns
  `TargetExists` and the target content is untouched; a move into a missing folder still creates the folder;
  a race test that creates the target from another thread in a loop and asserts no content is ever lost
  (either the move fails or both files exist). Cross-drive is hard to test; at least unit-test the copy helper
  with an existing target.
- **Done when:** no code path can replace an existing file, and the above tests pass.

#### T2 (S1): a half-written log line stops the program from starting
- **Where:** `engine/src/log.rs`, `Log::open`; `engine/src/index.rs`, `Index::open`; check `engine/src/origins.rs` too
  (not read in this audit).
- **Problem:** Opening fails with `InvalidData` on any line that does not parse. The log is appended in place, so a
  power cut or crash mid-write leaves a partial last line. `Pipeline::open` then fails, the daemon exits, and the
  systemd unit restarts it forever.
- **Fix:**
  - `Log::open`: if the **last** non-empty line fails to parse, ignore it and truncate the file to the end of the
    previous line (log a warning to stderr). A bad line in the middle is still a hard error with the line number.
  - `Index::open`: it is only a cache, so on any parse error start with an empty index (the next `reconcile()` rebuilds it)
    and say so on stderr.
  - `OriginStore::open`: read the file first; if it is saved atomically, apply the same rule as the index but be careful,
    because origin records are permanent data. Prefer: keep a `.corrupt` copy before starting empty.
- **Tests:** `engine/tests/pipeline.rs`: a log file with a truncated last line opens and keeps all earlier entries;
  a corrupt line in the middle still errors; a corrupt index opens empty and `reconcile` rebuilds it.
- **Done when:** `kill -9` during a batch can never prevent the next start.

#### T3 (S1): one unreadable or vanished file aborts the whole library scan
- **Where:** `engine/src/index.rs`, `Index::refresh`. Called from `Pipeline::open`, `reconcile` and after every undo.
- **Problem:** `read_dir`, `entry?`, `file_type()?`, `file_stat()?` and `hash_file()?` all use `?`. A file deleted between
  `read_dir` and `stat` (a download finishing) or a permission error fails the start or the undo.
- **Fix:** On a per-file error (`NotFound`, `PermissionDenied`, any `io::Error` for that one entry) skip the file, count
  it in `RefreshStats` (add a `skipped` field), and continue. Do not mark skipped files as "gone" if they only failed
  to read (keep their old cache entry), but do drop them if the error was `NotFound`. A failure to read the root
  directory itself is still an error. Check `engine/src/scan.rs` (`library_snapshot`) for the same pattern.
- **Tests:** create a library with an unreadable file (chmod 000; skip the test when running as root) and a dangling
  symlink; open must succeed and the stats must show the skipped one.
- **Done when:** a single bad file can never block start-up, undo or re-sort.

#### T4 (S1): intake folder problems are silent
- **Where:** `daemon/src/daemon.rs` (`activate_intake`, `rescan`, `IntakeDir.active`), `daemon/src/watcher.rs`
  (`add_dir`, the `IGNORED` branch in `read`), `daemon/src/web.rs` (`status`).
- **Problems:**
  1. `activate_intake` does `if let Ok(found) = self.watcher.add(..)`; the helpful "is the inotify watch limit
     reached?" message built in `watcher.rs` is thrown away. For the library root the error propagates, for intake
     folders it does not.
  2. `add_dir` aborts on the first unreadable subfolder (`read_dir(path)?`, `entry?`) after already adding some watches.
  3. `/api/status` reports only `exists` for each intake folder, not whether it is actually watched.
  4. If a watched intake root is deleted and recreated within one housekeeping minute, `active` stays true while the
     kernel watch is gone (`IGNORED` removes it from `dirs`), so the folder is dead until restart or rescan.
- **Fix:**
  - Keep the error from `watcher.add`, print it to stderr, store it on `IntakeDir` (`last_error: Option<String>`).
  - Make `add_dir` skip unreadable subfolders instead of failing the whole intake.
  - Have `DirWatcher::read` report lost watches (for example `Event::WatchLost(PathBuf)`), and set `active = false` for
    the matching intake so the next tick re-adds it. Alternatively make `activate_intake` verify that the path is
    present in `watcher.dirs`.
  - Expose `watching: bool` and `error: Option<String>` per intake in `GET /api/status`; show them on Overview and
    Settings (coordinate with T7).
- **Tests:** `daemon/tests/watch.rs` already uses real inotify: add "intake root deleted then recreated gets watched
  again", "unreadable subfolder does not stop the rest". `daemon/tests/web.rs`: status shows `watching` and `error`.
- **Done when:** every failure to watch an intake folder is visible in the terminal log and on the page.

#### T5 (S1): empty-folder cleanup is too eager and intake paths are unvalidated
- **Where:** `core/src/config.rs` (`Intake.remove_empty_folders` uses `#[serde(default = "yes")]`),
  `daemon/src/web.rs` (`IntakeBody.remove_empty_folders` defaults to `false`), `daemon/src/daemon.rs`
  (`remove_empty_dirs`), `engine/src/cfgedit.rs` (`add_intake`, `update_intake`).
- **Problems:**
  1. The default is inconsistent: true from the config file, false from the API.
  2. Default-on deletion of any empty subfolder older than ten minutes is risky (torrent "incomplete" folders,
     folders the user created on purpose).
  3. `remove_empty_dirs` also removes hidden folders.
  4. `add_intake` and `update_intake` only check for an empty string. `/`, `~`, the library itself or a parent of the
     library are accepted, which makes the sorter move every image it finds there and delete empty folders.
- **Fix:**
  - Default `remove_empty_folders` to **false** everywhere (config struct, API body, starter config, docs).
    Decide with the owner whether existing configs that omit the key should keep the old behaviour (see section 8).
  - `remove_empty_dirs` skips names starting with `.`.
  - Validate intake paths in `cfgedit` (after `expand_home`): refuse empty, `/`, the home directory, the library root,
    any ancestor of the library root, and any path inside `<library>/.sorter`. Return a plain-language message.
    (An intake **inside** the library is allowed today, for example the try-on-copy script; keep that working,
    but never the library root itself.)
- **Tests:** `engine/tests/cfgedit.rs` for each refused path and the accepted ones; `daemon/tests/watch.rs` that hidden
  empty folders survive cleanup and that default config does not delete empty folders; `daemon/tests/web.rs` that
  `POST /api/intake` returns 400 for refused paths.
- **Done when:** a mistyped intake path cannot make the program touch unrelated folders.

### Phase 2: reliability and responsiveness

#### T6 (S2): the UI can freeze while the sorter works **(likely, measure first)**
- **Where:** `daemon/src/daemon.rs` (`Shared.pipeline: Mutex<Pipeline>`), `daemon/src/web.rs` (6 worker threads),
  `daemon/src/thumbs.rs`, `engine/src/log.rs` (`append` calls `sync_data` per entry),
  `GET /api/status` (lists Inbox and Duplicates on every call, polled every 3 s).
- **Problems:**
  1. One mutex wraps the whole pipeline. Hashing a large batch, a Re-sort preview (a GET that hashes the library and
     writes index and record files) or `process` blocks every API call that needs the lock.
  2. Thumbnails are drawn one at a time, and each pending request holds one of only 6 server threads while waiting
     for the draw lock. A cold thumbnail grid can occupy all 6 threads, so the status poll and clicks wait.
  3. Each log entry is fsynced separately; a re-sort of thousands of files does thousands of fsyncs while holding
     the lock (slow on a spinning disk).
  4. `Log::next_batch`, `append` and `is_undone` scan all entries (O(n) each, so O(n²) for large batches).
- **Fix (do the cheap ones first, measure after each):**
  - `Log::append_many` (or a batch mode): write all lines of a batch, then `sync_data` once. Keep `Entry` ids unique and
    ordered. Cache `max_id`, `max_batch` and a `HashSet` of undone ids inside `Log`.
  - Limit in-flight thumbnail requests (for example at most 3 waiting; answer 503 with `Retry-After` beyond that and let
    the UI retry), or pre-generate thumbnails for new Inbox files in a low-priority background thread.
  - Cache the Inbox and Duplicates counts used by `/api/status` and refresh them when the daemon processes files,
    after an API change, or on rescan.
  - Longer term: hash outside the pipeline lock (compute hashes first, then lock to plan and apply).
- **Tests/measure:** create a library with several thousand small images, time `GET /api/status` while a re-sort preview
  runs, before and after. Write the numbers in the pull request.
- **Done when:** status polling stays under a second during a large re-sort preview on the owner's machine.

#### T7 (S2): finish the Settings page: edit watched folders
- **Where:** backend exists: `POST /api/intake`, `PUT` and `DELETE /api/intake/N` in `daemon/src/web.rs`, `add_intake`,
  `update_intake`, `remove_intake` in `engine/src/cfgedit.rs`, tests in `daemon/tests/web.rs`. UI: `ui/pages2.js`
  (Settings) still shows watched folders read-only and nothing in `ui/` calls `/api/intake`.
- **Fix:** add add / edit / remove controls in Settings with: path field, "include subfolders", "remove empty folders"
  (default off, see T5), validation messages from the API, and the watching/error state from T4. Follow the design rules
  in `ui/design-mock.html` and `HANDOFF.md` 3.6 (CSS variables, four font sizes, no shadows or gradients, Lucide-style
  icons only if already used, no inline styles, `textContent` only). Remove the "edit the config file" hint once done.
- **Tests:** extend `ui/test/ui.test.js` (add, edit, remove, refused path shows the message).
- **Done when:** a new intake folder can be added and removed from the page, and the checklist in section 2.5 of
  `HANDOFF.md` includes it.

#### T8 (S2): first run breaks after `cargo install`
- **Where:** `daemon/src/main.rs`, `run()`, branch for a missing config with `--library`.
- **Problem:** it reads `spec/tags.starter.toml` at **run time** from `env!("CARGO_MANIFEST_DIR")/../spec/`. That path only
  exists while the source tree is where it was at compile time, so the installed binary fails with "cannot read starter
  config" once the folder moves or is deleted. It also edits the starter text with string `replace`.
- **Fix:** `const STARTER: &str = include_str!("../../spec/tags.starter.toml");`. Replace the two `replace` calls with
  `toml_edit` (already a dependency of `engine`) or a small helper next to the config code, so the library path and
  intake path are set structurally and TOML-escaped (paths with quotes or backslashes currently produce invalid TOML).
- **Tests:** `daemon/tests/` run with a missing config and `--library` pointing to a temp folder; assert the written
  config parses and has the library path (also one with a quote character in the path).

#### T9 (S2): config saves replace a symlinked `config.toml`
- **Where:** `engine/src/util.rs`, `write_atomic`.
- **Problem:** the temp file is created next to `path` and renamed over it. If `~/.config/wallpaper-sorter/config.toml` is
  a symlink (dotfiles repo, stow), the link is replaced by a regular file.
- **Fix:** resolve with `fs::canonicalize(path)` when the path exists and write to the resolved target (temp file in the
  target's folder). Keep the behaviour for missing files. Also name the temp file by appending `.tmp` to the full file
  name, not `with_extension`, so `index.jsonl`, `index.json` etc. can never collide.
- **Tests:** `engine/tests/cfgedit.rs`: a symlinked config is still a symlink after an edit and the target has the change.

#### T10 (S2): hand edits to the config are not reloaded
- **Where:** `daemon/src/daemon.rs` (`edit_config`, `set_config`); there is no file watching of the config.
- **Problem:** the running program keeps its in-memory config. The next UI edit re-reads the file from disk and applies
  the whole text, so earlier hand edits suddenly take effect at that moment, with no message.
- **Fix:** reload when the config file's mtime changes (check at the one-minute housekeeping tick and before every
  `edit_config`), and on SIGHUP. Validate with `Config::from_toml`; on a parse error keep the old config and print the
  error. After a reload request a rescan. Mention it in `README.md`.
- **Tests:** `daemon/tests/watch.rs` or `web.rs`: edit the file on disk, trigger the reload, the new tag takes effect.

#### T11 (S2): assigning with "also save a tag" is two steps
- **Where:** `daemon/src/web.rs`, route `POST /api/assign`.
- **Problem:** files are moved first and the tag is saved afterwards. If the tag fails validation, the API returns 400
  although the files already moved.
- **Fix:** validate the tag first (`validate(spec)` in `cfgedit`, or a dry `add_tag` on the current text) and refuse
  before moving anything; or return success for the move with a separate `tag_error` field. Prefer validating first.
- **Tests:** `daemon/tests/web.rs`: a bad tag leaves the files where they were.

#### T12 (S2): tags are edited by list position
- **Where:** `PUT /api/tags/N`, `DELETE /api/tags/N` in `daemon/src/web.rs`; `update_tag`, `delete_tag` in `cfgedit.rs`.
- **Problem:** a stale page (second tab, or a hand edit) can change or delete the wrong tag.
- **Fix:** send the tag's current `keywords` and `dest` along with the index and refuse with 409 if they differ.
- **Tests:** `daemon/tests/web.rs` and `engine/tests/cfgedit.rs`.

#### T13 (S2): thumbnails for AVIF, GIF and BMP
- **Where:** `daemon/src/thumbs.rs`; `image` is built with png, jpeg and webp only; the default `image_extensions` also
  has avif, gif and bmp.
- **Problem:** those files are sorted fine but their thumbnail request fails (broken tile).
- **Fix (pick one with the owner):** enable the `gif` and `bmp` features of `image` (small), and show a deliberate
  placeholder tile for AVIF; or return a clear 415 and let the UI render a placeholder with the extension.
- **Tests:** `daemon/tests/web.rs` for the chosen behaviour.

#### T14 (S2): smaller robustness items
- Web worker threads (`serve` in `daemon/src/web.rs`) have no panic guard; six panics would kill the web server while the
  daemon keeps running. Wrap `handle` in `std::panic::catch_unwind` and answer 500.
- `finish_folder_change` returns `Ok(())` when `out.report.error` is set, so the HTTP status is 200 with the error only in
  the body. Confirm every UI call site (`ui/pages.js`, `ui/pages2.js`) shows `error`, or return a non-200 status.
- `POST /api/folders` rolls back with `remove_dir` on the leaf only, leaving any parents it created.
- `PUT /api/settings` applies `gap_mode` and `setup_complete` in two separate config edits; make it one.
- `Pipeline::resolve` checks paths lexically (no `canonicalize`), so a symlink inside the library can point outside it.
  Low risk for a local tool; at minimum refuse paths whose existing prefix resolves outside the library and intake folders.
- `read_json` truncates bodies at 2,000,000 bytes and then reports "bad JSON"; return 413 instead.
- `GET /api/resort` and the other GET previews write files and take the big lock (known issue 4 in `App.md`). Cross-site
  pages can trigger a GET to 127.0.0.1 with a valid `Host` header. Consider rejecting requests whose
  `Sec-Fetch-Site` header is `cross-site` for GET as well.

### Phase 3: documentation and repository hygiene

#### T15 (S3): documentation drift
- `HANDOFF.md` (sections 1 and 4.3), `App.md` (section 17) and `README.md` say editing watched folders is not built.
  The API exists and is tested. Update after T7, and add `POST /api/intake`, `PUT /api/intake/N`, `DELETE /api/intake/N`
  and the `setup_complete` setting to the API tables in `README.md` and `App.md` section 13.
- `App.md` section 18 says items 1 to 4 are "not yet confirmed by a run" while three of them are struck through as resolved.
  Re-run the suite, then state plainly what was run and when.
- `core/tests/plan_cases.rs` still has an assertion message saying "at least 20 cases" while it checks 27.
- Re-count tests with `cargo test --workspace` and the UI suite before quoting numbers in `HANDOFF.md`.

#### T16 (S3): repository hygiene
- `chat.json` is in the repo root and not in `.gitignore`. It looks like a conversation transcript. Review it for private
  information, then delete it from the repo or add it to `.gitignore` (and purge it from history if the repo is public).
- `ui/design-mock.html` (about 2,200 lines) is embedded in the binary with `include_str!` and served at `/design`.
  Remove it from release builds (a cargo feature, or serve it only when `--design` is passed) to keep the binary small.
- Consider declaring `rust-version = "1.75"` in the workspace so the MSRV is enforced.
- `Cargo.toml` release profile uses `lto = true` and `codegen-units = 1`, which makes builds slow on a 2-core laptop.
  Try `lto = "thin"` and `codegen-units = 4` for everyday installs; keep the strict profile for tagged releases if wanted.
- `contrib/wallpaper-sorter.service`: add `Nice=10` and `IOSchedulingClass=idle` (and optionally `CPUSchedulingPolicy=idle`)
  so the start-up hashing of a large library does not slow the machine. Optionally add basic hardening
  (`NoNewPrivileges=yes`, `PrivateTmp=yes`); do not restrict home access.

### Phase 4: later (owner decides)

- Size caps: delete oldest thumbnails past a limit; keep the recent part of `log.jsonl` (origin records stay forever).
- Videos (`Video/` folder), fetching wallpapers from site APIs (never Pixiv): parked by the owner.
- Virtual scrolling for very large grids (today 240 at a time with "show more").
- Merge currently flattens subfolders (known issue 7 in `App.md`); design said "merge subfolders first".

---

## 5. Real-browser checklist (owner, before any new feature)

Run `scripts/try-on-copy.sh "$HOME/Pictures/Wallpapers"` and follow `HANDOFF.md` section 2.5 at a wide window and at
about 390 px, in dark and light. Pay particular attention to:

1. Layout at narrow widths; collapsible sidebar.
2. Long filenames overflowing in Inbox and Data.
3. Thumbnail grid with the full real library (cold cache: does the page stay responsive? this tests T6).
4. Focus after the 3-second self-refresh (typing in the assign sheet or tag tester must not lose focus).
5. Console messages (F12): any Content-Security-Policy complaints.
6. Save an image from the browser into the library and an intake folder and watch it appear without reloading.

Send back: screenshots, the window width, the console text, and the last lines of the terminal.

---

## 6. Verification commands

```
cargo build --all-targets                      # must finish with 0 warnings
cargo test --workspace --no-fail-fast          # all Rust tests
cd ui/test && npm install && SORTER_BIN=../../target/debug/wallpaper-sorter node --test --test-reporter=tap
scripts/collect-report.sh                      # everything, writes test-report.md
```

Rule from the owner: never claim something works that was not run. Say which commands were run and which were not.

---

## 7. Suggested order and definition of done

1. Section 5 (browser check) can happen in parallel with the code work.
2. T1, T2, T3 (data safety and start-up), each with tests, one commit each.
3. T4, T5 (intake visibility and safety), then T7 (Settings UI) which depends on both.
4. T8, T9, T10, T11, T12, T13, T14 in any order.
5. T6 after measuring on the real library.
6. T15, T16 last, or alongside.

A task is done when: the change is minimal, a test that failed before now passes, `cargo build --all-targets` has 0
warnings, `cargo test --workspace` and the UI tests pass, the docs describe the new behaviour, and the report says exactly
what was run.

---

## 8. Decisions to discuss with the owner before coding

The owner wants to **discuss before big steps**. Ask first about:

1. T5: should configs that omit `remove_empty_folders` keep the old default (true) for compatibility, or switch to false
   everywhere? (Recommended: false, and mention it in the docs.)
2. T6: acceptable approach for thumbnails under load: 503 and retry, background pre-generation, or both?
3. T13: enable GIF and BMP decoding (more compile time) or show placeholders?
4. T10: reload the config automatically (mtime check) or only on SIGHUP and restart?
5. T16: remove `/design` from release builds entirely, or keep behind a flag?
6. T14: is rejecting `cross-site` GET requests acceptable (could it break any intended use)?

---

## 9. Progress checklist

- [ ] Browser checklist done (section 5)
- [x] T1 no-replace moves
- [x] T2 torn log line / corrupt index
- [x] T3 scan survives bad files
- [x] T4 intake errors visible, lost watches re-added
- [x] T5 safe cleanup default and intake path validation
- [x] T6 responsiveness improved with non-blocking cold thumbnail generation
- [x] T7 Settings: edit watched folders
- [ ] T8 starter config embedded
- [ ] T9 symlinked config preserved
- [ ] T10 config reload
- [ ] T11 assign + tag order
- [ ] T12 tag edit by content check
- [ ] T13 AVIF/GIF/BMP thumbnails
- [ ] T14 smaller robustness items
- [ ] T15 docs updated and tests re-counted
- [ ] T16 `chat.json`, `/design`, build and service settings

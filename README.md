# Wallpaper Sorter

Start with `HANDOFF.md`: it is the single guide and todo list for the owner and AI agents. This README is only an overview and command reference.

Rust core for the wallpaper sorter (design notes and the web UI mock-up live elsewhere).

## What is here so far

- `core/`    crate `sorter-core`: pure logic, no file access
  - `config`     tags and settings (TOML)
  - `matcher`    filename -> destination folder, with the agreed rules
  - `numbering`  `<Prefix> <number>.<ext>`, next number, the four gap modes
  - `plan`       a list of actions (move, rename, send to Duplicates, leave, ignore) worked out from the
                 config, a snapshot of the library and the files that just arrived
  - `origin`     site and id from supported filename formats (Wallhaven, Zerochan, Konachan, yande.re,
                 Danbooru, Pixiv); Safebooru sources can also be added by hand
- `engine/`  crate `sorter-engine`: the part that touches the disk
  - `scan`   builds the library snapshot from a folder
  - `exec`   applies a plan with atomic no-replace moves; stops at the first real error; cross-drive copies create
              and sync the target before removing the source
  - `log`    append-only JSON-lines log of every action
  - `undo`   undo one action or a whole batch (newest first); if the old name is taken the file comes back with a " (2)" suffix
  - `index`  BLAKE3 hash of every image in the library, cached on disk by size and modification time
  - `origins` permanent record per image (original name, sources, size, why it was sorted), keyed by content hash
  - `pipeline` hash, plan, apply, and keep the index and the records up to date; opening a library gives every
                 existing file a record from its current name, and a file moved by hand is followed by its record
- `daemon/`  crate `wallpaper-sorter`: the program you run
  - `watcher`   inotify: a file counts when it is finished writing or moved in (creating it is not enough)
  - `debounce`  a file is sorted once nothing has happened to it and its size has not changed for a second
  - `daemon`    the run loop; sorts what is waiting at start, then everything that arrives
  - `web`       the small web server (127.0.0.1 only) with the JSON API below
  - `thumbs`    thumbnails (400 px JPEG), drawn on first request, cached by content hash in `~/.cache/wallpaper-sorter/thumbs`
  - `contrib/wallpaper-sorter.service`  a systemd user unit
- `ui/`      web page source and Vite config; `test/` drives the real program in a simulated browser (jsdom)
- `scripts/` `collect-report.sh` runs every test suite and writes one report file; `try-on-copy.sh` launches a temporary library copy
- `spec/`    the specs the code must follow
  - `tags.starter.toml`   starter tags drafted from the folder tree
  - `cases.csv`           324 matcher cases (264 real filenames + 60 edge cases), made by `ref_matcher.py` / `gen_cases.py`
  - `numbering.csv`       29 hand-written numbering cases (`gen_numbering.py` writes it)
  - `plan_cases.toml`     31 hand-written plan cases (duplicates, gap modes, batches, re-sort stays)
  - `origins.csv`         26 hand-written source and manual-entry cases

## Try it

For a safe browser trial, run `scripts/try-on-copy.sh "$HOME/Pictures/Wallpapers"` (optional arguments are a config file
and port; the defaults are your user config or the starter tags, and port 8422). It excludes the original `.sorter`
metadata, redirects intake folders to temporary empty folders, and removes its temporary copy on exit. It uses hard links
when possible and otherwise makes a full copy. With hard links, sorter moves and renames are isolated to the copy, but
editing an image's contents through the copy would also change the original. Do not edit image contents during the trial.

For normal use:

    cargo build --release
    mkdir -p ~/.config/wallpaper-sorter && cp spec/tags.starter.toml ~/.config/wallpaper-sorter/config.toml
    target/release/wallpaper-sorter --dry-run        # shows what it would do; moves nothing
    target/release/wallpaper-sorter --once           # sorts what is waiting now, then exits
    target/release/wallpaper-sorter                  # keeps running (Ctrl-C to stop)

For one command that builds and starts the sorter, waits for the UI, and opens it in your browser, run
`./scripts/start-and-open.sh`. It stays in the foreground; press Ctrl+C to stop the sorter. Pass normal sorter
options such as `--config FILE` or `--port N`; for a port set in the config, set `WALLPAPER_SORTER_PORT` to match.
On first run with no config, it creates a starter config for the existing `~/Pictures/Wallpapers` folder (or the
folder passed with `--library`) and never overwrites an existing config. It requires `curl` and the Linux desktop
`xdg-open` command. If the UI is already responding at that address, the script opens it without starting a second
instance.

  Preview a whole-library Re-sort without the browser with `target/release/wallpaper-sorter --resort-preview`;
  add `--folder Wuthering-Waves/Chisa` to limit the scope. It prints action counts before listing changes and does not
  move or rename images. Like other runs, opening the library may initialize or refresh its `.sorter` metadata.

While it runs, the web page and API are at http://127.0.0.1:8421/ (`--port N` or `[server] port` in the config
to change it, `--no-web` to turn it off). The page there is the real UI (Vite-built static assets embedded in the binary); no frontend server or network access is needed at runtime.

For frontend development, install the UI build dependencies with `npm --prefix ui ci`, then run `npm --prefix ui run dev` while the sorter is running on port 8421. The full UI now uses React and TypeScript with TanStack Router (hash URLs), TanStack Query, Zod-validated API clients, and Zustand stores. Vite proxies API requests to the local sorter. A normal Cargo build automatically rebuilds the UI when those npm dependencies are installed; otherwise it uses the checked-in `daemon/ui-dist/` bundle.

What it does: it watches the library folder (top level only) and every folder listed under `[[intake]]` in the
config (subfolders included, also ones created later). Files already waiting are sorted at start. Images in the
library's subfolders are never touched automatically; the Re-sort page previews applying current tags to existing
images, then applies the result as one undoable batch.
It keeps its own files in `<library>/.sorter/` (hash cache, origin records, log); even `--dry-run` creates that folder.
Try it on a copy of your library first: `--library /some/copy`.

Behaviour worth knowing: partial downloads (`.crdownload`, `.part`) are ignored until they are renamed to an image
name; files that an undo put back are left alone until they change, including across daemon restarts; an intake folder that does not exist yet is
picked up when it appears; empty subfolders are removed only when `remove_empty_folders` is enabled for that intake, and hidden folders are never removed.
On startup, a malformed final action-log record is discarded, a corrupt hash cache is rebuilt, and corrupt origin data is preserved in a `.corrupt` backup before rebuilding.
Unreadable or vanished individual files do not abort the library scan; old hash entries are retained on access errors and removed when a path is confirmed missing.

## The API

JSON over HTTP, on 127.0.0.1 only. Requests must carry the right `Host` header, and anything that changes
something must be `Content-Type: application/json` (and, if it has an `Origin`, one from this address), which
keeps other websites from using it through your browser. Paths are library-relative or absolute and must stay inside
the library or an intake folder. File moves and renames go through the log and can be undone; creating an empty
folder is not a logged file action.

| Request | What it does |
|---|---|
| `GET /api/status` | library, intake folders, counts, settings |
| `GET /api/inbox` | loose images in the library folder and images in intake folders, with why they wait and their origin |
| `GET /api/folders` | every folder: prefix, file count, next number, gaps |
| `GET /api/images?folder=` | images in a folder, in number order, with origin |
| `GET /api/duplicates` | what is in the Duplicates folder and what each one duplicates |
| `GET /api/data?q=&site=&folder=&unknown=1&limit=&offset=` | origin records, filtered |
| `GET /api/activity?limit=` | the log, newest first, with `undone` and `undoable` |
| `GET /api/tags`, `POST /api/tags`, `PUT /api/tags/N`, `DELETE /api/tags/N` | the tags (edits the config file, keeps its comments) |
| `POST /api/tags/test` `{filename}` | what would happen to a filename: words, rule, folder, new name |
| `POST /api/assign` `{paths, folder, tag?}` | put images in a folder; with `tag`, also save a tag |
| `POST /api/delete` `{paths}` | move to `.sorter/trash` (undoable); `POST /api/trash/empty` removes it for good |
| `POST /api/duplicates/empty` | move everything in Duplicates to the trash |
| `GET /api/gap-fill?folder=&mode=last\|renumber` | the renames that would close the gaps |
| `POST /api/gap-fill` `{folder, mode}` | do them |
| `GET /api/resort?folder=` | preview applying current tags to every existing image, or one folder and its children |
| `POST /api/resort` `{folder?}` | recompute and apply that preview as one undoable batch |
| `POST /api/folders` `{folder}` | create an empty folder and add its config entry (creation itself is not undoable) |
| `GET /api/folder-rename?from=&to=` / `POST /api/folder-rename` `{from, to}` | preview and rename a folder tree; tag and folder settings follow it |
| `GET /api/folder-merge?from=&to=` / `POST /api/folder-merge` `{from, to}` | preview and move images into another folder using its numbering and duplicate rules |
| `GET /api/folder-prefix?folder=&prefix=` / `PUT /api/folder-prefix` `{folder, prefix}` | preview and change a folder's numbering prefix |
| `POST /api/undo` `{batch}` or `{id}` | undo a batch or one action |
| `PUT /api/origins` `{hash, site, id}` | set an image's source by hand |
| `GET/PUT /api/settings` | settings (`gap_mode`, `setup_complete`) |
| `POST /api/rescan` | look at the library folder and intake folders again (also done after a tag is added or changed) |
| `POST /api/intake` `{path, recursive, remove_empty_folders}` / `PUT /api/intake/N` / `DELETE /api/intake/N` | add, edit or remove an intake folder; watch state and errors are returned in `/api/status` |
| `GET /api/thumb/<hash>`, `POST /api/thumb/<hash>/refresh`, `GET /api/image/<hash>` | cached thumbnail, regenerate a thumbnail, and full image, addressed by content hash |
| `POST /api/duplicates/restore` | restore duplicate copies into a destination folder as new numbered images, undoable |

## Run the tests

    cargo build
    cargo test
    npm --prefix ui ci
    npm --prefix ui run typecheck
    npm --prefix ui test
    SORTER_BIN=./target/debug/wallpaper-sorter node --test ui/test/ui.test.js

- `core/tests/spec_cases.rs`       every row of `cases.csv` through the Rust matcher
- `core/tests/numbering_cases.rs`  every row of `numbering.csv`
- `core/tests/plan_cases.rs`       every case in `plan_cases.toml`
- `core/tests/origin_cases.rs`     every row of `origins.csv`
- `engine/tests/flow.rs`           scan, plan, apply, log and undo on real temporary folders
- `engine/tests/pipeline.rs`       hashing, duplicates across batches and sites, the hash cache, origin records, undo
- `daemon/tests/watch.rs`          real inotify on temporary folders: downloads, slow writers, new intake folders, undo
- `daemon/tests/resort_preview_cli.rs`  CLI Re-sort preview counts, folder scope, and no image mutation
- `daemon/tests/web.rs`            the API over real HTTP: views, assign, tags, undo, thumbnails, security checks
- `ui/src/`                        Vitest component and store tests
- `ui/test/ui.test.js`             jsdom UI flows against the real binary, including Library source counts
- `engine/tests/ops.rs`, `engine/tests/cfgedit.rs`  the UI's operations and the config editing; `ops.rs` also builds
  the real `tree_images.txt` library, compares a whole-library Re-sort with `cases.csv`, and checks its second preview
  is idempotent

To change a matching rule: edit `spec/ref_matcher.py`, run `cd spec && python3 gen_cases.py`, then make `cargo test` pass again.

## Notes

- `Cargo.lock` pins `indexmap`, `hashbrown`, `blake3` and `image` to older releases so the project also builds with Rust 1.75.
  BLAKE3 is built with its `pure` feature, so no C compiler is needed.
  On a current toolchain you can run `cargo update` to take the newest versions.
- Not built yet: a size cap for the thumbnail cache and a size cap for the log.

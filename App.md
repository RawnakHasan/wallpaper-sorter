# Wallpaper Sorter: app details

A small Linux background program, written in Rust, that sorts new wallpaper images into numbered folders by their filenames, with a local web page to manage everything. This file describes what the app is and how it behaves, as of the latest repository snapshot.

How this was written: from reading the source files (core, engine, daemon, ui, spec, tests, HANDOFF.md, README.md). The code was built and tested for the latest undo persistence work. The Rust workspace passed, including restart-specific watcher tests, and all 22 UI tests passed.

---

## 1. What it does

It watches `~/Pictures/Wallpapers` (top level only) and any extra "intake" folders (for example `~/Downloads/pixiv`). When an image has finished downloading it:

1. Checks for an exact copy (BLAKE3 content hash). A copy goes to a `Duplicates` folder inside the library.
2. Reads the filename, finds matching tags (keyword lists), and picks a folder, for example `Wuthering-Waves/Chisa/`.
3. Moves and renames the file to `<Prefix> <number>.<same extension>`, for example `Chisa 19.png`.
4. Saves a permanent record of where the image came from (site, id, artist, link) and logs every action so it can be undone.

Images it cannot place wait in an **Inbox**. Files already inside library subfolders are never touched automatically. The **Re-sort** page applies the current tags to existing images, with a preview first.

---

## 2. Owner and preferences

- Owner: rawnak. Old Linux laptop (AMD A10-5750, 2 cores / 4 threads, no GPU), so everything is kept light.
- Wants minimal and lightweight: few dependencies, no database, no desktop notifications, flat quiet UI.
- Wants to discuss big steps before code. "yep go ahead" means proceed. "change as you wish" means decide and report.
- Wants short plain explanations, tables for comparisons, and tests run on their own machine with a readable report sent back.
- Not wanted: Pixiv API work (the browser extension handles Pixiv downloads).

---

## 3. Where things live

| What | Where |
|---|---|
| Library | `~/Pictures/Wallpapers` (set by `library` in the config or `--library`) |
| Intake folders | `[[intake]]` entries in the config (default example: `~/Downloads/pixiv`) |
| Config (tags, settings, folders) | `~/.config/wallpaper-sorter/config.toml` (or `$XDG_CONFIG_HOME/wallpaper-sorter/config.toml`) |
| Hash cache | `<library>/.sorter/index.jsonl` |
| Origin records (permanent) | `<library>/.sorter/origins.jsonl` |
| Action log | `<library>/.sorter/log.jsonl` (append-only) |
| Trash | `<library>/.sorter/trash/` |
| Folder-change config undo | `<library>/.sorter/folder-config-undo.json` |
| Thumbnails | `~/.cache/wallpaper-sorter/thumbs/` (safe to delete) |

Deleting `<library>/.sorter` loses only records, never images. Hidden folders (names starting with `.`) are not part of the library.

---

## 4. Matching rules

The agreed rules are implemented in `core/src/matcher.rs` and mirrored by `spec/ref_matcher.py`.

**Extension.** The extension is the part after the last dot when it is 2 to 4 letters or digits. Only image extensions are processed (default `jpg jpeg png webp avif gif bmp`). Anything else (for example `.crdownload`, `.part`, `.mp4`) is ignored.

**Words from a filename:**
- A Wallhaven id prefix (`wallhaven-xxxxxx`) is removed.
- Everything from `drawn_by_` on is dropped (the artist and hash).
- Hex runs of 16 or more characters are dropped.
- Text is split at non-letters, camelCase boundaries, and letter/digit boundaries, then lowercased.
- Digit-only words of 5 or more digits are dropped.
- Stop words are dropped: `and more by drawn full com konachan yande re wallhaven original`.

**Tag matching:**
- Keywords match whole words, any case. A keyword can be a phrase (`wuthering waves`).
- Per-tag options: `match = "substring"` (may match inside longer words), `strict_words` (the tag applies only if at least one of these words is also in the name; example: Robin needs "honkai"), `generic = true` (applies only if no specific tag matched and the cleaned name has at most 4 words; used for Nature and Space).
- The deepest folder wins (character beats game).
- Different characters of the same game go to the shared parent folder (`Wuthering-Waves/`).
- Unrelated folders are a **conflict** and wait in the Inbox.
- No match waits in the Inbox.

Examples (from the spec table): `Chisa waterfall.png` goes to `Wuthering-Waves/Chisa` (specific beats generic); `Chisa Skadi.png` is a conflict; `workspace.png` does not match "space".

---

## 5. Naming and numbering

- Name: `<Prefix> <N>.<extension exactly as saved>`.
- Prefix for a folder: an explicit `[[folder]]` prefix, else a tag's `prefix`, else the folder name with hyphens turned into spaces (`Wuthering-Waves` becomes `Wuthering Waves`).
- Existing files count as numbered if they match the prefix (case-insensitive), a number (leading zeros accepted), and an image extension.
- Next number = highest + 1.

**Gap modes** (`[settings] gap_mode`, changeable on the Settings page):

| Mode | What happens |
|---|---|
| `keep` (default) | Gaps stay. Nothing is renamed. |
| `lowest` | The next file takes the lowest free number. Nothing is renamed. |
| `last` | The highest-numbered files are renamed into the gaps, then the new file goes at highest + 1. |
| `renumber` | The folder is renumbered 1 to N, then the new file goes at N + 1. Refuses if two files share a number. |

The Library page can also close gaps on demand (modes `last` or `renumber`) with a preview.

---

## 6. Duplicates

- Exact copies only, found by BLAKE3 hash, checked before tag matching, across the whole library (not inside the Duplicates folder).
- A copy is moved (never deleted) to `Duplicates/` inside the library. A taken name gets a suffix: `name (2).ext`.
- A file already in the library is never its own duplicate.
- A copy from another site adds a source to the original's record ("also seen on").
- Duplicates are removed only when you ask (Delete, or Empty Duplicates folder). That moves them to the trash, which is undoable.

---

## 7. Origin records

Each image gets one record keyed by its content hash, kept permanently. Fields: hash, current path, original name, sources, date added, note (why it is where it is), width, height. Existing files get a record when the library is first opened. A file moved by hand is followed by its record on the next reconcile, because the hash is the identity.

Sources are worked out from the original filename:

| Site | Filename pattern | Link |
|---|---|---|
| Wallhaven | `wallhaven-xxxxxx` (6 letters/digits) | `wallhaven.cc/w/<id>` |
| Zerochan | `Name.full.<id>` | `zerochan.net/<id>` |
| Konachan | `Konachan.com - <id> ...` | `konachan.com/post/show/<id>` |
| yande.re | `yande.re <id> ...` | `yande.re/post/show/<id>` |
| Danbooru | `__tags__<32-char md5>` | `danbooru.donmai.us/posts?tags=md5:<md5>` |
| Pixiv | `<id>_p<page>`, id of 5+ digits; parent folder `<artist>-<artistID>` gives the artist | `pixiv.net/artworks/<id>` |
| Safebooru | manual only (set by hand on the Data page) | `safebooru.org/...&id=<id>` |
| Unknown | anything else | none |

A `naive-` prefix is ignored. You can set a source by hand on the Data page.

---

## 8. Watching behaviour

- inotify, reacting only to "finished writing" and "moved in", not file creation.
- The library root is watched non-recursively on purpose, so the sorter's own moves into subfolders cannot loop. Intake folders are watched recursively, including folders created later.
- A file counts as finished when nothing has happened to it and its size has not changed for 1 second.
- Files already waiting at startup are sorted without any event.
- Partial downloads (`.crdownload`, `.part`) are ignored until renamed to an image name.
- An intake folder that does not exist yet is picked up when it appears.
- Empty intake subfolders are removed after ten minutes. The intake folder itself stays.
- Housekeeping runs every minute.
- After an undo, the restored file is left alone until it changes. Its size and modification-time fingerprint is stored in the action log, so the hold survives daemon restarts; a changed file is released and sorted normally.
- Adding or changing a tag makes the program look at waiting files again, so files that now match are sorted at once (undoable).

---

## 9. Safety, log and undo

- Nothing is ever overwritten. A move fails if the target exists.
- Moves use atomic no-replace renames. If a move crosses drives, the target is created exclusively, copied, synced
  and size-checked before the source is removed. If atomic no-replace is unsupported, the move fails rather than
  risking replacement.
- A batch stops at the first real error. A source that vanished is skipped.
- Every move, rename and duplicate move is logged (id, batch, time, kind, from, to, note).
- Undo works on one entry or a whole batch (newest first). If the old name is taken, the file comes back with a ` (2)` suffix. If the file was moved since, undo says so. Undo entries cannot be undone.
- Delete = move to `.sorter/trash`, undoable. The trash is emptied only on request.
- Folder changes (rename, merge, prefix) save inverse-operation metadata plus before/after config text. Undo applies the inverse to the current config, preserving unrelated later edits.
- Startup truncates a malformed final log record, rebuilds a corrupt hash cache, and preserves corrupt origin records in a `.corrupt` backup before rebuilding them from library files.

---

## 10. The web page

Runs at `http://127.0.0.1:8421/` (`--port N` or `[server] port` changes it, `--no-web` turns it off). Plain HTML, CSS and JavaScript with no build step, embedded in the binary. Dark first, flat and minimal, self-hosted fonts (Hanken Grotesk, JetBrains Mono). Works offline. It polls the status every 3 seconds, so the page follows the background sorter without reloading.

| Page | What it does |
|---|---|
| Overview | Counts (Inbox, library images, Duplicates, records), the last 8 actions with Undo, watched folders, a Re-sort link. |
| Inbox | Thumbnail grid of waiting images with the reason (No match, Conflict, Ready). Filter by reason and by intake folder. Click or shift-click to select, Ctrl+A for all, Esc to clear, `a` to assign, Delete to delete. Details sheet shows the full image and its origin link. |
| Assign sheet | Folder picker with type-ahead and recent folders, a live preview of the new name, and an optional "Also save a tag" with keyword suggestions from the filename. Shows an Undo toast afterwards. |
| Library | Folder tree, breadcrumbs, facts (prefix, next number, image count, gaps, counts per source), image grid in number order. New folder, Manage folder (rename, merge, prefix, each with a preview), Close gaps. The grid shows 240 at a time with a "show more" button. |
| Tags | Tags grouped by destination folder, add/edit/delete, and a filename tester showing the words, the rule, the folder and the new name. |
| Duplicates | List with what each one duplicates, Restore as a new numbered image, Delete, Empty Duplicates folder (to trash). |
| Data | Origin records table with search, site filter, folder filter, "Unknown source" filter, 50 per page. Set a source by hand. |
| Re-sort | Pick the whole library or one folder, scan and preview, then apply as one undoable batch. Changes are listed; stays and no-match images are only counted; conflicts are listed as "needs a decision". Lists are capped at 200 rows. |
| Activity | The log grouped by day and batch, with Undo per row or per batch. |
| Settings | Gap mode, watched folders (read-only, edit the config file), image types, theme, empty trash. |

The top-bar search opens the Data page filtered. Filenames are always put on the page as text, never as HTML.

---

## 11. Re-sort and folder management

**Re-sort** recomputes the plan every time you apply (a preview can go stale while the watcher works). Rules:
- A file already in its destination folder with the right numbered name stays put and is reported as "stays".
- A file in its destination folder with a different name is renamed to the next number.
- Exact copies are sent to Duplicates.
- Files with no match or a conflict are left where they are.
- The Duplicates folder is never re-sorted. Files are processed oldest first.

**Folder management:**
- *New folder*: creates the directory and a `[[folder]]` entry in the config. Not a logged file action.
- *Rename*: one directory rename, logged. Tag and folder settings follow it. If the new name would change the numbering prefix, the old prefix is pinned in `[[folder]]`, so files keep their names and numbering continues.
- *Merge*: moves the images of a folder (and its subfolders, flattened) into another folder using the destination's numbering and duplicate rules, removes empty source folders, and repoints tags.
- *Prefix change*: renames files that follow the old numbered scheme; other files are left alone.

---

## 12. Config file

```toml
library = "~/Pictures/Wallpapers"

[server]
port = 8421

[[intake]]
path = "~/Downloads/pixiv"
recursive = true
remove_empty_folders = true

[settings]
image_extensions = ["jpg", "jpeg", "png", "webp", "avif", "gif", "bmp"]
duplicates_folder = "Duplicates"
generic_max_words = 4
gap_mode = "keep"        # keep | lowest | last | renumber

[[tag]]
keywords = ["chisa"]
dest = "Wuthering-Waves/Chisa"
# optional: prefix = "...", match = "substring", strict_words = [...], generic = true

[[folder]]
path = "Nature"
prefix = "Nature"        # optional stable numbering prefix
```

The starter file `spec/tags.starter.toml` is drafted from your folder tree (Wuthering Waves characters, Arknights, Honkai Star Rail, Honkai Impact, Frieren, Harry Potter, plus generic Nature and Space). The page edits tags and gap mode in place with `toml_edit`, which keeps your comments and layout.

---

## 13. Web API

JSON over HTTP on 127.0.0.1 only. Security: the `Host` header must match, anything that changes state must send `Content-Type: application/json`, an `Origin` header (if present) must match, paths must stay inside the library or an intake folder with no `..`, and the page is served with a strict Content-Security-Policy.

| Request | What it does |
|---|---|
| `GET /api/status` | Library, intake folders, counts, settings |
| `GET /api/inbox` | Waiting images with reason and origin |
| `GET /api/folders` | Folders with prefix, count, next number, gaps |
| `GET /api/images?folder=` | Images in a folder in number order |
| `GET /api/duplicates` | Duplicates and what each duplicates |
| `GET /api/data?q=&site=&folder=&unknown=1&limit=&offset=` | Origin records, filtered |
| `GET /api/activity?limit=` | The log, newest first |
| `GET/POST /api/tags`, `PUT/DELETE /api/tags/N` | Tags |
| `POST /api/tags/test` | Test a filename |
| `POST /api/assign` | Put images in a folder (optionally save a tag) |
| `POST /api/delete`, `POST /api/trash/empty` | Delete to trash, empty trash |
| `POST /api/duplicates/empty` | Move all duplicates to the trash |
| `GET/POST /api/gap-fill` | Preview and close gaps |
| `GET/POST /api/resort` | Preview and apply a re-sort |
| `POST /api/folders` | Create a folder |
| `GET/POST /api/folder-rename`, `GET/POST /api/folder-merge`, `GET/PUT /api/folder-prefix` | Preview and apply folder changes |
| `POST /api/undo` | Undo a batch or one entry |
| `PUT /api/origins` | Set a source by hand |
| `GET/PUT /api/settings` | Settings (gap mode) |
| `POST /api/rescan` | Look at all folders again |
| `GET /api/thumb/<hash>`, `GET /api/image/<hash>` | Thumbnail (400 px JPEG, cached by hash) and full image |
| `POST /api/duplicates/restore` | Restore selected duplicates into a destination folder while bypassing duplicate detection once |

---

## 14. Running it

```
cargo build --release
mkdir -p ~/.config/wallpaper-sorter && cp spec/tags.starter.toml ~/.config/wallpaper-sorter/config.toml
target/release/wallpaper-sorter --dry-run     # shows what it would do, moves nothing
target/release/wallpaper-sorter --once        # sorts what is waiting, then exits
target/release/wallpaper-sorter               # keeps running (Ctrl-C to stop)
```

Options: `--config FILE`, `--library DIR`, `--dry-run`, `--once`, `--verbose`, `--port N`, `--no-web`, `--help`. `--dry-run` still creates the hidden `.sorter` folder.

As a service: `cargo install --path daemon`, copy `contrib/wallpaper-sorter.service` to `~/.config/systemd/user/`, then `systemctl --user enable --now wallpaper-sorter`.

Try it on a copy of your library first (`--library /some/copy`). Expected on your real library: only about 5 of the 93 loose images match a tag (62 are Wallhaven files whose names say nothing), so most wait in the Inbox.

---

## 15. Code layout

```
core/     pure logic, no file access
  config, matcher, numbering, plan, origin
engine/   touches the disk
  scan, exec, log, undo, index, origins, pipeline, ops, cfgedit
daemon/   the program
  watcher (inotify), debounce, daemon (run loop), web (tiny_http), thumbs, main
ui/       plain HTML/CSS/JS embedded with include_str!
spec/     the rules as data, plus a Python reference matcher
scripts/  collect-report.sh
```

Main dependencies: serde, serde_json, toml, toml_edit, blake3 (pure feature, no C compiler), imagesize, inotify, libc, tiny_http, image (png, jpeg, webp only). `Cargo.lock` pins a few crates so it builds on Rust 1.75.

Data flow for a new file: watcher event, debounce, hash, plan (pure), apply (moves and log), update the hash index and origin records.

---

## 16. Tests and the spec

The spec tables are the real specification. Change the table first, then the code.

| Table | Rows | What it pins down |
|---|---|---|
| `spec/cases.csv` | 324 | Matcher results for 264 real filenames and 60 edge cases (generated from the Python reference) |
| `spec/numbering.csv` | 29 | Next number and gap modes (hand-written) |
| `spec/plan_cases.toml` | 31 | Batches, duplicates, assign, gap modes, re-sort stays (hand-written) |
| `spec/origins.csv` | 26 | Site and id parsing, manual sources (hand-written) |

Test suites: table tests in core, end-to-end tests on real temporary folders in engine, real inotify tests and real HTTP tests in daemon, and jsdom UI tests that drive the compiled binary. Run `scripts/collect-report.sh` to get one `test-report.md`.

---

## 17. Not built yet

- Editing watched folders from the Settings page (config file only for now).
- Size caps for the thumbnail cache and the log.
- Videos (the `Video/` folder of mp4s). Parked by the owner.
- Fetching wallpapers from site APIs. Parked by the owner (never Pixiv).

---

## 18. Known issues

Items 1 to 4 are from my reading of the latest code and are not yet confirmed by a run. Items 5 to 9 were already known.

| # | Issue | Effect |
|---|---|---|
| 1 | ~~Numbered in-place Re-sort files were missing from duplicate-hash registration.~~ **Resolved:** exact in-place hashes are reserved before planning. | Identical loose copies now point to the numbered in-place file as their original. |
| 2 | ~~Re-sort API `changes` counted stay items.~~ **Resolved:** change counts include only move, rename, and duplicate actions. | Stays and leaves no longer inflate preview or merge change counts. |
| 3 | ~~Destination detection used a path suffix.~~ **Resolved:** Re-sort uses exact library-relative paths. | A nested folder with the same tail is no longer mistaken for an already-in-place file. |
| 4 | The Re-sort preview is a GET that hashes the whole library, writes index and record files, and holds the single mutex. | The page and API stall during a large preview. |
| 5 | ~~Folder-change undo is blocked after later config edits.~~ **Resolved:** inverse-operation undo. | Undo rewrites only the folder changes on the current config text, preserving unrelated later edits. |
| 6 | The "held after undo" set is in memory. | **Resolved:** undo holds now persist. Restored files keep their size and modification-time fingerprint in the log and remain held across restarts until changed. |
| 7 | Merge flattens subfolders. | Design said "merge subfolders first". |
| 8 | `/api/status` lists the Inbox and Duplicates every 3 seconds. | Fine for hundreds of files, worth caching for tens of thousands. |
| 9 | The cause of the old UI-test connection resets is still unknown. | Check the browser console in a real browser. |

Smaller: the assertion message in `core/tests/plan_cases.rs` still says "at least 20 cases" while it checks 27; the browser checklist in `HANDOFF.md` section 2.5 has not been done in a real browser yet.
# Wallpaper Sorter — UI redesign brief

For the UI designer: redesign the existing product, not a hypothetical future version. This brief describes what the current UI and local daemon actually provide. Examples are illustrative; do not treat them as real user data.

## 1. Product

Wallpaper Sorter is a local-first wallpaper organizer for one person using a desktop browser on the same Linux computer as the program. It watches a library folder and optional intake folders, and can also fetch supported posts from image sites.

The core loop is: bring wallpapers in; sort them into folders by matching filename words and saved tags; review anything ambiguous in the Inbox; correct assignments or tags; re-sort existing files when rules change; undo file operations if needed. Images are renamed with the destination folder’s prefix and sequence number. Exact duplicates are kept separately, not silently discarded.

The web UI is served by the daemon at a local address, normally `http://127.0.0.1:8421/`. It is not a cloud service or a multi-user workspace.

## 2. Full route tree

All ten routes below exist today; there are no new or changed routes in this brief.

- `/` — Overview. Counts, Fetch box, recent activity, watched folders, and first-run completion.
- `/inbox` — Inbox. Review unsorted or conflicting images and assign them.
- `/library` — Library. Browse folders and images, manage files, and open image Details or the full-screen viewer. The folder is an optional `?folder=` search parameter, not another route.
- `/search` — Browse. Search or browse supported public sites and download results.
- `/tags` — Tags. Create and manage filename-matching rules and test filenames.
- `/duplicates` — Duplicates. Review copies, restore them as new images, or send them to trash.
- `/data` — Data. Search permanent image-origin records, edit sources, and look up metadata.
- `/resort` — Re-sort. Preview applying current rules to existing library files and apply the changes.
- `/activity` — Activity. Review recent file actions and undo individual actions or batches.
- `/settings` — Settings. Configure numbering, intake folders, fetch safeguards and credentials, appearance, and the optional wallpaper script.

## 3. Screen-by-screen inventory

### App shell — present on every route

- Top bar: “Wallpaper Sorter” brand; “Search images” input; connection indicator; “Scan now”.
- Enter in the global search input navigates to Data with the text as a name/ID search.
- Connection indicator says “Connecting…”, “Watching”, or “Not connected”. Status is polled every three seconds.
- “Scan now” requests a rescan and shows “Looking at the folders again” or an error toast.
- Navigation rail: Overview, Inbox, Library, Browse, Tags, Duplicates, Data, Re-sort, Activity, Settings. Inbox shows its current count when nonzero.
- Route changes close active layers, clear selection, clear registered page shortcuts, and reset main scroll.
- Keyboard shortcuts outside text inputs/selects/textareas: Escape closes a layer, otherwise clears selection; Ctrl+A selects all when the current page supports it; `a` opens assignment/move for selected images; Delete requests deletion. Image grids also support click selection, Shift-click range selection, Space/Enter selection, and a details button. The Library has drag-and-drop to folders. The full-screen Library and Browse viewers use left/right arrow keys.
- Loading/error states are described under each page. The shared UI uses visible focus outlines and native dialogs.

### Overview — `/`

- Header: “Overview”, image count and library path, “Re-sort library” link.
- Four linked count cards: Inbox waiting, Library images, Duplicates, and origin Data records.
- Fetch box, described separately below.
- “Recent activity”: up to eight activity rows, each with time, action, shortened path transition, and Undo when available. Empty text: “Nothing yet. Sorted images show up here, with an Undo button.”
- “Watched folders”: library root and each intake path, with watching/existence/error badges.
- First-run welcome panel appears until setup is marked complete; includes library path and “Finish setup”.
- Initial loading says “Loading…”. Status/activity load failures show the error and “Try again”.

### Fetch box — Overview panel

- Heading “Fetch from supported sites”; explains one post ID or link per line and automatic site recognition from links.
- “Site for bare IDs” selector: Wallhaven, Danbooru, yande.re, Safebooru, Konachan.net, Zerochan · Unrated. Zerochan is disabled until a username is saved.
- Multiline “Post IDs or links” input and Fetch button. Inputs and button are disabled while submitting or while the current job is unfinished.
- Each returned row displays a state chip (Queued, Downloading, Sorted, Inbox, Duplicate, Error), original input, and per-item message. Every Zerochan row also shows “Unrated”, regardless of the warning preference.
- Fetch is asynchronous. Status is polled about every 750 ms until done; each item can succeed or fail independently. Submit errors show inline; a failed status poll shows an error and “Retry status”.
- For a completed Danbooru result with an unmatched character, the panel offers “Create tag” and “Not now”. The tag editor is seeded with the character and a suggested destination, optionally nested under an existing series tag. Saving creates the tag and assigns the image; that can immediately sort other matching waiting images. Tag lookup errors are shown inline.
- Submitting any Zerochan item shows one non-blocking warning toast when the preference is on: “Zerochan has no content ratings, so downloads are not filtered and may include mature content.” Its “Don’t show again” action disables the warning in Settings. Fetch starts immediately; the toast does not gate it.

### Inbox — `/inbox`

- Header with waiting count; “Filter by reason” selector (Any reason, No match, Conflict, Ready); “Filter by folder” appears when there is more than one intake source.
- Image grid cards show local thumbnail, filename, optional source-site subtitle, reason label, hover/focus filename, selection mark, Details icon. Conflict cards explain matched phrases in their title; Ready means a tag now matches and a scan will sort it.
- If selected: sticky action bar shows count, “Assign to folder…”, “Rebuild thumbnails”, “Delete”, “Select all”, and “Clear”.
- Empty states: “Inbox clear” when there are no items; “Nothing matches these filters” when filtering hides them. Query error includes “Try again”.
- Details is a side sheet. It shows a local full image, filename, waiting reason, intake folder, original filename, resolution, added time, sorting note/rating if present, source badges/IDs/links, editable source, and “Look up tags” where supported.
- Details may show conflict “Possible destinations” buttons with the folder and matching phrase; clicking one assigns directly. Artist and site tags are separate selectable chips. Selecting tags reveals “Assign with selected tags (N)…”.
- Detail actions: Assign…, Delete, Rebuild thumbnail; source save/lookup; destination candidate choice; create a tag using selected metadata tags. Lookup may sort the image out of Inbox; otherwise it stays there and the detail is refreshed.
- Assign sheet: chosen filenames/count; editable folder autocomplete; prospective numbered filename; metadata site-tag chips that can be included/excluded; “Also save a tag, so this does not happen again”; when enabled, optional Generic tag checkbox (on by default), additional keyword chips, filename-derived suggestions, and Assign. Saving a tag requires confirmation. Missing destination/keywords and server errors appear inline. Files that are exact duplicates may instead go to Duplicates.
- A delete confirmation says deletion moves the image(s) to trash and can be undone. Mutations surface errors through a toast or inline error; successful moves/deletes include Undo when a batch exists.

### Library — `/library`

- Two-pane layout: folder tree and active folder. Tree rows show nested indentation, folder name, image count, active state; accepts dragged selected images as a drop target. Pointer/focus warms the folder query.
- Main header shows folder name and “New folder”, “Manage folder…”, and (if gaps exist) “Close gaps…”.
- Breadcrumb buttons navigate to ancestors. Facts show prefix, next number, image count, gaps, and per-source counts (first known source per image, otherwise Unknown).
- Local image grid uses the shared selection/details/full-screen controls. Images are ordered by folder numbering. Sticky actions: “Move to folder…”, “Rebuild thumbnails”, “Delete”, plus Select all/Clear.
- Empty states: if there are no folders, “No folders yet” plus New folder; an empty current folder says “No images in this folder”. List/query errors show “Try again”.
- Dragging selected images to another tree folder prompts for confirmation, explaining renaming/numbering, duplicate behavior, and undo.
- New folder sheet: Folder path (prefilled with current folder plus slash where applicable), Cancel, Create folder. It creates an empty folder; creation itself is not a logged/undoable file action.
- Move sheet: selected filename(s), Folder autocomplete (excluding Duplicates), numbered-name preview, Cancel, Move; validation/error shown inline.
- Folder management sheet contains Rename, Merge into, Numbering prefix. Each has its input/selector, preview action, first 30 proposed path changes (with count and reasons where relevant), then apply action. Conflicts block applying. Apply confirms first; file changes are logged and undoable. Errors are shown inline.
- Close gaps sheet offers “Move the last images into the gaps” and “Renumber everything”; shows loading/error or a list of proposed renames (up to 40), count, and Apply. Apply changes are undoable.
- Image Details side sheet: image preview; filename, folder, size, original name, resolution, date, note, rating, tags, source/artist details and source links; manual source editor and metadata lookup; “View full screen”, “Rebuild thumbnail”, “Apply wallpaper” (disabled with Settings guidance if no script), “Move to folder…”, Delete, Close.
- Apply wallpaper invokes the configured script with the image’s absolute path token as one argument. The UI only reports that the process started.
- Full-screen Library viewer is a separate full-viewport dialog with image, filename, icon-only Previous, Next, Close; it gathers hash-addressable images across all Library folders, not only the current folder. Previous/next are disabled at the gallery ends; arrow keys navigate. While gathering the gallery it shows loading; failures are reported in the viewer.

### Browse — `/search`

- Header “Browse sites”; search panel with Site selector (Wallhaven, Danbooru, yande.re, Safebooru, Konachan.net), “Tags or search terms” input, Search button. Zerochan is explicitly shown as unavailable. Blank query browses recent posts. Rating limits follow Settings.
- Loading says “Searching…”. Query failure is shown inline. No-results state suggests different tags or widening the rating limit.
- Results header gives count, site, page, Previous and Next. Each card has daemon-served local preview, post ID, rating badge, Open post, “View image and tags”, Download, up to 12 tags. Wallhaven list items often have no tags; opening the image fetches its tags on demand. Other sites may return no tags.
- Download uses the regular Fetch pipeline. It reports sorted destination, Inbox, already-in-library duplicate, or a failure via toast; Download is disabled while its job is active and becomes available again on completion/error.
- “View image and tags” opens a full-screen viewer with image, icon-only Previous/Next/Close, rating, available “Open full-size image” and “Open post” links, tags, and Wallhaven tag-loading/error state. Navigation is among results on the current result page. Site previews displayed in the UI are served by the local daemon; full-size is an explicit external link, not an embedded remote image.

### Tags — `/tags`

- Header with number of tags/folders and “Add tag”.
- “Try a filename” panel: filename input; sample filename buttons; parsed words shown as chips, matching words highlighted, matched rule, destination (or Inbox/Ignored), prospective new filename, and ignored note. Test runs as the input changes. Loading says “Checking…”; errors appear in the panel.
- Tags grouped by destination. Group shows effective filename prefix. Each rule shows keyword chips, optional “inside words”, strict “needs: …”, “generic”, and explicit prefix badges; Edit and Delete actions.
- Empty state: “No tags yet” with a short explanation. Query failure shows “Try again”.
- Add/Edit sheet: keyword chips; destination Folder autocomplete; optional file prefix; match selector (whole words / anywhere in the name); optional strict-word chips; Generic folder checkbox and explanation; Cancel/Save. Save errors are inline. Delete confirms that already-sorted images stay where they are.

### Duplicates — `/duplicates`

- Header shows copies and total size when nonempty; “Empty Duplicates folder” action.
- List entries show local thumbnail, filename, “Same as” original path/link when known, size, Restore…, Delete.
- Empty state explains that exact copies are moved here instead of sorted twice. Initial request errors show “Try again”.
- Restore sheet shows selected filename and Folder autocomplete; folder-loading state, retry, and error; “Restore as new image” creates a new numbered file. Delete and empty-folder actions confirm moving items to trash. Restore/delete/trash actions are undoable where the response provides a batch.

### Data — `/data`

- Header “Where each image came from”.
- Filters: search name or ID, site selector (including manually assigned Pixiv/Unknown), folder text, and “Unknown source (N)” toggle.
- “Select all unknown” checkbox; table page checkbox and per-record checkboxes; row has thumbnail, name, folder, source badges, original name, resolution, and added date. Some columns hide on narrow screens. Rows open Details; checkboxes select without opening it.
- Bulk selection actions: Set sources (N); Look up tags (N) for records with supported source and ID; explanatory count when some have no usable source; Clear.
- Pager reports range/total and has icon-only Previous/Next. Page size is 50. Search/folder filtering is debounced.
- No matching records state says each image gets a record on arrival or first Library open. Initial errors show “Try again”.
- Details sheet shows local preview, filename, folder, original name, resolution, added time, note, rating, tags, sources, artists, and source links. Manual source fields: site, ID, Save source. Batch source sheet selects one site, has a separate optional ID per selected record, and Save sources.
- Metadata lookup can update tags/artist/rating and may sort an Inbox image. Bulk lookup runs sequentially, continues after individual failures, summarizes successes/sorts/failures, and offers Undo for sorted Inbox items.

### Re-sort — `/resort`

- Scope selector: whole Library or a folder; note explains whether subfolders are included and that Duplicates are excluded.
- “Scan and preview” shows scanning state, then count of changes, stays/no-matches, changes list (move/rename/duplicate with paths/reason), and items needing a decision (leave/conflict). No changes occur until apply.
- Apply asks for confirmation that the batch can be undone; “Apply N changes” disabled if none. Success toast includes Undo. Folder/status loading errors show “Try again”; preview failures surface a toast.
- Empty scope preview says “No images in this scope”.

### Activity — `/activity`

- Up to 300 most recent events, grouped by date and contiguous batch. Rows show time, action label, path transition, undone badge or Undo button. Multi-action undoable batches have “Undo all”.
- Empty state says “Nothing yet”; explanatory note says the log keeps recent entries while origin records remain on Data.
- Initial failures show “Try again”. Undo success says “Undone”; failure is an error toast.

### Settings — `/settings`

- Initial loading/error (“Loading…” / error plus “Try again”); header shows version.
- Numbering: “Gaps in the numbering” selector and explanation; changes save immediately.
- Watched folders: library root plus intake entries with watching/existence, recursion, empty-folder-removal, and error badges. Intake entries have Edit and Remove; “Add folder” opens a sheet with path, Include subfolders, Remove empty subfolders (off by default), Save/Cancel. Removal confirms.
- Images: supported extension chips and text naming the Duplicates folder; informational, not editable here.
- Fetch safeguards and API credentials: independent maximum rating/purity selectors; Zerochan username with Save/Edit/Cancel/Remove and explanation; “Warn before using unrated sites” switch with one-line no-rating explanation; Wallhaven API key and Danbooru username/API key/numeric user ID. Saved keys are never displayed; saved keys show “Saved (write-only)” and Edit/replacement/Remove controls. Non-secret Danbooru identity and user ID are shown. Blank key leaves an existing key unchanged. Save API credentials submits only fields entered.
- Apply wallpaper: script path; ordered arguments list where each literal text argument is an individual argument and `{wallpaper_path}` is a visual token; add text argument, add wallpaper path, remove argument, command preview, Save wallpaper script. Max 64 arguments; each text/path field is bounded. Explanatory copy says it runs only on explicit Library action and does not evaluate a command string.
- Appearance: System, Dark, Light segmented control. Preference is saved in browser local storage.
- Trash: explanation that deleted files wait in a hidden Library folder; Empty trash confirms permanent deletion.
- “This page” shows the local host.
- Success/error feedback uses toasts. Script process exit status is not shown.

## 4. Flows in user terms

1. **Fetch links or IDs:** On Overview choose a site for bare IDs, paste one item per line (links identify their site), press Fetch, then watch each row progress through Queued/Downloading to Sorted, Inbox, Duplicate, or Error. A Zerochan row always has an Unrated badge. Its warning toast appears without delaying the fetch when enabled.
2. **Auto-sort into a folder:** Save or fetch an image into the watched Library root/intake. After the write settles, filename words and origin hint tags are matched; duplicates are checked first. A match moves and numbers it into the folder, records its origin, and logs the operation.
3. **Leave in Inbox:** If there is no tag match, conflicting rules, or another sorting problem, review the Inbox card and its reason. Resolve by assigning it, adding a rule, or leaving it there.
4. **Choose a conflict suggestion:** Open Inbox Details, review each possible destination and matching phrase, then click the appropriate folder button. The file is assigned there.
5. **Create a tag from API tags:** In Inbox Details select artist/site tag chips, choose “Assign with selected tags”, choose destination and optional extra keywords/generic behavior, confirm tag creation, then Assign. Matching waiting images may also be sorted; success feedback reports that and offers undo.
6. **Edit a source and look up tags:** Open Inbox, Library Details, or a Data record; select a source site and ID or paste a recognized source link. Save source updates its origin record. “Look up tags” requests metadata without downloading; it can update the record and sort an Inbox file.
7. **Re-sort:** Choose whole Library or a folder; Scan and preview; inspect changes, stays, conflicts/no-match decisions; Apply and confirm. Undo the activity batch if needed.
8. **Undo:** Use an Undo action on a toast, an Activity row, or Undo all on a batch. The toast action is available for about 12 seconds. Errors are surfaced as error toasts.
9. **Browse, select, download:** Choose a supported site, search or leave query blank, page results, open a result to inspect image/tags, then Download. The normal Fetch pipeline determines sorted/Inbox/duplicate outcome. Zerochan is not browseable.
10. **Set Zerochan username:** Settings → Fetch safeguards; enter username and Save. It is a non-secret setting; Edit and Remove are available. Zerochan becomes enabled in Fetch when set.
11. **Disable/re-enable unrated warning:** The Zerochan toast’s “Don’t show again” saves the warning preference off. Re-enable “Warn before using unrated sites” in Settings to restore the next applicable toast. Badges remain either way.
12. **Save a write-only API key:** Enter a Wallhaven key or Danbooru API key and Save API credentials. Later the UI says Saved (write-only), never reveals the value, and offers Edit to replace or Remove to clear it.
13. **Configure/apply wallpaper script:** In Settings add a script path and ordered arguments, inserting the Wallpaper path token at the desired argument position. Save. In Library open Details and choose Apply wallpaper. The UI confirms start, not completion.
14. **Restore or remove duplicate:** In Duplicates choose Restore…, choose a destination, and restore as a new image; or Delete/Empty to send copies to trash. Trash can be emptied permanently from Settings.

## 5. Component inventory

| Component | Where used | Variants and visible states |
|---|---|---|
| AppShell | Every route | Top bar, connection indicator, navigation rail, Inbox count, global search, Scan now, global keyboard actions. |
| Icon | Navigation, image actions, pager, viewers | Decorative Lucide SVGs: close, info, expand, previous, next, and route icons. |
| ImageGrid | Inbox and Library | Thumbnail cards; selected/unselected; labels; hover/focus Details and optional expand icons; bounded 240-item chunks with Show more; shift-range selection. |
| Thumb | Grids, Details, Data, Duplicates | Local lazy thumbnail; loading shimmer; retries daemon 503 with Retry-After; placeholder with extension on failure. |
| SelectionBar | Inbox and Library | Sticky toolbar hidden at zero selection; count, page-specific actions, Select all, Clear. |
| FolderPicker | Assign, Move, Restore, tag editor | Editable autocomplete; up to eight matching folders; recent/preferred suggestions; typed new-folder indication; optional hidden folder. |
| ChipInput | Tag editor and Assign | Add by Enter/comma/blur; deduplicates entries; removable chips; Backspace removes last chip when input is empty. |
| Toast / Sonner | Global shell and mutation feedback | Bottom-right, theme-aware; success/error/default; action button; Undo duration 12s versus 4.5s otherwise. |
| Native dialog helpers | Sheets, confirmation dialogs | Right-side modal sheets, full-screen viewers, centered confirmation alertdialog; Escape/cancel and backdrop behavior depend on sheet. |
| Tag chip (CSS primitive) | Metadata, tags, filename words, fetch states | Neutral chip, matching-word highlight, selected metadata chip, per-fetch-state coloring. |
| Badge (CSS primitive) | Status, source, rating, labels | Neutral; good/warn/bad tones; compact source, rating, Unrated, and state labels. |
| WatchedEntry | Overview and Settings | Overview informational row; Settings row with Edit/Remove; path, watch/existence, recursion, empty-removal and error states. |
| ActivityRow | Overview and Activity | Time, action label, path transition; undone badge or Undo control. |
| SourceBadges | Data table | Known source and ID badges; “Unknown source” fallback. |
| OriginSourceEditor | Inbox and Library Details | Site selector, ID/link input, Save source, Look up tags; unsupported sites show lookup-unavailable hint. |
| FetchPanel | Overview | Site/ID selector and multiline input; per-line result states; Zerochan Unrated chip; optional character-tag prompt/editor. |
| AssignSheet | Inbox assignment | Folder picker/name preview; selectable site tags; optional saved tag, generic option, extra chips and suggestions; confirm/error states. |
| InboxDetail | Inbox | Image/origin facts, source editor, destination suggestions, artist/site tags, assign/delete/rebuild actions. |
| TagEditor / TagTester | Tags; tag creation from Inbox and Fetch | Rule editor controls and validation; live filename test with highlighted matches and predicted outcome. |
| LibraryFolderTree / LibraryMainPane | Library | Nested folder navigation/drop targets; breadcrumbs, folder facts/source counts, grid and selection actions. |
| LibraryOverlays | Library | Coordinates Details, viewer, Move, New folder, folder management, and gap-fill sheets. |
| ImageDetail / MoveSheet | Library | Origin details and actions; destination picker and numbered-name preview. |
| FolderChangeSection / FolderManagementSheet | Library | Rename/merge/prefix form, preview, blocked conflicts, apply confirmation/error. |
| GapFillSheet | Library | Last-into-gap or full-renumber choice, preview list, apply disabled when no changes. |
| LibraryImageViewer | Library | Full-screen all-Library gallery, icon-only previous/next/close, loading/error. |
| SearchImageSheet | Browse | Full-screen current-page viewer, icon-only navigation, rating, tags, post/full-size links; Wallhaven tag loading/error. |
| RestoreDuplicateSheet | Duplicates | Destination picker, folder loading/error/retry, restore action. |
| ResortList | Re-sort and folder previews | Move/rename/duplicate/leave/stay rows; destination and reason; capped display. |
| IntakeSheet | Settings | Add/Edit path, recursion and remove-empty controls, validation and save error. |
| FetchSettings | Settings | Per-site rating limits, username, warning switch, editable non-secret identities, write-only keys. |
| WallpaperApplySettings | Settings | Script input, ordered literal arguments, token, command preview, save state. |

## 6. Toasts and feedback

Toasts use Sonner at the bottom right. Undoable operations add an Undo action and last about 12 seconds; other toasts last about 4.5 seconds. The helper reports “Undone” after successful toast Undo and displays the error if undo fails. Dynamic error text comes from the API and must not be replaced by success-shaped feedback.

- **Global scan:** “Looking at the folders again”; or the returned error.
- **Setup/settings:** “Setup complete”, “Saved”, “Intake folder added”, “Intake folder updated”, “Intake folder removed”, “Invalid numbering option”.
- **Credentials/fetch settings:** “API credentials saved”, “Zerochan username saved”, “Saved”; failures show returned error.
- **Wallpaper script settings/action:** “Wallpaper script settings saved”, “Wallpaper script started”; failures show returned error.
- **Zerochan warning:** “Zerochan has no content ratings, so downloads are not filtered and may include mature content.” Action: “Don’t show again”. Disabling the preference can itself surface an error toast.
- **Tag rules:** “Tag saved. Waiting images that match are sorted now.”, “Tag deleted”; errors show returned error.
- **Fetch-generated character tag:** “Created tag and sorted image to {destination}”, optionally Undo; failures appear inline in the tag editor.
- **Source and metadata:** “Source saved”; “Tags looked up and sorted to {destination}” with Undo; “Looked up {N} tags; image remains in the Inbox.”; “Looked up {N} tags”; “Sources saved for {N} records”; “Metadata lookup: {N updated; N sorted from the Inbox; N failed: first failure}” with Undo when applicable.
- **Assign/move:** “Moved {N} images to {folder}”, optionally followed by duplicate count and additional images sorted; partial additional sorting failure is appended and marked as error while retaining Undo; stopped assignments report “Stopped: {error}”.
- **Delete/duplicate/trash:** “Deleted {N} images”; “Moved {N} copies to the trash”; “Restored {N} copies as new images”; “Removed {N} files”. File changes have Undo when available; permanent trash emptying does not.
- **Library folder operations:** “Created {folder}”; “Prefix changed for {folder}”; “Renamed {folder}”; “Merged {folder}”; “Renamed {N} files in {folder}”. File-change toasts include Undo when there are logged changes.
- **Rebuild thumbnails:** “No thumbnails available to rebuild”; “Rebuilding {N} thumbnails…”; “Rebuilt {N} thumbnails”; partial failure says “Rebuilt {N} of {total}; {N} failed: {first error}”.
- **Re-sort/activity:** “Re-sorted {N} files” with Undo; “Undone”; errors show returned error.
- **Browse downloads:** “Downloaded and sorted to {location}”; “Downloaded to the Inbox”; “That image is already in the library”; otherwise the item’s failure message or “The download failed”.
- **API/network failures:** UI shows the returned error in an inline alert, a toast, or a sheet’s inline error according to the action. There is no separate designed rate-limit toast; a rate-limit explanation is displayed as the returned error/message.

## 7. Settings

| Setting/control | Type and current default | What it does / where it appears |
|---|---|---|
| Numbering gap mode | Selector; `keep` | Keep gaps, use lowest free number, move last images into gaps, or renumber everything. Used by automatic numbering; Settings selector saves immediately. |
| Intake folders | List; none unless configured. New entry defaults to recursive on and remove-empty off. | Add/edit absolute or home-relative path; include subfolders; optionally remove empty subfolders after the configured delay. Watch status/errors are shown. |
| Library path | Fixed daemon configuration; no UI editor here. | Displayed on Overview and as the top-level watched folder. |
| Image extensions | Informational list; default `jpg`, `jpeg`, `png`, `webp`, `avif`, `gif`, `bmp`. | Shown as chips; accepted image types. Not editable in Settings UI. |
| Duplicates folder | Informational text; default `Duplicates`. | Exact duplicates are routed here. Not editable in Settings UI. |
| Generic tag word limit | Backend value; default 4. | Used by generic tag matching; no visible control on Settings. |
| Danbooru maximum rating | Selector; `g` (General). | Choices: g, s, q, e. Guards Fetch, metadata lookup, and Browse. |
| Wallhaven maximum purity | Selector; `sfw`. | Choices: SFW, sketchy, NSFW. Guards Fetch, metadata lookup, and Browse. |
| yande.re maximum rating | Selector; `s` (Safe). | Choices: safe, questionable, explicit. Guards Fetch, metadata lookup, and Browse. |
| Safebooru maximum rating | Selector; `general`. | Choices: General, safe, questionable, explicit. Guards site operations; the semantics of General are not fully defined by the site docs. |
| Konachan.net maximum rating | Selector; `s` (Safe). | Choices: safe, questionable, explicit. Guards Fetch, lookup, and Browse. |
| Zerochan username | Non-secret text; unset/empty. | Required for Zerochan Fetch/lookup; saved value is visible and editable/removable. It is not an API key. |
| Warn before using unrated sites | Switch; on. | Controls the non-blocking Zerochan warning toast only. It never gates downloads or changes the Unrated badges. |
| Wallhaven API key | Secret write-only; unset. | Saved in `secrets.toml`; UI shows saved state only, permits replacement/removal, never reads it back. |
| Danbooru username and numeric user ID | Non-secret identity; unset. | Shown and editable. Numeric ID is required for the request User-Agent. |
| Danbooru API key | Secret write-only; unset. | Saved in `secrets.toml`; UI shows saved state only, permits replacement/removal, never reads it back. |
| Wallpaper script path | Text; empty. | Optional Bash script location for explicit Apply wallpaper action in Library Details. |
| Wallpaper script arguments | Ordered list; empty. | Each text entry is one literal argument; `{wallpaper_path}` inserts the selected image path as one argument. |
| Theme | Segmented control; System. | System, Dark, Light; preference is stored in browser local storage. |
| Setup completion | Internal state; false until completed. | Controls the Overview first-run welcome panel; not a Settings field. |
| Trash | Destructive action, not a persistent preference. | Empty trash permanently removes files already moved to the hidden trash; confirmation warns this cannot be undone. |

## 8. Data the UI receives

These are user-facing shapes returned by the local daemon. Example values are illustrative; do not put a real key, secret, or Zerochan username in a design or mock.

- **Status:** version such as `1.0.0`, library path such as `/home/person/Pictures/Wallpapers`, intake paths and watch state, counts for Library/Inbox/Duplicates/records, settings, and first-run state. The shell uses the connection result and Inbox count.
- **Inbox item:** path/name such as `incoming/sky.png`, reason (`no_match`, `conflict`, `ready`), matched phrases, possible destination folders, intake folder, size and modified time, and nullable origin metadata.
- **Folder and image:** folder path/name, prefix, count, next number, gaps; image name/path/number, byte size, nullable content hash, and nullable origin record.
- **Origin record:** content hash; current path/folder/name; original name; source list; added timestamp; width and height; sorting note; tags; nullable rating. A source may include site, ID, URL, artist and artist ID. Example source: Wallhaven, `abc123`, artist `Example Artist`. Ratings include site-specific values and the literal `unrated`.
- **Fetch job:** job ID, done flag, and one item per input. Each item has input, nullable detected site and ID, state, nullable location and message, and optional character suggestions. A duplicate is represented by state `duplicate` and a user-facing “already in library” message; it is not a separate boolean field.
- **Browse results:** site, page, `has_more`, and result items with ID, post URL, rating, tags, daemon-local preview path, and nullable full-size image URL. Details lookup returns tags.
- **Tags/test result:** keywords, destination, optional prefix, match mode, strict words, generic flag, effective prefix; filename test returns parsed words, rule, destination, matched phrases, ignored note, and nullable proposed name.
- **Activity:** event ID and batch, time, operation kind, from/to paths, note, undone flag, and whether Undo is currently possible.
- **Duplicates:** path/name, bytes, nullable hash, and nullable duplicate-of path.
- **Action results:** moved/renamed/duplicate items and paths, batches, left/skipped/error information; folder preview and Re-sort include move/rename/duplicate/leave/stay decisions.
- **Secrets status:** only whether keys are saved and non-secret Danbooru identity/user ID. Secret values are never returned.
- **Already-in-library:** surfaced as a duplicate Fetch result and a Duplicates-list relationship, not as a dedicated `already_in_library` field in the response.

## 9. Supported sites

- **Wallhaven:** Fetch by post ID/link; metadata lookup; Browse. Default purity SFW; can widen to sketchy or NSFW. All API tags are matching hints. A Wallhaven API key can be saved but is not required for all reads. Browse list does not include tags; opening a result loads them.
- **Danbooru:** Fetch by post ID/link; metadata lookup; Browse. Default General (`g`), widen through sensitive, questionable, explicit. Character and copyright tags are hints; artist is stored as artist metadata. Numeric user ID is required in request User-Agent; username/key are optional for authenticated operations.
- **yande.re:** Fetch; metadata lookup; Browse. Default safe (`s`), can widen to questionable/explicit. Uses documented available tags as hints.
- **Safebooru:** Fetch; metadata lookup; Browse. Default General; UI offers safe/questionable/explicit. General’s precise semantics are not defined by the site documentation. Uses returned tags as hints.
- **Konachan.net:** Fetch; metadata lookup; Browse. Default safe (`s`), can widen to questionable/explicit. Tag categories are looked up; character and copyright tags are hints, artist is stored separately. It is distinct from konachan.com.
- **Zerochan:** Fetch and metadata lookup only; Browse is unavailable. No rating field: saved as `unrated`, never filtered by rating, and always marked Unrated in the Fetch selector/results. Requires a saved username in the request User-Agent. The UI warning is informational only.
- **Pixiv:** Not available through Fetch, lookup, or Browse. It can be selected as a manually entered source; existing Pixiv files may be identified from filename patterns.
- **Unknown:** Manual source label only; no Fetch, metadata lookup, or Browse.

## 10. Current visual language

- Self-hosted Hanken Grotesk for interface text and JetBrains Mono for paths, IDs, filenames, and numbers.
- Four common sizes: 24 px page/stat emphasis, 16 px section/empty-state emphasis, 14 px body, and 12 px compact/monospace details. Small badges also use 11 px.
- Dark-first neutral surfaces, subtle borders, one blue accent, and semantic green/amber/red tones. System follows the OS color scheme unless overridden; explicit light and dark modes exist.
- Compact top bar and left navigation rail; content is panel-, list-, table-, and thumbnail-grid-based. Sheets slide in from the right; image viewers fill the viewport.
- Mostly flat treatment with no card shadows. The CSS has functional gradients for select chevrons and thumbnail loading shimmer.
- Spacing and controls are compact, with rounded corners, visible focus rings, and reduced-motion handling.
- The user finds the current look functional but uninspiring and wants a design they actually enjoy using.

## 11. Constraints

### HARD — redesign must respect

- This is a local-only web app served by the daemon; do not introduce cloud accounts, remote services, or multi-user assumptions.
- The page CSP permits images from itself and blocks remote images. All inline previews must come from the local daemon. Browse’s explicit external “Open full-size image” link is a user action, not an embedded remote preview.
- Never show API keys or secrets. Key controls remain write-only and report saved state only. The Zerochan username is a non-secret identity, but do not expose any saved example value in mockups.
- Preserve the behavior and data described for every existing feature, including rating gates, unrated Zerochan behavior, source data, sorting, duplicate handling, logging, confirmation, and Undo.
- Keep keyboard operation, semantic controls, visible focus, usable dialogs, and accessible names for icon-only buttons.
- Keep existing local-web security model and the distinction between local daemon previews and external links.

### SOFT — current design choices the designer may change

- Flat styling and the absence of decorative shadows/gradients — **style choice**.
- Four-font-size rule — **style choice**; improve hierarchy if desired.
- Current spacing/density — **style choice**, while retaining a balanced desktop-first experience.
- Current layout and two-pane Library arrangement — **style choice**.
- Left navigation rail and route organization — **style choice**, provided all ten destinations remain discoverable.
- Current neutral/blue color scheme and dark-first presentation — **style choice**; deliver both light and dark themes with a switch.
- Current font pairing — **style choice**, though self-hosting assets is consistent with offline use.
- No-inline-styles policy — **not purely a style choice**. The CSP forbids inline style attributes and handlers; the current folder tree also uses a React style property for indentation. Prefer classes/CSS or another CSP-compatible approach. Do not assume the security policy can be relaxed as a visual preference.

## 12. Observable pain points

- Overview combines counts, Fetch, recent activity, watched folders, and first-run content, so the common Fetch flow shares a dense screen with status information.
- Inbox, Data, Settings, and Library expose many controls and metadata fields in compact layouts.
- The grid displays at most 240 cards at once and uses “Show more”; there is no virtual scrolling.
- Browse cards have little tag information until opened for Wallhaven; the user must enter the viewer to load those tags.
- Most sheets are right-side panels, while Browse and Library viewers are full-screen; the design should make those layer types and their navigation consistent.
- Several settings save immediately while credentials, intake entries, and the wallpaper script use explicit Save buttons.
- The current app is functional and keyboard-aware, but its restrained flat visual treatment is not inspiring to the user.

## 13. Design direction

- Mood and personality: calm and minimal, like a quiet gallery.
- Theme: both light and dark, with a switch.
- Density: balanced—not cramped, not sparse.
- Emphasis: everything equally. Browse, Inbox sorting, the Library as a gallery, and Fetch by link or ID should all feel considered; none is an afterthought.
- Mood reference only, not for copying: Linear’s calm speed, keyboard-friendly flow, and clear structure for handling many items quickly.
- No screenshots are available. Design from this brief.

## 14. Unverified and not built

### Unverified

- Live-site response behavior, current redirects, rating enforcement, and real network rate-limit responses have not been verified by the UI test suite; automated UI tests use mocked responses. The HANDOFF also says live-site testing and real-browser visual checks remain incomplete.
- A real browser’s image rendering, narrow-width behavior, and CSP console behavior have not been validated by jsdom tests. The Library folder tree’s inline style property is specifically flagged in HANDOFF for browser CSP verification.
- Site terms are not uniformly verified. HANDOFF reports Konachan.net’s checked `/terms` URL as 404, Zerochan’s checked terms URL as redirecting to a normal page, yande.re’s checked URL as 404, and Safebooru’s checked URL as redirecting to its homepage. Zerochan’s official docs do not document a permitted full-size image host; current implementation uses an owner-approved host.
- The API exposes errors/messages for failures but the UI has no distinct rate-limited visual state; how a live site’s 429 and Retry-After response appears is not verified here.
- The external wallpaper script’s eventual success/failure cannot be reported by the UI. The UI only knows it started; stdout/stderr are discarded.
- HANDOFF contains stale route-count wording (“all nine routes”) in one section; the actual current router and shell contain ten routes, listed above.

### Not implemented — do not design as existing

- Zerochan Browse/search.
- Pixiv Fetch, metadata lookup, or Browse.
- Video support.
- Thumbnail-cache size cap and activity-log size cap.
- Desktop/system notifications.
- Wallpaper script completion status, captured output, cancellation, or Undo of external changes.
- A separate dedicated `already_in_library` response field.

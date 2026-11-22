# Wallpaper Sorter frontend API gaps

These features exist in the v2 prototype or required UI brief but do not have a matching real daemon endpoint or typed field. The frontend will use a typed mock/local-storage adapter and must keep this list current.

## Git page

Feature: repository status, changed files, commit, push and history.

Required endpoint module:

- `GET /api/git/status`
- `POST /api/git/commit`
- `POST /api/git/push`
- `GET /api/git/log`

Proposed status request: none.

Proposed status response:

- `repository`: repository folder
- `branch`: current branch name
- `remote`: configured remote name
- `up_to_date`: boolean
- `commits_to_push`: count
- `changes`: `{path, status, from?}` where status is `added`, `renamed` or `deleted`

Proposed commit request:

- `paths`: selected repository-relative paths
- `message`: non-empty commit message

Proposed commit response:

- `hash`: short commit hash
- `message`: committed message
- `changed`: count

Proposed push request: none or `{remote, branch}`.

Proposed push response:

- `pushed`: commit count
- `remote`: remote name
- `branch`: branch name

Proposed log response:

- `items`: `{hash, message, date, local_or_pushed}`

Security: use the system git and SSH agent/keys. Never store or send a password, private key or credential. The only allowed Rust area for this feature is a dedicated git module plus the smallest route registration.

## Look-alike duplicates

Feature: similarity dropdown, library scan, duplicate groups, keep best and mark not duplicates.

Required endpoints:

- `POST /api/duplicates/look-alikes/scan`
- `POST /api/duplicates/look-alikes/keep-best`
- `POST /api/duplicates/look-alikes/not-duplicates`

Proposed scan request:

- `threshold`: `80`, `90` or `95`

Proposed scan response:

- `groups`: `{id, similarity_percent, items: [{path, name, width, height, size_bytes, source, folder, best?}]}`

Until this exists, the frontend stores mock groups locally and no file operation is performed.

## Folder logos

Feature: upload/drag PNG, JPG, WebP or SVG logos up to 2 MB, optional tint for light/dark themes, replace or remove.

Required endpoints:

- `GET /api/folders/{path}/logo`
- `PUT /api/folders/{path}/logo`
- `DELETE /api/folders/{path}/logo`

Proposed put request:

- `data_url` or multipart file
- `match_light_dark`: boolean
- `alt_name`: folder name for accessibility

Until implemented, save `{dataUrl, matchLightDark}` in local storage, keyed by folder path. This does not persist to the daemon or another device.

## Saved Library searches

Feature: save, reapply and remove Library resolution/shape/colour/monitor filters.

Required endpoint:

- no daemon endpoint is strictly needed if preferences remain browser-local.

Current adapter: local storage.

Stored shape:

- `name`
- `resolution`: `any | 1080p | 1440p | 4k`
- `shape`: `any | landscape | ultrawide | portrait`
- `colour`: colour index or `any`
- `fits_monitor`: boolean
- `monitor_width`
- `monitor_height`

Removing a saved search should support Undo in the UI.

## Library resolution, shape and colour filters

Feature: live tile filtering by resolution, aspect-ratio shape and dominant colour.

Existing data:

- `LibraryImage.origin.width` and `origin.height` may exist for fetched or indexed origins.
- `LibraryImage.origin.tags` may exist.
- no exposed dominant-colour field exists.
- no resolution/shape/colour filter endpoint exists.

Frontend behavior for the first implementation:

- resolution and shape filter origin dimensions client-side when dimensions are present
- unknown dimensions remain excluded from a resolution or shape filter
- dominant colour remains mock/local metadata until a backend supplies it

Required backend fields or endpoint:

- `GET /api/library/filter-values` or image records with `width`, `height`, `dominant_colour`
- request parameters: `resolution`, `shape`, `colour`, `fits_monitor`

## Fits my monitor

Feature: setting a monitor resolution and filtering Library tiles to fit it.

The daemon settings schema has no monitor width/height field today. The UI will persist the monitor resolution in local storage for Phase 3, then migrate it to daemon settings if settings gain fields.

Required settings fields:

- `display_width`: integer
- `display_height`: integer

Existing settings endpoints are `GET/PUT /api/settings`.

## Git settings

The prototype includes repository folder, remote URL, branch and leave-out-Duplicates/Trash switch.

Existing state does not expose Git repository fields or remote configuration. Proposed settings fields:

- `git_repository`
- `git_remote`
- `git_branch`
- `git_exclude_trash_and_duplicates`

Until a settings endpoint exists, these can be managed by the dedicated git module only. Do not put passwords or SSH private keys in settings or UI payloads.

## Google Sans Flex and Geist Mono assets

The prototype loads Google Sans Flex and Geist Mono from Google Fonts CDN.

The app currently has Hanken Grotesk and JetBrains Mono assets; no Google Sans Flex or Geist Mono files are confirmed in `ui/`. Remote fonts would violate the current offline/local-only runtime expectation.

Required:

- add and self-host Google Sans Flex and Geist Mono, or
- keep the current self-hosted families as a documented fallback.

## Browse

Browse is not mocked:

- `GET /api/search`
- `GET /api/search/details`
- `GET /api/search/preview/{key}`
- Fetch pipeline and Fetch job polling

The UI must implement both prototype pagination controls in sync. No endpoint gap is known for normal Browse result paging.

## Preview/loading/empty/error data

The prototype's design-only preview-state control is not a backend gap. Normal, loading, empty and error states must be derived from real TanStack Query state and existing error payloads. No "preview state" API or toggle will ship.

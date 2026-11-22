# Wallpaper Sorter UI rebuild plan

## Phase 1 status

Phase 1 is complete: the prototype, current Rust route surface, UI data shapes, package scripts, and route tree have been reviewed. Implementation starts only after this plan is approved.

## Source of truth

- `design/wallpaper-sorter-v2.html` is the visual and interaction source of truth.
- Existing React pages and daemon APIs remain the behavior source of truth.
- The prototype's "Tweaks" and "Preview states" controls are design-only and will not ship.

## Stack

The app is an existing React 19 + TypeScript 7 + Vite 7 application.

- Existing: React, TypeScript, Vite, TanStack Router, TanStack Query, Zod, Zustand, Lucide-style icons today.
- Routing target: hash routing for `#overview`, `#inbox`, `#library`, `#search`, `#tags`, `#duplicates`, `#data`, `#resort`, `#activity`, `#git`, and `#settings`.
- Components: Base UI for reusable interactive primitives such as dropdown/listbox, tabs, switch, checkbox, dialog and focus behavior.
- Icons: Lucide React, not hand-built icon markup.
- Animation: GSAP for page, grid, sheet, viewer, rail, toast, row and reduced-motion transitions.
- Styling: CSS variables from the prototype plus Tailwind CSS only if the existing build is extended cleanly. The prototype's exact CSS can be ported first; components must never use hard-coded colors.
- Fonts: Google Sans Flex and Geist Mono. Remote font loading is not acceptable at runtime; self-host the font files or document the gap.
- State/data: TanStack Query for daemon-backed reads/mutations, Zod at API boundaries, Zustand or small stores for local UI preferences and selection, local storage for non-daemon preferences where explicitly allowed.
- Tests: Vitest, Testing Library, MSW, jsdom, and existing real-binary UI tests.

The UI package currently has no Base UI, GSAP, Tailwind, lint, or Bun script. Phase 2 will add only the dependencies and scripts needed for the implementation.

## Existing shell and route change

The existing TanStack browser-history router will be replaced or wrapped with hash navigation so unknown hashes show the stub route. Route changes must clear selection and close every layer.

Desktop shell:

- 56px top bar.
- 236px rail, 68px collapsed; persisted rail width.
- Brand, global search, Watching status, Scan now, three-way theme switch, keyboard-shortcuts dialog.
- Ten existing destinations plus Git.

Mobile shell:

- Top bar remains 56px.
- Rail becomes a horizontally scrollable 57px row directly below the top bar.
- Labels stay visible and the active item scrolls into view.
- Search, collapse control and collapsed state are absent.
- `100dvh` and no 360px overflow.

## Typed API boundary

Implement a frontend `src/api/` façade. Feature modules may continue to call it, but all new pages should use typed adapters and Zod response schemas.

The daemon adapter uses the existing `/api/*` endpoints and never invents fields or response shapes. Missing features use:

- a local-storage adapter, or
- a mock adapter with deterministic in-memory data,

and are recorded in `docs/api-gaps.md`.

## Route-to-endpoint map

| Hash route | Real daemon operations | Frontend-only or missing behavior |
|---|---|---|
| `#overview` | `GET /api/status`, `GET /api/activity?limit=`, `POST /api/rescan`, `POST /api/fetch`, `GET /api/fetch/{id}`, `POST /api/undo` | Count and activity entrance animations only |
| `#inbox` | `GET /api/inbox`, `GET /api/folders`, `GET /api/tags`, `POST /api/assign`, `POST /api/delete`, `POST /api/thumb/{hash}/refresh`, `PUT /api/origins`, `POST /api/origins/lookup`, `POST /api/undo` | Grid and floating selection UX; no new daemon endpoint |
| `#library` | `GET /api/status`, `GET /api/folders`, `GET /api/images?folder=`, `POST /api/folders`, folder rename/merge/prefix endpoints, `POST /api/assign`, `POST /api/delete`, `POST /api/thumb/{hash}/refresh`, `PUT /api/origins`, `POST /api/origins/lookup`, `POST /api/apply-wallpaper` | Folder logos, resolution/shape/colour filtering, monitor fit, saved searches, and likely lookup of image dimensions |
| `#search` | `GET /api/search?site=&q=&page=`, `GET /api/search/details?site=&id=`, `GET /api/search/preview/{key}`, `POST /api/fetch`, `GET /api/fetch/{id}` | Paginated viewer behavior and client presentation |
| `#tags` | `GET /api/tags`, `GET /api/folders`, `POST /api/tags/test`, `POST /api/tags`, `PUT /api/tags/{n}`, `DELETE /api/tags/{n}` | Live tester uses the real endpoint; no extra matcher endpoint is needed |
| `#duplicates` | `GET /api/duplicates`, `GET /api/folders`, `POST /api/duplicates/restore`, `POST /api/delete`, `POST /api/duplicates/empty`, `POST /api/undo` | Look-alike duplicate scan/groups and similarity settings are mocked |
| `#data` | `GET /api/data?q=&site=&folder=&unknown=&limit=&offset=`, `PUT /api/origins`, `POST /api/origins/lookup`, `POST /api/undo` | Bulk UI selection and paging presentation |
| `#resort` | `GET /api/folders`, `GET /api/resort?folder=`, `POST /api/resort`, `POST /api/undo` | No missing mutation; presentation and confirmation differ |
| `#activity` | `GET /api/activity?limit=300`, `POST /api/undo` | Grouping and row presentation only |
| `#git` | None yet | New dedicated git module and endpoints for status, commit, push and log |
| `#settings` | `GET /api/status`, `PUT /api/settings`, `GET/PUT /api/secrets`, `POST/PUT/DELETE /api/intake/{n}`, `POST /api/trash/empty` | Display resolution, Git settings and leave-out-Duplicates/Trash options need settings or git endpoints |
| unknown hash | No daemon operation | Stub page: "That page does not exist" |

## Existing endpoint coverage

Real UI data and actions that already exist:

- status, counts and watched folders
- Inbox, folders and Library images
- exact duplicates and restore/delete/empty trash
- origin records and source editing
- metadata lookup
- tags and tag testing
- Fetch jobs and Browse search/details/previews
- Re-sort preview and apply
- activity and undo
- settings, credentials, intake folders and wallpaper apply
- thumbnail and full image access

Fields must remain constrained to these existing Zod schemas. For example:

- status: version, library, activity last ID, intake, counts, settings, setup complete
- Library image: name, path, number, size, hash, origin
- origin: hash, path, original name, sources, added, dimensions, note, tags, rating
- Inbox item: path, name, reason, matched, candidates, intake, size, modified, origin
- activity: id, batch, time, kind, from, to, note, undone, undoable

## Missing or mock-backed features

See `docs/api-gaps.md` for full request/response proposals and current behavior.

High-level gaps:

- Git status, commit, push and history.
- Look-alike duplicate groups and similarity scan.
- Folder logos and light/dark tint preference.
- Saved Library searches.
- Display monitor resolution and local "Fits my monitor" filter.
- Library resolution/shape/colour filtering beyond the fields already available.
- A frontend-only top-state error/loading/empty simulation is not required for the real UI and must not be shipped.

## Commit policy

Use small conventional commits for independently verifiable work:

- `feat(ui): ...` for major page or shell features.
- `fix(ui): ...` for bug fixes.
- `docs: ...` for documentation-only plans.
- `test(ui): ...` for test-only or test-tightening commits.
- `chore(ui): ...` for dependency/build setup.
- `refactor(ui): ...` for behavior-preserving restructuring.

Each commit should contain a coherent change and include the required Co-authored-by trailer. Do not mix unrelated work.

## Implementation phases

1. Phase 1 complete: prototype, endpoint and gap map.
2. Phase 2: design tokens, fonts, theme, Base UI primitives, shell, hash routing, rail, toast/dialog/sheet, motion setup and scrollbars.
3. Phase 3: Overview, Inbox and Library, including real data adapters and the prototype-only missing features behind adapters.
4. Phase 4: Browse, Tags, Duplicates and Data.
5. Phase 5: Re-sort, Activity, Settings and Git, plus the dedicated git module and smallest route registration.
6. Phase 6: real loading/empty/error states, keyboard behavior, GSAP motion and responsive verification at 1365×768 and 390×780.

## Validation commands

Run after each implementation phase:

- `npm --prefix ui run typecheck`
- `npm --prefix ui test`
- `npm --prefix ui run build`

There is no existing `lint` script. Phase 2 must not claim lint success until a lint script and valid lint configuration exist.

## Rust boundary

Frontend changes may touch UI, docs and dependencies. Rust changes are prohibited except a new dedicated git module and its smallest route registration for Git.

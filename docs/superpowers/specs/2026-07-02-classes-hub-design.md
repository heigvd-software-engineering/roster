# Classes hub — look & feel (design)

**Date:** 2026-07-02 · **Status:** approved (design) · **Scope note:** designed as
the full target; **built incrementally** — the classes-list *shell* now, the
richer layers as F4 (join link), F5 (people), F6 (labs), F8 (accept) land.

## Goal

Replace the placeholder authed home with a **teacher class-management hub** — a
rich, low-friction surface to administer classes and their labs, with a clear
at-a-glance view of each class's and lab's state. Pristine, minimal clicks,
built from shadcn primitives wrapped into named components (per
`labs-styling-convention`).

## Decisions (locked in the visual brainstorm)

- **Layout = master–detail (GitHub-Classroom-like), refined so labs are listed
  inside each class card.** No "Welcome"; the page is top-aligned.
- **Class detail = single scroll + right rail** (labs are the main column;
  People + Settings glanceable in a rail — no tab switching).
- **New lab = centered Dialog** (opens over the detail page, no navigation).
- **Routing:** `/classes` is the hub; signed-in users **land there** (`/`
  redirects to `/classes` for now; a role-split student home is F9). The `labs`
  wordmark links to `/classes`. The onboarding gate (GitHub linked) still gates
  everything.

## Routes

| Route | Purpose | Built when |
|---|---|---|
| `/` | redirect → `/classes` (signed in) / login (signed out) | **now** |
| `/classes` | the hub: list of class cards, each listing its labs | **now** (shell); labs rows fill in F6 |
| `/classes/:id` | class detail (labs table + People + Settings rail) | F5/F6 (shell stub now optional) |
| `/classes/:id/confirm` | existing F3 confirm page (unchanged) | done |

`/classes/:id/labs/new` is **not** a route — New-lab is a Dialog over the detail
page.

## `/classes` — the list page

- **Header:** title "Classes" + the brand-red rule; a primary **"Connect an
  organization"** action (the F3 install button, moved here from the old home).
- **Class card** (one shadcn `Card` per connected org), each showing:
  - **Identity:** org avatar + name + `@login` (live from GitHub).
  - **State chips:** `N students`, `N teachers` (live org members split by role),
    and a **base-permission health** chip (`No access ✓` / `⚠ needs fixing`).
  - **Labs listed inside** — a compact row per lab (see "lab row" below), capped
    (e.g. first 3–4) with a "+ N more" affordance; **+ Add a lab** at the end.
  - **Card actions:** **Copy join link** (F4), **Open ›** → `/classes/:id`.
- **Empty states:** no classes → "Connect a GitHub organization to start a
  class."; a class with no labs → "No labs yet — add the first one."

### Lab row (used in the card list and the detail table)

Signals, in priority order (this is the "state overview"):

- **Title.**
- **Mode** badge — `individual` or `group m–n`.
- **Deadline** chip — a countdown with tone: **red** ≤ 7 days / overdue,
  **amber** upcoming, **green/neutral** past-with-work-in (`graded` when that
  exists). Exact thresholds a shared helper.
- **Progress** — `X / Y accepted` (individual) or `N groups` (group). Live from
  GitHub + `student_lab_repos` (F8); shows `—` until acceptance exists.

## `/classes/:id` — the class detail

Single scroll, two columns:

- **Main column:**
  - Back link `‹ Classes`; header = org avatar + name (red rule).
  - **Labs** section: **+ New lab** button + a shadcn **Table** of labs
    (`Lab · Mode · Deadline · Progress`), each row → the lab's own view (F8/F10)
    later. Same lab-row signals as above.
- **Right rail (glanceable, read-mostly):**
  - **People** — student count (Members) + teacher count (Owners), a few live
    avatars, "managed on GitHub" note. (Full roster = F5.)
  - **Settings** — base-permission status (`No access ✓`), **Copy join link** +
    **Regenerate** (F4).

People are **read live** and edited on GitHub — the hub shows roster + counts,
not member CRUD.

## New-lab Dialog (F6)

A centered shadcn `Dialog` opened by any **+ New lab / + Add a lab**:

| Field | Control | Notes |
|---|---|---|
| **Title** | Input | required |
| **Template repository** | Combobox over the org's repos | **optional**; empty ⇒ blank repo on accept. App ensures the picked repo is a GitHub *template* |
| **Deadline** | Date + time (Calendar/Popover) | **required** |
| **Mode** | ToggleGroup `Individual` / `Group` | Group reveals **Min** / **Max** number inputs |

Footer: **Cancel** / **Create lab**. Single published state (visible on create —
no draft). On success the Dialog closes and the labs list/table updates in place.

## Components (shadcn + named wrappers)

Add via `shadcn add` as needed: `card`, `table`, `dialog`, `badge`, `combobox`
(or `command` + `popover`), `calendar` + `popover`, `toggle-group`, existing
`button`/`dropdown-menu`. Wrap into named components under
`app/components/custom/` per the styling convention — e.g. `ClassCard`,
`LabRow`, `DeadlineChip`, `NewLabDialog`, `PeopleRail`, `ClassSettingsRail`.
Reuse existing layout primitives (`Stack`, `Row`, `Container`) + `Text`.

## Data flow

- Reuses `GET /api/classes` (F3); **extends** it (or adds fields) for the
  per-class member counts + base-permission health, and nests each class's
  labs. Labs come from F6 (`GET /api/classes/:id/labs` or nested), progress from
  F8. All response types inferred via `hc<AppType>` — no hand shapes.
- Live GitHub reads (org profile, members) via the installation token; lab
  metadata from D1; reconcile-on-read as established.

## Build sequencing

1. **Shell (now, on F3):** the `/classes` route + `/` redirect + wordmark link;
   move "Connect an organization" here; **remove the Welcome**; render class
   cards (identity + connect + empty "No labs yet"); extract `ClassCard`. Uses
   only what `GET /api/classes` returns today.
2. **F4:** Copy-join-link / Regenerate on the card + Settings rail.
3. **F5:** People counts/roster (rail + card chips); base-permission health chip.
4. **F6:** Labs — `labs` table, `New lab` Dialog, `LabRow`/`DeadlineChip`, the
   `/classes/:id` detail page + labs Table.
5. **F8:** per-lab **Progress** (accepted counts / groups).

## Error & empty states

- `/api/classes` error → a retryable inline message; loading → skeleton cards.
- No classes / no labs → the empty states above.
- Base permission drifted (not "No access") → the health chip flags it with a
  one-click re-apply (reuses F3 confirm).

## Testing

- Component tests for `ClassCard`, `LabRow`, `DeadlineChip` (tone thresholds),
  and the `NewLabDialog` form (validation, group min/max reveal) with mocked
  data. Route redirect (`/` → `/classes`) tested. No tests for pure layout
  wrappers.

## Out of scope

Per-lab management (student repos, groups view) = F8/F10. Student home (role
split at `/`) = F9. This spec covers the teacher hub's structure + the F6
new-lab surface; features fill the designed slots as they're built.

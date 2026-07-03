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

- **Layout = one hub, no class detail page** *(revised 2026-07-03 — see the
  revision note at the bottom)*: labs are listed inside each class card, and
  the card carries all class-level surfaces (people popovers, join link,
  add-lab). The drill-down unit is the **lab**, not the class.
- **New lab = centered Dialog** (opens over the hub, no navigation).
- **Routing:** `/classes` is the hub; signed-in users **land there** (`/`
  redirects to `/classes` for now; a role-split student home is F9). The `labs`
  wordmark links to `/classes`. The onboarding gate (GitHub linked) still gates
  everything.

## Routes

| Route | Purpose | Built when |
|---|---|---|
| `/` | redirect → `/classes` (signed in) / login (signed out) | **now** |
| `/classes` | the hub: list of class cards, each listing its labs | **now** (shell); labs rows fill in F6 |
| `/classes/:id/confirm` | existing F3 confirm page (unchanged) | done |
| `/classes/:id/labs/:labId` (or `/labs/:id`) | **lab detail** — the per-lab management view (roster of accepted student lab repos, groups, deadline) | F6/F8 |

There is **no `/classes/:id` class-detail route** (dropped 2026-07-03) and no
new-lab route — New-lab is a Dialog opened from the card.

## `/classes` — the list page

- **Header:** title "Classes" + the brand-red rule; a primary **"Connect an
  organization"** action (the F3 install button, moved here from the old home).
- **Class card** (one shadcn `Card` per connected org), each showing:
  - **Identity:** org avatar + name + `@login` (live from GitHub).
  - **State chips:** `N students · P pending`, `N teachers` (live org members
    split by role) — **clickable**, opening a popover table of the people
    (SWITCH identity primary, GitHub login secondary; built in F5b). A
    **base-permission health** chip (`No access ✓` / `⚠ needs fixing`) is
    still planned.
  - **Labs listed inside** — a compact row per lab (see "lab row" below), capped
    (e.g. first 3–4) with a "+ N more" affordance; **+ Add a lab** at the end.
  - **Card actions:** **Copy join link** (F4). Class settings (regenerate
    join link, archive, re-apply base permission) land later as a small `⋯`
    menu on the card — not a page.
- **Empty states:** no classes → "Connect a GitHub organization to start a
  class."; a class with no labs → "No labs yet — add the first one."

### Lab row (in the card list; each row links to the lab detail page)

Signals, in priority order (this is the "state overview"):

- **Title.**
- **Mode** badge — `individual` or `group m–n`.
- **Deadline** chip — a countdown with tone: **red** ≤ 7 days / overdue,
  **amber** upcoming, **green/neutral** past-with-work-in (`graded` when that
  exists). Exact thresholds a shared helper.
- **Progress** — `X / Y accepted` (individual) or `N groups` (group). Live from
  GitHub + `student_lab_repos` (F8); shows `—` until acceptance exists.

## Lab detail page (F6/F8 — replaces the dropped class detail)

The per-lab management view a teacher reaches by clicking a lab row:

- Header: lab title + class identity, back link to the hub.
- **Roster table**: who accepted / who hasn't, per-student-or-group **student
  lab repo** links, group composition (F7/F8), live from GitHub +
  `student_lab_repos`.
- Lab settings: deadline, template, mode (edit affordances TBD with F6).

People are **read live** and edited on GitHub — labs shows rosters + counts,
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
`LabRow`, `DeadlineChip`, `NewLabDialog`, `PeopleChip` (built, F5b).
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
2. **F4:** Copy-join-link on the card. **DONE** (regenerate deferred to the
   card `⋯` menu).
3. **F5:** People chips + popover roster. **DONE (F5b)**; base-permission
   health chip still open.
4. **F6:** Labs — `labs` table, `New lab` Dialog, real `LabRow`/`DeadlineChip`
   data, the **lab detail page** shell.
5. **F8:** per-lab **Progress** (accepted counts / groups) + roster on the lab
   detail page.

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

## Post-review note (2026-07-02)

During the review/visual pass, the hub header was intentionally reduced to a
compact heading with no rule/divider under it — this **supersedes** the
"Header: title + the brand-red rule" line above. `BrandHeader` (eyebrow +
title + red rule) stays reserved for the login/landing and confirm screens;
in-app section headings (e.g. `/classes`) use the plain `Text variant="heading"`
scale instead.

## Revision note (2026-07-03)

**The class detail page (`/classes/:id`) is dropped.** By F5b the class card
had absorbed everything the detail page was designed for: the labs list is
inline, People became clickable chip popovers (richer than the planned rail —
SWITCH identity + GitHub login per person), Copy join link and + Add a lab sit
on the card, and New-lab was always a Dialog. What remained (regenerate link,
archive, re-apply base permission) fits a small `⋯` menu on the card.

The navigation model is now: **hub card = the class; lab row = the
drill-down** to a per-lab detail page (F6/F8), where the real management data
lives (acceptance roster, student lab repos, groups). The "Open ›" card action
was removed accordingly.

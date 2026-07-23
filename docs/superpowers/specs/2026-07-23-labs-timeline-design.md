# Labs timeline: the class card as a range chart

**Date:** 2026-07-23
**Branch:** `feat/labs-timeline` (on top of `feat/lab-start-date`)
**Status:** Approved (mockup round 2, variant B —
https://claude.ai/code/artifact/ef291f66-93b4-4601-8746-c830219efb7e)

## Problem

With `startAt` shipped, every lab is a date RANGE (start → deadline) and
ranges may overlap — but the class card still renders a flat table sorted
newest-first. Nothing shows where the course currently is, which labs run
concurrently, or how the semester is laid out.

## Design (from the approved mockup)

Replace the labs table on BOTH hub cards (teaching `class-card.tsx`,
student `enrolled-class-card.tsx`) with one `LabsTimeline` component — a
range chart:

- **Axis**: month-floored min(effective start) → month-ceiled max(deadline)
  across the class's labs. Month boundaries draw strong gridlines with mono
  caps labels; each month's midpoint draws a faint minor line. Effective
  start = `startAt ?? createdAt`.
- **Rows**: chronological by effective start (a deliberate flip of the
  hub's newest-first sort — on a timeline, reading order is time order).
  64px tall. Label column 280px: line 1 = title + pills, line 2 = mono
  `mode · d MMM → d MMM` + status suffix. The bar column is purely temporal.
- **Bars** (20px, fully rounded, positioned by two percentages):
  - *done* (deadline passed): `bg-muted` + hairline inset ring + ✓ at the
    right end; whole row dimmed.
  - *running* (started, not due): `role-enrolled` soft fill + 1.5px inset
    ring; an elapsed-time fill overlay; a **sonar** dot on the deadline end
    (two `animate-ping` rings, 2.6s, staggered; static halo under
    `prefers-reduced-motion`). A mono annotation floats right of the bar:
    `due d MMM · in N d`, brand-red bold when due within 7 days
    (`isDeadlineUrgent`).
  - *locked* (before start): amber hatch (`repeating-linear-gradient`) +
    amber inset ring + lock glyph. Students: row is NOT a link (same
    semantics the locked `LabRow` had), dimmed, `title="This lab hasn't
    started yet"`.
- **Starter-code seed**: a lab generated from a template gets the existing
  mono "starter code" pill on line 1 AND a 12px seed node fused to the
  bar's left cap (GitBranch glyph, ring in `muted-foreground`; amber on a
  locked bar). Hidden entirely for students while locked — the template's
  NAME is the leak the start gate exists to prevent (same rule as the old
  row badge).
- **Now line**: 1.5px `role-enrolled` vertical line through all rows,
  dot head, mono caps label `now · d MMM`; clamped to the axis.
- **Teacher extras**: line 2 appends `· x/y repos` (repos created / groups)
  and locked rows say `hidden from students` in amber; the per-row edit
  pencil stays at the row's right edge. Students see mode · dates · status
  only.
- **Responsive**: the card keeps its `overflow-x-auto` + min-width shell —
  small screens scroll the chart horizontally, same as today's table.

## Data

Everything derives from fields the hub already ships (`startAt`,
`deadline`, `createdAt`, `templateRepoFullName`) except the repo counts:
`listClasses` attaches `groupsCount` / `reposCount` per lab (one grouped
aggregate over `groups` per query — `count(*)`, `count(gh_repo_id)`), on
both the teaching and enrolled shapes so the component sees one type.
No GitHub calls; pushed-based standing stays on the lab pages.

## Consequences

- `lab-row.tsx` (LabRow, LabsHeader) is deleted — the two hub cards were
  its only consumers; its locked-row semantics move into the timeline.
  `deadline-text.tsx` stays (lab-page header still uses `DeadlineText`;
  the timeline reuses `relativeLabel`).
- Row links are unchanged: `/classes/:id/labs/:labId` (+`/manage` for the
  teacher), locked student rows unclickable.

## Tests

- **www** (`labs-timeline.test.tsx`): chronological order; the three bar
  states render (✓ / sonar+due annotation / lock); locked student row is
  not a link, hides the starter pill and seed, keeps the "starts" pill;
  locked teacher row stays a link with both pills; now label renders;
  teacher sees `x/y repos`, student card doesn't.
- **www** updates: `class-card.test.tsx` (date-range instead of the old
  deadline cell), `classes-page.test.tsx` (row links still hold).
- **api** (`classes-list.test.ts`): labs carry `groupsCount`/`reposCount`.

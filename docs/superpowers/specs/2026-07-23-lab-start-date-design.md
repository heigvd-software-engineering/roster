# Lab start date: schedule labs before students may start them

**Date:** 2026-07-23
**Branch:** `feat/lab-start-date`
**Status:** Approved

## Problem

Every lab is startable by students the moment it is created. That blocks a
common teaching pattern: lab 2's starter code is lab 1's solution, so the
professor cannot create lab 2 until lab 1 is over — creating it early would
generate work repos from the solution template for anyone who accepts. The
professor cannot plan a semester in advance; they must return at exactly the
right moment to create each lab.

What we want: an optional **start date/time** on the lab. Before it, students
see the lab in the list (knowing what's next and when is useful) but visibly
cannot act on it — no groups, no joining, no repositories, and therefore no
access to the starter code. One mechanism only: the timestamp. There is
deliberately **no draft/publish state** — two ways to express "not yet open"
would drift apart; a lab with no start date simply starts immediately.

## Design

### 1. Data model & API contract

- `labs.startAt` (`start_at`, timestamp, **nullable**). `null` = the lab
  starts immediately — today's behavior, so existing rows need no backfill.
  Migration name: `lab_start_at`.
- The shared create/update input (`labInput` in `handlers/labs.ts`) gains
  `startAt: z.coerce.date().optional()`. Absent means **null** on both create
  and update — safe because the lab dialog always submits the complete form,
  so an emptied Start field genuinely means "starts immediately".
- One validation: a set `startAt` must be **before** `deadline`, refused as
  `409 { error: "start_after_deadline" }` on create and update.
- One shared derivation, `labStarted(lab)` (`startAt === null || startAt <=
  now`), lives in `apps/api/src/lib/groups.ts` next to `labMax`; the client
  derives the same from the `startAt` riding on every lab response (types
  flow through Drizzle → RPC as usual — no hand-written shapes).

### 2. Backend enforcement (the API is the boundary)

The row being unclickable is UI courtesy; the server is what refuses. On a
lab where `!labStarted(lab)`, every **student** action answers
`409 { error: "not_started" }`:

- `createLabGroup` — no groups form before start;
- `joinGroup` / `leaveGroup` — membership of pre-created groups is frozen;
- `createLabRepo` — the starter-code moment itself;
- `acceptIndividualLab` — solo accept is group + repo in one click.

**Teacher calls pass through every gate** (`access.isTeacher`), including
per-group and batch repo creation — the deliberate escape hatch, same
precedent as `addGroupMember` bypassing the repo lock. The teacher is warned,
not blocked (§3).

`listLabGroups` for a **student** on a pre-start lab returns the head (lab,
class identity, role) with empty `groups`/`users`/`students` — the same shape
as the existing `pending` branch — so a direct URL renders a friendly
"starts …" page, never a 404, and reveals no rosters. Teachers get the full
response.

### 3. Professor UI — informed at every decision point

The professor must understand the implications wherever they touch them:

- **Lab dialog** (create and edit): an optional "Start" `datetime-local`
  field above Deadline, with helper copy permanently attached:
  *"Students see the lab but cannot start it — no groups, no repositories,
  and no access to the starter code — until this time. Leave empty to open
  the lab immediately."*
- **Manage page**: while not started, a visible note near the toolbar:
  *"Not started — opens for students on \<date\>. Until then students see
  the lab in their list but cannot form groups or create repositories."*
- **The escape hatch is labeled as such**: when the lab has not started, the
  existing create-repo confirm dialogs (per-group and the teacher's batch)
  gain one sentence: *"This lab hasn't started: creating the repository now
  gives its group access to the starter code before the start time."* The
  teacher may proceed — informed, never silently.

### 4. Student UI — visible, locked, honest about when

- **Lab row** (shared `LabRow`, so hub cards and the class page agree): a
  pre-start lab renders dimmed and **not as a link** — there is nothing
  behind it a student may act on, so no page of disabled buttons. The Due
  cell shows the start instead: "starts \<date\> · in 3d" (countdown to
  start, not deadline). The starter-code badge is **suppressed** pre-start:
  the template repo's *name* (e.g. `lab1-solution`) is itself a leak.
  Teacher rows stay clickable (they manage the lab) with a quiet
  "starts \<date\>" marker.
- **Direct URL**: the student lab page's pre-start branch mirrors the
  pending gate: *"This lab starts \<date\> — you'll be able to form groups
  and get the starter code then."*
- After start, nothing changes: every downstream surface renders exactly as
  today. `labStarted` is evaluated per request/render — no stored state to
  flip, so the lab opens on time without anyone touching it.

### 5. Edge cases

- **Start moved into the future after students acted** (teacher edits a
  started lab): student self-service re-locks, but nothing is undone —
  existing groups and repos stay, consistent with "lowering max never
  evicts". The manage page's "not started" note reappears, so the state is
  visible.
- **Clock edges**: `labStarted` compares server time on the server and
  client time in the UI; the server verdict is authoritative. A student a
  few seconds early simply gets the `not_started` message and retries.

### 6. Tests

- **API** (`labs.test.ts`, `lab-groups.test.ts`, `groups.test.ts`):
  create/update accepts, persists, and clears `startAt`; `startAt ≥
  deadline` is `409 start_after_deadline`; each gated verb answers
  `not_started` pre-start and succeeds post-start; a teacher passes every
  gate; student `listLabGroups` pre-start returns head + empty lists while
  the teacher gets the full response.
- **www** (`lab-dialog.test.tsx`, `student-lab-page.test.tsx`,
  `teacher-lab-page.test.tsx`, class/hub card tests): the dialog field and
  its helper copy; a pre-start row is dimmed, not a link, shows "starts",
  hides the template badge; the teacher's row stays a link; the pre-start
  student page text; the manage-page note; the extra warning sentence in
  both repo confirm dialogs; `not_started` mapped in `CONFLICT_MESSAGE`.

## Explicitly out of scope

- No draft/publish state, now or later — the timestamp is the one mechanism.
- No scheduled jobs or notifications at start time — "opens by itself" is a
  consequence of deriving `labStarted` at read time, not of anything firing.
- No per-group start overrides.

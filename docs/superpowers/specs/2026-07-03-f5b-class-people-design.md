# F5b — Live class people (design)

**Date:** 2026-07-03 · **Status:** approved (brainstorm 2026-07-03)
**Grounding:** foundation flows §3.6 (view class people: students = org
**Members**, teachers = org **Owners**, read live, managed on GitHub);
classes-hub design (state chips on the class card); F5a teacher-access model
(teacher = live org admin).

## Outcome

The class card's dummy "24 students / 2 teachers" badges become live,
clickable **people chips**. Clicking one opens a popover listing the actual
people (avatar, name, `@login`, linking to their GitHub profile). The
students chip also surfaces **pending** join-link invitees who haven't
accepted yet.

## Decisions (brainstormed)

1. **Popover on the chip** — anchored panel in the hub context; the full
   People section still lands later on the class detail page.
2. **Pending invites included** — chip reads `{n} students · {p} pending`
   when invites are open; pending rows render greyed with a "pending" badge.
   Answers the join-week question "who hasn't accepted yet?".
3. **Approach A: people ride along on `GET /api/classes`** — no second
   endpoint; counts derive client-side; the popover renders instantly from
   loaded data. The org-admin list already fetched for the F5a teacher check
   is reshaped to serve both the check and the teachers list (one fetch, two
   uses).

## API

### `github/org.ts` — `orgPeople`

```
orgPeople(env, installationId, org) →
  { teachers: Person[], students: Person[], pending: Person[] }
Person = { id: number; login: string; avatarUrl: string }
```

- `teachers` ← `GET /orgs/{org}/members?role=admin`
- `students` ← `GET /orgs/{org}/members?role=member` (non-owner members)
- `pending` ← `GET /orgs/{org}/invitations` (open invitations; `login` may be
  null for email invites — labs only creates username invites, but map a null
  login to the invitation email as the display string)
- All installation-token calls, paginated `per_page=100` via Octokit's
  `paginate` so orgs >100 people stay correct.

### `GET /api/classes`

- Per class, call `orgPeople` once; the F5a teacher check becomes
  `people.teachers.some((t) => t.id === ghId)` — replacing the separate
  `isOrgAdmin` fetch (which `orgPeople` supersedes; `isOrgAdmin` remains for
  the confirm route, or is reimplemented on top of `orgPeople` — implementer's
  choice, no duplicate GitHub call per route).
- Response items gain `teachers`, `students`, `pending` (the `Person[]`
  shapes above, inferred through `AppType` as always).
- Existing per-class error containment unchanged: if people calls fail, the
  class is skipped (same catch as today).

## Frontend

### `custom/classes/people-chip.tsx` (new)

- `PeopleChip` props: `label` (e.g. `"3 students · 1 pending"`), `people:
  PersonRow[]` where `PersonRow = { login: string; avatarUrl: string;
  pending?: boolean }`, `emptyText` (e.g. "No students yet").
- Renders a Badge-shaped **trigger** (same visual weight as today's
  `Badge variant="secondary"`) + shadcn **Popover** (Base UI primitive; added
  via `pnpm dlx shadcn@latest add popover`).
- Popover content: one row per person — `UserAvatar` (sm) + `@login`, the row
  is a link to `https://github.com/{login}` (new tab). Pending rows: greyed
  (muted text/avatar opacity) + a small "pending" badge, listed after the
  accepted people. Empty list → `emptyText`.

### `ClassCard`

- Swaps the two static Badges for two `PeopleChip`s fed from the new
  `teachers`/`students`/`pending` fields (props spread from the classes
  loader as today).
- Chip labels: `{students.length} student(s)` — with ` · {pending.length}
  pending` appended when > 0 — and `{teachers.length} teacher(s)`.
  Singular/plural handled ("1 student", "2 students").
- `dummyClassMeta` loses `students`/`teachers` (labs remain dummy — F6/F8).

## Error handling

- People fetch failures are contained per class by the existing skip logic —
  no partial chips. (A skipped class disappears from the hub exactly as
  today's enrich-failure behavior; acceptable until the detail page brings
  richer states.)
- Popover is purely client-side over already-loaded data — no loading or
  error states inside it.

## Testing

- **api:** `orgPeople` maps the three GitHub lists (incl. null-login email
  invite → email string, pagination via mocked `paginate`); classes route
  returns `teachers`/`students`/`pending` and derives the teacher check from
  the same data (non-admin caller still filtered out — F5a/F8 guard test
  updated, no extra GitHub call).
- **www:** `PeopleChip` renders label + rows + GitHub profile links; pending
  row styling/badge; empty state. `ClassCard` shows real counts and the
  ` · pending` suffix only when nonzero.
- **👁 visual gate:** chips + popovers on the real hub (Test TWeb 2026 has
  1 owner + 1 member after the F4 walk — plus any open invite for pending).

## Out of scope (deferred)

- Class detail page People section / base-permission health chip (the
  tracker's other F5b half — health chip lands with the detail page).
- Removing/inviting people from labs (GitHub manages membership).
- Caching/`Promise.all` batching of the hub's per-class GitHub calls
  (standing deferral; revisit when class count grows).

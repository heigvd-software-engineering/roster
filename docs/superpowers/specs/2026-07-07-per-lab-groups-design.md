# Per-lab groups — design (2026-07-07)

## Problem

Groups are **one GitHub Team with one roster, reused across many labs**
(`groups` row + N `student_lab_repos` pairings). Membership is therefore
**atomic across every lab the team touches**. Combined with the invariant
"one group per student per lab", this creates an inescapable dead-end:

> Tigoes44 is in **Team Alpha 2** (attached to Lab 2). They try to join
> **Team Alpha** (Ovich's, attached to Labs 1–4). Because Team Alpha also
> participates in **Lab 2**, joining would put Tigoes44 in two groups on
> Lab 2 → refused. Viewed from Lab 1, where there is no local conflict, the
> refusal is baffling and there is **no way to be with Ovich on Lab 1
> without abandoning their Lab 2 group**.

The block is correct per the invariant; the *model* is wrong. "Reusable
atomic team" (GitHub Classroom's team-set model) cannot express "different
groupmates on different labs", which is a normal thing students want.

## Decision

**Groups become per-lab.** A group belongs to exactly one lab and owns its
own GitHub Team. "Reuse an existing group" stops meaning *share the same
team* and becomes **copy its roster into a fresh group for this lab**
(copy-forward). Each lab's groups are independent objects; editing one
never touches another.

Rule, restated and now trivially enforceable: **at most one group per
student within a single lab; no restriction across labs.** The cross-lab
`wouldDoubleParticipate` machinery disappears — the check is a lookup
inside one lab's groups.

### Name / slug split (reuse-friendly names, collision-free teams)

The same friendly name ("Team Alpha") should be reusable in every lab, but
GitHub team slugs are org-unique. So the group row carries THREE identifiers:

| column        | value                          | role                                    |
|---------------|--------------------------------|-----------------------------------------|
| `name`        | `"Team Alpha"`                 | Display label. **Never sent to GitHub.** Unique per `(labId, name)`. |
| `slug`        | `"tetris-basis-team-alpha"`    | `labSlug-groupSlug`, what we HAND GitHub as the team's name. Unique org-wide by construction (lab slug is unique). |
| `ghTeamSlug`  | GitHub's returned slug         | GitHub's identity for API paths; equals `slug` when we feed a slug-shaped name, but stored explicitly as source of truth (GitHub may dedup). |

- The only human-friendly string is `name`, and it lives only in our DB.
  We display `name` everywhere `ghTeamSlug` is currently shown.
- We create the GitHub team with `slug` AS its name → GitHub slugifies an
  already-slug-shaped string → `ghTeamSlug === slug`, deterministic. Store
  what GitHub returns regardless.
- Uniqueness is enforced in OUR DB on `(labId, name)` — a friendly per-lab
  error ("Team Alpha already exists in this lab"), no GitHub round-trip.

## Schema changes (migration 0010)

`groups`:
- **add** `lab_id` → references `labs.id`, NOT NULL. A group is now lab-owned.
- **add** `slug` text NOT NULL — the lab-scoped physical slug (what we send GitHub).
- **keep** `ghTeamSlug` (GitHub's returned slug), `ghTeamId`, `name`, `creatorUserId`.
- **drop** class-wide name uniqueness; **add** unique `(lab_id, name)` and unique `(lab_id, slug)`.
- `class_id` stays (a group still belongs to a class, via its lab — keep for scoping queries, or derive; TBD in build).

`student_lab_repos`: the pairing table's REASON TO EXIST was many-to-many
group↔lab. With one lab per group it collapses to per-group repo columns.
Two options for the build:
- **(a) Fold into `groups`**: move `ghRepoId` / `ghRepoFullName` onto the
  group row (group == participation == repo holder). Drop the table.
- **(b) Keep the table 1:1** with the group for a smaller diff.

Recommend **(a)** — it's the honest shape and removes the last cross-lab
seam. Repo name becomes the group's `slug` directly (already lab-scoped;
**drop** the current `slugify(lab.title)-…` prefix so it isn't doubled).

## Flows

- **Create group (student/teacher):** name it ("Team Alpha") → we compute
  `slug = labSlug-slugify(name)`, create the team with that, store all three
  ids. Student auto-joins (teacher doesn't), same as today.
- **Copy-forward (reuse):** "Reuse a group from another lab" → pick a source
  group → we create a NEW group in this lab with the same `name`, a fresh
  lab-scoped `slug`/team, and copy the source's roster into it. Ship the
  **student** action first ("reuse my last group"); a **teacher** bulk
  "carry all groups into this lab" is a fast-follow.
- **Join / leave / add / remove:** unchanged in spirit; the double-book
  check is now "is this student already in a group *of this lab*?" — no
  cross-lab collection.
- **Accept / repo creation / orphan protection:** unchanged per lab. A group
  whose repo exists is a deliverable → locked for its (only) lab.

## What this deletes

- `wouldDoubleParticipate`'s cross-lab lab-collection + parallel roster reads.
- The attach / detach concept and its endpoints (a group is born attached to
  its one lab).
- The teacher "attach an existing group" menu → replaced by "reuse/copy".
- The student-page cross-lab reasoning; the lab page already renders per-lab.

## Costs / caveats

- **More GitHub teams** (one per group-per-lab). Free-plan safe: the ceiling
  is ~1,500 teams/org (plan-independent); a 30-student class at ~3/group over
  ~10 labs is ~100 teams. Not a real wall. (Re-verify limits before launch.)
- **Migration of existing data:** every current `student_lab_repos` pairing
  becomes a per-lab group. A group reused across N labs splits into N groups
  (same name, N teams). Existing GitHub teams: keep the one already tied to a
  repo; create new teams for the other labs and copy rosters. Needs a careful
  data migration script (has live GitHub side effects) — plan separately.
- Copy-forward drift is a FEATURE: editing one lab's group never mutates
  another's (the whole point).

## Resolved decisions (2026-07-07)

1. **Derive `class_id`** — do NOT store it on `groups`. The class is reached
   via `group.lab_id → labs.class_id`; one source of truth, nothing to keep
   in sync.
2. **Fold `student_lab_repos` into `groups`** — repo columns (`ghRepoId`,
   `ghRepoFullName`) move onto the group row; the pairing table is dropped.
3. **Wipe the test orgs' groups + teams and re-form** — no live-mutating data
   migration. Migration 0010 just reshapes the schema; the (disposable) test
   orgs get their groups/teams deleted and re-created under the new model.

## Follow-on slice: group-membership cache (user-requested)

Today the lab page reads each group's roster LIVE from GitHub
(`teamMembers`, one call per group). Move DISPLAY reads to a DB cache, same
pattern as `class_members`:

- **New cache** (roster rows per group, or reuse a shape like
  `class_members`): login + avatar + github id, written where we already
  observe membership (create, join, leave, add, remove, copy-forward) and on
  the teacher's live visit; reconciled on read (team 404 → drop; roster
  drift → refresh). A **"check sync"** action re-pulls a group's live roster
  on demand.
- **INVARIANT (inherited):** the cache is DISPLAY-ONLY. Roster shown on the
  page = cache. Authorization ("can this student join/leave", "is the caller
  in the group", the within-lab double-book check) stays **live** or
  revalidates — a stale cache must never grant or deny access.
- **Payoff:** the lab page's per-group GitHub calls collapse to the sync
  points, matching the call-efficiency work already done on the hub +
  activity slice.

Sequenced AFTER the per-lab core lands, so each is reviewable on its own.

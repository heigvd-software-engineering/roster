# GitHub identities — a global local identity store (design note, PARKED)

**Status: parked — not built.** Written 2026-07-10, after the demo deployment
surfaced the question. Conclusion first: the current design stays; this
document records the alternative, why it loses today, and what would have to
change for it to win.

## Context — what exists today

The app renders GitHub people from two **denormalized display caches**, each
an independent observation of a different GitHub source:

| Table | Mirrors | Written by |
|---|---|---|
| `class_members` (classId, githubId, **login, avatarUrl**, state) | the ORG roster | join flow, connect-time seed, roster reconciler |
| `group_members` (groupId, githubId, **login, avatarUrl**) | each TEAM roster | every group mutation's `syncMembers`, group-members reconciler |

The GitHub identity (`login`, `avatarUrl`) is copied into every row. Local
app users are correlated at READ time only (`account.accountId = githubId`,
LEFT-join semantics): a person who never signed in renders by their GitHub
identity; nothing local is required. Neither cache ever authorizes anything —
permissions are always live GitHub calls.

Consequence of the duplication: a GitHub login rename leaves stale handles in
every row that copied it, until the reconcilers repair them (the roster
`refresh` finding; team syncs). Cosmetic staleness, with designated owners.

## The alternative considered

One global identity table; the caches keep only membership facts:

```sql
github_identities (
  github_id   TEXT PRIMARY KEY,  -- immutable; = account.accountId
  login       TEXT,
  avatar_url  TEXT,
  updated_at  INTEGER
)
-- class_members → (id, classId, githubId FK, state, timestamps)
-- group_members → (id, groupId, githubId FK, timestamps)
```

Rules that make it correct:

- **Append/update-only, never deleted.** Identity is a fact about GitHub, not
  about membership; memberships come and go, the identity row persists. This
  kills every cascade/ordering hazard: no repair can blank someone out of a
  display, and nothing ever references a missing identity.
- Every observer upserts the identity row FIRST, then its membership row.
- `account` (better-auth) stays untouched; local-user correlation remains a
  read-time join on `github_id`.

## Pros

- **Renames repair in ONE place.** One row update fixes every card, roster,
  and tile globally, instead of one reconcile finding / team sync per copy.
- Smaller membership rows; identity stated once per person, not once per
  membership.
- A first-class local identity entity — useful IF a feature ever needs one
  (cross-class student views, per-person preferences, an admin directory).

## Cons

- **A permanent complexity tax on every path.** Each write gains an
  FK-ordering obligation; every read (rosters, class cards, students pool)
  becomes a join; the reconcilers' diffs join too.
- **It changes what the caches ARE.** Today each cache is a disposable,
  independently-derived observation — `DELETE FROM group_members` and the
  next sync rebuilds it perfectly, because GitHub is the source of truth for
  the whole row. With a shared identity table, the caches become a small
  relational schema with invariants that are OURS to maintain rather than
  GitHub's to re-derive.
- **The migration is a table rebuild.** SQLite can't drop columns: create new
  tables, backfill `github_identities` from the union of both caches (latest
  write wins), copy memberships, swap. Mechanical, but real risk surface.
- **The invitation-id wart gets institutionalized.** Pending class members
  are keyed by an INVITATION id (no user id exists until they accept); those
  become identity rows orphaned on acceptance. Harmless, tiny, permanent.
- **The problem it solves barely exists.** Renames are rare; the staleness is
  cosmetic; `resolveClassAccess`'s retry means a rename can't lock anyone
  out; and the scale (dozens of students, a handful of classes) makes the
  duplication kilobytes.

## End-state comparison (effort excluded)

Comparing only the two steady states — as if the migration were free — the
designs are close to a wash. What each carries FOREVER:

**Normalized (`github_identities`):**

1. **Blast radius.** One shared row per person: a single buggy writer (an
   empty login from one sync) corrupts that person's rendering in EVERY
   class, group, and card at once. Today damage stays inside one table, one
   class's view.
2. **Write discipline as a permanent rule.** Every current and FUTURE writer
   must upsert the identity before the membership (FK order); one forgotten
   upsert is a failing insert. Today every writer is self-contained and
   can't get this wrong.
3. **Last-writer-wins between observers.** Org listings, team listings,
   invitation payloads, and profile fetches observe identity at different
   moments; one row holds one version — a fresher observation can be
   overwritten by a staler in-flight one.
4. **Weaker recovery story.** Today each cache rebuilds from ONE GitHub call
   ("wipe it, resync"). The identity table is a union of observations — no
   single source rebuilds it; it only reconverges as every observer re-fires.
5. **Global orphan accumulation** — invitation-id rows pollute a shared
   never-delete table (today they live in one class's cache and are deleted
   on acceptance).

**Current (duplicated caches):**

1. **Stale copies after a rename**, until each cache's repair runs.
2. **Cross-cache disagreement** — for a while, `class_members` and
   `group_members` can show two different logins for the same person. The
   normalized design makes this impossible.

Neither dominates: the normalized model has better DATA semantics (one truth
per person, no disagreement), the current one better OPERATIONAL properties
(contained failures, trivial rebuilds, no write protocol). Behavior is
otherwise identical — same correctness, same authorization, same render
fallbacks, same reconcile model. And that near-wash is what decides it: when
the end states are roughly equivalent, the transition cost — the migration
plus a step-and-join tax across ~8 files — is the only differentiator left,
and it is all on one side.

## Rejected halfway version

Making `group_members` a pure link table joined through `class_members` (no
new table). Feasible — team membership implies active org membership, so the
team sync may upsert a missing class row — but the dedup is only per CLASS
(a person in 3 classes still has 3 identity copies), so it pays most of the
coupling cost for a fraction of the benefit. If normalizing at all, do the
global table.

## Conclusion

**Keep the current duplicated caches.** The two end states are a near-wash
(see the comparison above): the normalized model wins on data semantics, the
current one on operational properties, and observable behavior is otherwise
identical. With no clear end-state winner, the transition cost decides — and
the only behavioral difference a user would ever notice (renames propagating
sooner) is rare, cosmetic, and already repaired by the reconcilers.

**Revisit when either trigger fires:**

1. Identity staleness becomes an OBSERVED pain — e.g. many classes per
   person making rename drift visible across semesters.
2. A feature needs identity as a first-class local entity (cross-class
   views of one student, per-person settings, directory pages).

If a trigger fires, build the global `github_identities` table as specified
above — not the halfway link-table version.

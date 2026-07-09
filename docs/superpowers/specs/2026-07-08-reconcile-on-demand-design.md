# Class reconciliation — audit, consent, apply

**Status:** implemented (2026-07-08, `milestone-4-labs`; merged to `main` in
PR #4) — the reconcilers under `lib/reconcile/`, the audit/apply endpoints,
and the `/classes/:id/reconcile` page.
**Date:** 2026-07-08 (rewritten — supersedes the per-concern button design)

## 0. Two principles

> **A `GET` returns what it sees.** Reconciliation is a verb a human performs.
>
> **Nothing is repaired without consent.** The app proposes; the teacher accepts.

Today four `GET` routes mutate the database. Three do it as a side effect of
rendering; one destroys rows. This design removes all three, relocates the
fourth, and replaces the scattered silent repairs with **one per-class action**:
audit the class, show what drifted, apply only what the teacher accepts.

## 1. Audit — every mutation on a GET path

| Route | Mutates | Character | Verdict |
|---|---|---|---|
| `GET /api/classes` | `classes.installationId` (`classes.ts:139-144`) | pointer repair | → `setup.ts` + reconcile |
| | `classes.{login,name,avatarUrl}` (`:159-173`) | identity cache | → reconcile |
| | `class_members` via `syncRoster` (`:154-158`) | roster cache | → reconcile |
| `GET /api/join/:token` | `class_members` via `observeMembership` (`join.ts:126`) | roster cache | → `POST /confirm` |
| | `classes.{login,name,avatarUrl}` (`join.ts:135`) | identity cache | → deleted |
| `GET /classes/:id/labs/:labId/groups` | `DELETE FROM groups` (`lib/groups.ts:268`) | **destructive** | → `teamMissing` flag + reconcile |
| `GET /api/github/setup` | `INSERT INTO classes` | install callback | **kept** |

`/api/github/setup` is GitHub's App-install Setup URL. GitHub redirects the
browser there; the `GET` *is* the command. Not a violation.

## 2. The reconciliation subsystem

### 2.1 Findings are content-addressed

```ts
/** Stable and derived from content, NOT a random id. Two audits of the same
 *  drift produce the same key; a changed drift is a different finding. */
export type FindingKey = string;        // "roster:remove:githubId=9"

export type Finding = {
  key: FindingKey;
  reconciler: string;                   // "roster" | "class-identity" | …
  severity: "broken" | "drift" | "info";
  /** One line, for the checkbox. "Alice Dupont left the organization" */
  title: string;
  /** What we saw, precisely. Shown under the title. */
  detail: string;
  /** What Apply will do. `null` = we can see it, we cannot fix it. */
  fix: string | null;
  /** Deletes rows or revokes access. Starts UNCHECKED in the UI. */
  destructive: boolean;
};
```

### 2.2 Apply executes enumerated operations — never a bulk sweep

**This is the safety property of the whole design.** `apply` acts on exactly the
keys the teacher accepted:

```
roster:remove:githubId=9      →  delete that one row
roster:add:githubId=41        →  insert that one row
roster:promote:githubId=111   →  update that one row to `teacher`
```

It must **not** call `syncRoster`, whose semantics are *"delete everyone absent
from the live roster"* (`enrollment.ts:84-85`). `syncRoster` becomes an internal
detail of `audit` — diffing live GitHub against the cache — and disappears from
the write path entirely.

Consequence: a proposal that has gone stale between audit and apply can only ever
do **too little**, never too much. It cannot touch a student it never named. The
blast radius is bounded by the proposal the teacher actually read. Apply therefore
does not need a stale-plan check, and takes the payload at face value.

Every operation must be individually **idempotent**. The residual races are all
benign and self-healing:

| Race | Result |
|---|---|
| student left, then rejoined between audit and apply | removed from the cache; re-added by their next join `POST`, or the next audit |
| `adopt repo X`, repo since deleted | `404` → reported as a failed operation |
| `recreate team`, team since recreated | `422` → absorbed, treated as already done |

### 2.3 The context is lazy and memoized

Several reconcilers want the same expensive fetches. `orgPeople` alone is three
paginated calls.

```ts
export type ClassContext = {
  db: Db;
  env: AuthEnv;
  cls: Class;
  org: string;
  installationId: number;      // the LIVE one — see `installation` reconciler
  /** Each fetched at most once per audit, memoized on the context. */
  people(): Promise<OrgPeople>;
  groups(): Promise<Group[]>;
  orgRepos(): Promise<Map<string, RepoSummary>>;
  basePermission(): Promise<string>;
  members(): Promise<ClassMember[]>;   // the class_members cache
};
```

A reconciler declares nothing; it asks. Adding a reconciler that needs a new
source means adding one getter. No reconciler pays for data it does not touch.

### 2.4 A reconciler is a file

```ts
export type Reconciler = {
  name: string;
  audit(ctx: ClassContext): Promise<Finding[]>;
  /** Only ever called with keys THIS reconciler produced. */
  apply(ctx: ClassContext, keys: FindingKey[]): Promise<AppliedOp[]>;
};
```

```
apps/api/src/lib/reconcile/
  types.ts            Finding, FindingKey, Reconciler, ClassContext
  context.ts          the lazy, memoized ClassContext
  index.ts            the registry (a list) + runAudit + applyFindings
  installation.ts
  identity.ts
  roster.ts
  group-teams.ts
  work-repos.ts
  base-permission.ts
```

`index.ts` is a list. **Adding a reconciliation factor is adding a file and one
line.** That is the extensibility requirement, discharged.

### 2.5 A failing reconciler is a finding, not a 502

A reconciler that throws yields one `info` finding with `fix: null`:

> ⚠ **Roster could not be checked** — GitHub rate limit, retry in 12 min.

The rest of the audit renders and remains applicable. Nothing silently reads as
"all clear", and one flaky module never blocks the fix the teacher came for. This
matters most in the worst case: a dead installation pointer makes *every* GitHub
reconciler fail, which is exactly when the page is needed.

`runAudit` therefore never rejects. `applyFindings` may — a failed operation is
reported per key, and the response says what was applied and what was not.

## 3. The reconcilers

Each is a real invariant the app establishes once and never re-checks.

### 3.1 `installation`

Stored `classes.installationId` ≠ the live id from `GET /user/installations`.

A reinstall mints a new id. `setup.ts` records it (§4), but only if the browser
that performed the reinstall reached the Setup URL. Nothing else does.

`ctx.installationId` is **always the live value**, derived once before any
reconciler runs — otherwise every other reconciler fails against a dead
installation, and the page that fixes it cannot load.

- `installation:repair` — `drift`, not destructive. Rewrites the pointer.

### 3.2 `identity`

`classes.{login,name,avatarUrl}` vs `orgInfo`. Orgs get renamed; avatars change.

- `identity:refresh` — `drift`. Rewrites the three fields.

### 3.3 `roster`

The live org roster vs `class_members`. **The only whole-roster observer** —
every other write point (`observeMember`, `forgetMember`, the join `POST`s) sees
exactly one person: the caller. So this is the only thing that can notice:

| Finding | Severity | Destructive |
|---|---|---|
| `roster:add:githubId=41` | `drift` | no — someone joined the org out of band |
| `roster:promote:githubId=111` | `drift` | no — a member became an org Owner |
| `roster:demote:githubId=7` | `drift` | no |
| `roster:refresh:githubId=7` | `info` | no — login or avatar changed |
| `roster:remove:githubId=9` | `drift` | **yes** — left the org |

### 3.4 `group-teams`

A group row whose GitHub team 404s.

Repo access is granted **to the team** (`grantTeamRepo`), so when the team dies
the students lose push on their own work repo. The group is stuck: it cannot be
deleted (`has_repo`), cannot be worked in, and nothing recreates a team.

- `group-teams:recreate:groupId=…` — `broken`, not destructive. Recreates the
  secret team under the group's stored `slug`, re-runs `grantTeamRepo`. The
  roster died with the team, so the group returns **empty**; the teacher re-adds
  from the pool.

### 3.5 `work-repos`

A repo exists in the org at `group.slug`, but `group.ghRepoFullName` is `NULL` —
`createWorkRepo` died after creating it, before recording it.

- `work-repos:adopt:groupId=…` — `broken`, not destructive. Adopts the repo,
  re-grants the team, records the row. This is `createWorkRepo`'s find-or-create
  path, surfaced.

> Distinguish two states, and never conflate them:
>
> | | Group row | Repo | Cause | Recovery |
> |---|---|---|---|---|
> | **Unrecorded** | exists, `ghRepoFullName = NULL` | exists | partial `createWorkRepo` | adopt |
> | **Orphaned** | gone | exists | *only* the GET-path delete | — |
>
> Nothing in `apps/api/src` deletes a GitHub repo (verified: no `DELETE /repos`,
> no `deleteRepo`). With `deleteGroup`'s `has_repo` guard holding and the
> GET-path delete removed (§1), an **orphaned** repo can no longer be created.

### 3.6 `base-permission`

The org's base repository permission is not `none`.

`confirmClass` (`classes.ts:26-40`) sets it and verifies it **once, at class
creation.** Nothing re-checks it. A teacher can flip it back on GitHub and every
student silently gains read access to every repository in the org.

- `base-permission:reset` — `broken`. Destructive in the sense that it *revokes*
  access, so it starts unchecked, but leaving it is the actual hazard. Copy says
  so.

**This reconciler is why the abstraction earns its keep.** It was invisible in
the previous design because there was no surface to hang it on.

## 4. Endpoints and routes

```
GET  /api/classes/:id/audit        teacher-only. Runs every reconciler. WRITES NOTHING.
                                   → { auditedAt, findings: Finding[] }

POST /api/classes/:id/reconcile    teacher-only. { keys: FindingKey[] }
                                   → { applied: AppliedOp[], failed: FailedOp[] }
```

`GET /audit` is an authed XHR from a page the teacher navigated to deliberately;
no prefetcher will trip it. It writes nothing, so `GET` is honest.

Both derive the live `installationId` **before authorizing** (`isOrgAdmin`
against the live installation). `resolveClassAsTeacher` authorizes via the
*stored* pointer, so a stale one would make the page that fixes it refuse to
load. `class_members` may never authorize.

### `setup.ts` — repair without a session

`installationAccount` (`app.ts:11`) runs on the **App's own JWT**: GitHub, not
the caller, names the org that owns an installation. So the repair needs no user
session, and an attacker passing an arbitrary `installation_id` cannot choose the
`WHERE` — GitHub resolves it to that installation's true org, and an App has
exactly one installation per org. The worst achievable write is the correct
value, or a no-op.

Repair: narrow `UPDATE` of the pointer only. Never `status` (a session-less call
must not resurrect a deactivated class), never `joinToken`, never
`connectedByUserId`. **Create** still requires a session and `userHasInstallation`.

### `GET /join/:token` and `POST /join/:token/confirm`

The preview becomes a pure read. When it reports the caller is already `active`,
the page shows **"Finish joining"**, which POSTs `/confirm`. That handler
re-reads live membership and calls the existing `observeMembership` — so the
`teacher` and `forgetMember` branches come along for free.

Explicit, not auto-fired on load: a mutation triggered by navigation is the
pattern this design removes, and a silent failure would leave the row `pending`
with nothing on screen to retry.

### `GET /classes/:id/labs/:labId/groups`

Returns `teamMissing: true` and an empty roster instead of deleting the row. The
`group-teams` reconciler is the fix. `deleteGroup`'s `has_repo` guard is
**unchanged** — the repo is the durable thing, the group row is not.

## 5. Reads after the change

### Teacher hub — `GET /api/classes`

| Field | Source | Cost |
|---|---|---|
| authorization | `orgMembership(org, callerLogin).role === "admin"` | 1 GitHub call **per class** |
| `installationId` | `live.installationId`, in memory | free (already fetched) |
| `login`, `avatarUrl` | `/user/installations` payload | free (already fetched) |
| `name` | cached `classes` row | free |
| students / pending / teachers | `class_members` | free |

Writes: **none.** Cost: **~4N GitHub calls → N + 1.**

Two facts this rests on, both verified by typecheck:

- `inst.account.avatar_url` is a **required `string`** on `GET /user/installations`.
- `inst.account.name` is `string | null | undefined` — optional, therefore not
  trustworthy. `name` comes from the cached row until reconcile refreshes it.

And one that is not negotiable: `/user/installations` returns installations the
caller can **access**, not ones they own — a student with push on a work repo can
appear there. The live `orgMembership` check per class is mandatory.

### Everyone else

Routes that don't fetch `/user/installations` (student hub, join, lab pages) read
the stored `installationId`. If it is stale, the GitHub call 404s. Surface
`409 { error: "class_needs_reconcile" }` → *"This class needs reconciling — ask
your teacher."* Students structurally cannot repair it: re-deriving the id needs
`GET /user/installations`, which only lists installations the caller administers.

The teacher can, from either end: reinstalling through the Setup URL, or the
reconcile page. Those are the only two writers of `classes.installationId`.

## 6. Schema

```
labs: unique(classId, title)    -- migration 0011
```

### No `reconciledAt`

Considered and dropped. A "last reconciled" timestamp records when someone last
pressed Apply — **not** whether the class is in sync now. A class reconciled two
minutes ago can have drifted one minute ago, and a teacher who reads *"synced 5
minutes ago"* will not re-audit when they should. The audit is the only thing that
answers "is this class in sync", and it answers it live.

Its one honest use was distinguishing *never reconciled* from *reconciled, nobody
joined* — a distinction §5 creates by moving the hub's chips onto `class_members`.
The accepted cost: a class that predates this work renders `0 students` until its
teacher opens the reconcile page once, then is correct forever. One wrong number,
once, self-correcting — cheaper than a column that invites false confidence.

### `labs: unique(classId, title)`

A group's slug — and therefore its **repo name** — is
`` `${slugify(lab.title)}-${slugify(group.name)}` `` (`lib/groups.ts:59`). The DB
enforces only `unique(labId, slug)` and `unique(labId, name)`
(`app-schema.ts:101`): **per lab**, not per org. `labs.title` has no constraint at
all.

Two labs in one class both titled *"Lab 1"*, each with a group *"Alpha"*, compute
the same repo name in the same org. GitHub's team-name 422 blocks the second
*team* only while the first team lives. Once it is gone (§3.4), the `work-repos`
reconciler would offer to adopt **the first lab's repo** into the second lab's
group: one lab's student work, under another lab's group.

`createLab`/`updateLab` return `409 { error: "title_taken" }`; the index is the
backstop.

> Drizzle emits `unique()` on SQLite as `CREATE UNIQUE INDEX` (see `0010`, lines
> 25-28) — one statement, no table rebuild. It **fails at apply time on existing
> duplicates**:
>
> ```sql
> SELECT class_id, title, COUNT(*) FROM labs GROUP BY class_id, title HAVING COUNT(*) > 1;
> ```
>
> Local dev is clean. There is **no production database yet** — `wrangler.jsonc`
> still carries the placeholder `database_id` (`0000…0000`), so nothing is
> deployed. Run the query above against `--remote` the first time a real D1 is
> provisioned, before applying `0011` to it.

## 7. The page

`/classes/:id/reconcile` — a real route, not a popover. Six reconcilers of
per-finding checkboxes do not fit in one.

Entry points:
- the class card's `⋯` → **Reconcile…** (ellipsis: it navigates, it does not act)
- the `class_needs_reconcile` error, anywhere it surfaces

```
Reconcile — Test TWeb 2026
audited just now

CLASS
  ☑ Organization was renamed to “TWeb 2026”
      login acme → tweb-2026 · refresh the class card
  ☑ Installation was reinstalled
      stored 143979064 → live 152003411 · repoint the class

ROSTER
  ☑ 2 students joined the organization directly
      @walkin, @latejoiner · add to the class roster
  ☑ Prof Dupont became an organization Owner
      promote to teacher
  ☐ 3 students left the organization
      @gone, @quit, @dropped · remove from the class roster

GROUPS
  ☑ Team “Alpha” no longer exists on GitHub
      its students cannot push to acme/lab1-alpha · recreate + re-grant
  ☑ Repository acme/lab1-beta is not recorded
      created but never linked · adopt it

SECURITY
  ☐ Base repository permission is “read”, not “none”
      every member can read every repository · set it back to none

⚠ Work repositories could not be checked
    GitHub rate limit — retry in 12 min

                                          [ Apply 6 selected ]
```

Destructive findings start **unchecked** and wear the `destructive` tone. The
teacher opts *into* deletion, never out of it. `base-permission:reset` is
destructive in the sense that it revokes access — the copy says which way the
hazard runs.

On success: *"6 applied · 1 failed"*, with the failures named. Silent success on a
destructive apply is how a teacher fails to notice a student was removed.

## 8. Non-goals

- **Webhooks.** Drift self-heals at the join `POST`s and at reconcile.
- **Automatic reconciliation.** Nothing repairs itself on a read. Ever. The one
  exception is `setup.ts`, where GitHub itself hands us the truth.
- **Promoting `class_members` to authority.** It stays a display cache with the
  never-authorize invariant intact.
- **A hub-wide "reconcile everything".** Per class, proportional to what the
  teacher actually doubts.

## 9. Testing

| Claim | Test |
|---|---|
| `runAudit` writes nothing | seed drift in every reconciler, `GET /audit`, assert every table byte-identical |
| A failing reconciler becomes a finding | `orgPeople` throws → `200`, one `info` finding, other reconcilers still report |
| `runAudit` never rejects | every reconciler throws → `200` with six `info` findings |
| Apply executes only accepted keys | accept 1 of 3 roster removals → exactly one row deleted |
| Apply never bulk-sweeps | accept `roster:add:41`; a student absent from the payload and from GitHub is **not** deleted |
| Apply is idempotent | apply the same keys twice → second is a no-op, no error |
| Stale key, subject gone | accept `roster:remove:9`, delete the row first → reported failed, nothing else touched |
| Findings are content-addressed | two audits over unchanged state produce identical keys |
| Audit and apply authorize live | `isOrgAdmin` false → `404`; a cached `teacher` row does not grant access |
| Both work against a dead pointer | stored `installationId` bogus → audit loads, `installation:repair` offered, apply fixes it |
| `base-permission` detects drift | set org base perm to `read` → `broken` finding, unchecked by default |
| A session-less callback repairs, cannot create | `setup.ts`, no cookie |
| The join preview writes nothing | `GET /join/:token` for an active member → `class_members` unchanged |
| An orphaned group is surfaced, not deleted | `teamMembers` → `null` → row survives, `teamMissing: true` |
| Delete still refuses a group with a repo | `409 has_repo` |
| Two labs cannot share a title | `409 title_taken` |

## 10. Rollout

No backfill script. **Reconcile is the backfill** — per class, on demand, run by
the person who knows whether the roster is right. Every existing class shows
a partial roster until its teacher opens the page once. The audit names every
member the cache is missing, so the first apply makes it whole.

Classes fill `class_members` from the join `POST`s as students arrive. That covers
students who use the link — the normal path — but never anyone added to the org
directly on GitHub. Those appear on the first audit.

The cache converges from two directions: upward from each student's own join, and
downward from the teacher's reconcile. Neither alone is sufficient, and neither
runs on a `GET`.

## 11. Follow-ups (not in this spec)

- **`classes.ts:195`'s bare `catch {}`** swallows Drizzle errors as "org failure"
  and drops the class from the teacher's hub. This design fixes it by
  construction (the writes leave the read path), but the catch should still narrow
  to the GitHub fetches and log what it swallows.
- **`callerGithub` extraction** — the caller's numeric GitHub id is derived twice
  (`classes.ts:60`, `access.ts:131`), each re-deriving the `Number.isFinite`
  invariant on a TEXT column.
- **`enrolledTeachers`' inline join** (`classes.ts:243-257`) reimplements
  `linkedUsers` with a left join.
- **The `listClasses` decomposition.** After §5 the loop is one GitHub call and no
  writes; re-assess whether it still earns a split.

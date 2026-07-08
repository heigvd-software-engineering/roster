# Reconcile on demand — design

**Status:** approved, not implemented
**Date:** 2026-07-08

## 0. The principle

> A `GET` returns what it sees. Reconciliation is a verb a human performs.

Today four `GET` routes mutate the database. Three do it as a side effect of
rendering; one destroys rows. This design removes all three and relocates the
fourth, so the only writes left on a `GET` are the ones the HTTP protocol
forces on us.

## 1. Audit — every mutation on a GET path

| Route | Mutates | Character | Verdict |
|---|---|---|---|
| `GET /api/classes` | `classes.installationId` (`classes.ts:139-144`) | pointer repair | → `setup.ts` + reconcile |
| | `classes.{login,name,avatarUrl}` (`:159-173`) | identity cache | → reconcile button |
| | `class_members` via `syncRoster` (`:154-158`) | roster cache | → reconcile button |
| `GET /api/join/:token` | `class_members` via `observeMembership` (`join.ts:126`) | roster cache | → `POST /confirm` |
| | `classes.{login,name,avatarUrl}` (`join.ts:135`) | identity cache | → deleted (see §5) |
| `GET /classes/:id/labs/:labId/groups` | `DELETE FROM groups` (`lib/groups.ts:268`) | **destructive** | → `teamMissing` flag |
| `GET /api/github/setup` | `INSERT INTO classes` | install callback | **kept** |

`/api/github/setup` is GitHub's App-install Setup URL. GitHub redirects the
browser there; the `GET` *is* the command. Not a violation.

## 2. What `class_members` is, and why it stays

`class_members` is an enrollment **display cache**: it exists so a student's
class list is a pure DB read (`class_members ⋈ classes ⋈ labs`), zero GitHub
calls. It is never authorization — the teacher check reads live org membership.

It stays because **students join through the teacher's link**, and that flow is
a `POST`. The cache is populated at its source, not by a background sweep.

Write points after this change (all `POST`):

| Trigger | Sees | Effect |
|---|---|---|
| `POST /join/:token` — invite sent | the caller | insert `pending` |
| `POST /join/:token` — already a member | the caller | `observeMembership` |
| `POST /join/:token/confirm` — student accepted | the caller | `observeMembership` |
| lazy repair (`observeMembership`, membership `null`) | the caller | `forgetMember` |
| `POST /classes/:id/roster/reconcile` | **the whole org roster** | `syncRoster` |

### Reconcile is the roster's only CRUD authority

Every write point except reconcile observes **exactly one person: the caller**.
`observeMember` and `forgetMember` cannot know about anybody else. They converge
the cache from below, one student at a time, and only for students who visit.

`syncRoster` (`lib/enrollment.ts:68-117`) is the only whole-roster operation, and
it does all of it:

| | How |
|---|---|
| **Create** | insert every person on the live org roster |
| **Update** | `onConflictDoUpdate` → `state`, `login`, `avatarUrl` |
| **Delete** | `notInArray(githubId, keep)` → everyone no longer on the roster |

So reconcile is the *only* mechanism that can:

- **add** a member who joined the org out of band — a teacher who invited them
  directly on GitHub, or a student who accepted the invite from their email and
  never came back to the join page;
- **promote** someone to `teacher` after they were made an org Owner, or demote
  them back;
- **refresh** a changed `login` or `avatarUrl` for someone who never returns;
- **remove** a student the teacher removed on GitHub.

The join `POST`s can never do any of these, because they never see the roster.
That is precisely why the button exists, and why it is not merely "flush the
cache": it is the class's write path for everything GitHub owns about membership.

> **Destructive edge.** With `keep.length === 0`, `syncRoster` deletes every row
> for the class (`enrollment.ts:84-85`). That is correct — an org with no members
> has no members — but it means a reconcile against a transiently empty
> `orgPeople` response would wipe the cache. `orgPeople` throws rather than
> returning empty on failure, so this cannot happen silently; the reconcile
> handler must let that throw propagate, never swallow it into an empty roster.

## 3. Endpoints

### 3.1 `POST /api/classes/:id/roster/reconcile` (teacher-only)

The code that runs today at `classes.ts:135,139,145,154`, lifted out of the read
path. It is the single "make this class right" action, so it must not depend on
the very pointer it may need to repair:

```
userInstallationsByOrgId(callerToken)     → live installationId for cls.orgId
  absent → 403 { error: "no_installation" }   (App uninstalled, or caller has no access)

isOrgAdmin(live.installationId, org, ghId) → authorize (live, never the cache)
  false  → 404

persist classes.installationId  when it differs from live
orgPeople(org)  → syncRoster(class_members)   upsert active/pending/teacher,
                                              delete rows no longer on the roster
orgInfo(org)    → persist classes.{login,name,avatarUrl}
                → set classes.rosterSyncedAt = now

→ 200 { students, pending, teachers, added, removed, syncedAt }
```

`syncRoster` returns nothing today. It must report `added` and `removed` so the
button can say what it did (§6) — read the cached github ids before the sync and
diff against `keep`.

Five GitHub calls (`/user/installations`, `orgPeople`'s three paginated
endpoints, `orgInfo`), for **one** class. Per-class, never hub-wide: a
"reconcile everything" button is `3N` calls on one click, which is the cost this
design removes.

**Why not `resolveClassAsTeacher`.** That helper (`access.ts:122`) authorizes
via `orgLogin(cls.installationId)` — the *stored* pointer. If the pointer is
stale, it 404s, and the button advertised by `class_needs_reconcile` (§4) would
be unable to fix the class it was pointed at. Reconcile therefore derives the
installation id live, exactly as the hub does, and authorizes against that.

This makes reconcile a superset of the `setup.ts` repair (§3.3): the callback
fixes the pointer when GitHub redirects through it, and the button fixes it when
GitHub never did.

### 3.2 `POST /api/join/:token/confirm`

`GET /join/:token` becomes a pure preview: live `orgInfo` + `orgMembership`,
zero writes. When it reports the caller is already `active`, the page shows a
**"Finish joining"** button, which POSTs here. The handler re-reads live
membership and calls the existing `observeMembership` (`join.ts:85`) — so it
also handles the `teacher` and `forgetMember` branches for free.

Explicit rather than auto-fired on load: a mutation triggered by navigation is
the pattern we are removing, and a silent failure leaves the student's row
`pending` with nothing on screen to retry.

### 3.3 `GET /api/github/setup` — repair without a session

`installationAccount(env, installationId)` (`app.ts:11`) runs on the **App's
own JWT**. GitHub — not the caller — names the org that owns the installation.
The repair therefore needs no user session:

```ts
const acct = await installationAccount(c.env, installationId);   // App JWT
if (!acct?.isOrganization) return c.redirect("/?error=not_an_org");

const [existing] = await db.select().from(classes).where(eq(classes.orgId, acct.id));

if (existing) {
  // REPAIR. GitHub confirmed this installation belongs to this org, so the
  // WHERE is not attacker-controlled. Pointer only: never `status`, never
  // `connectedByUserId`, never `joinToken`.
  await db.update(classes)
    .set({ installationId, updatedAt: now })
    .where(eq(classes.orgId, acct.id));
  return c.redirect(session ? `/classes/${existing.id}/confirm` : "/");
}

// CREATE. Provenance matters: session + the caller really holds this install.
if (!session) return c.redirect("/");
if (!token) return c.redirect("/?error=github_not_linked");
if (!(await userHasInstallation(token, installationId)))
  return c.redirect("/?error=not_your_installation");
…insert…
```

**Security argument.** An attacker hitting the callback with an arbitrary
`installation_id` cannot choose the `WHERE`: GitHub resolves it to that
installation's true org, and an App has exactly one installation per org. The
worst achievable write is the correct value, or a no-op. `status` is excluded
so a session-less call can never resurrect a deactivated class.

**Consequence:** the `listClasses` backstop (`classes.ts:139-144`) is deleted.
It exists solely because `setup.ts` bails on four preconditions before its
write; three of them (`!session`, `!token`, `!userHasInstallation`) are
insert-strength checks wrongly applied to a repair.

### 3.4 `GET /classes/:id/labs/:labId/groups` — stop deleting

`groupsWithRosters` (`lib/groups.ts:261-273`) drops the group row when
`teamMembers` returns `null` (the team 404s on GitHub). A teacher loading their
lab page destroys rows.

It also **contradicts the invariant the explicit delete enforces**.
`deleteGroup` (`handlers/groups.ts:79-81`) refuses when a work repo exists —
*"a group whose WORK REPO exists is a deliverable — refuse rather than orphan
it"* — and the teacher UI disables the button to match
(`teacher-lab-groups.tsx:487-491`). The GET-path delete drops the row
regardless. Two code paths, opposite rules; the silent one wins on page load.

Instead: return the group with `teamMissing: true` and an empty roster.

#### Why this state is worse than it looks

Repo access is granted **to the team** (`grantTeamRepo` →
`PUT /orgs/{org}/teams/{slug}/repos/…`). When the team is deleted on GitHub the
grant dies with it, so the students lose push on their own work repo. Today the
row is silently deleted, which hides the breakage *and* orphans the repo. Once
marked, the group is visible but stuck: it cannot be deleted (`has_repo`),
cannot be worked in (no team, no grant), and nothing recreates a team.

#### The marker

`GroupLabStatus` gains `team_missing`, ranked **first** in `statusFor` — a
group whose roster is unknowable has no meaningful size or activity status.
`STATUS_SPINE` and `CHIP` (`teacher/roster.tsx:52,11`) are both
`Record<GroupLabStatus, …>`, so the type checker forces the new member into
both maps.

A fifth `Pill` tone, `broken`, on the existing `destructive` token — distinct
from `bad` (brand red = late work). Scanning the spine column, a teacher must
tell *"this group is behind"* from *"this group is broken"* without reading:
they are different actions.

```
STATUS_SPINE.team_missing = "border-l-destructive"
TONE.broken               = "bg-destructive/10 text-destructive"
CHIP.team_missing         = { label: "team missing", tone: "broken" }
```

#### The recovery — `POST /classes/:id/groups/:groupId/team`

Recreates the secret team under the group's stored `slug` and re-runs
`grantTeamRepo` against the existing repo. Students get push back; their work
was never touched. The roster is genuinely lost — it only ever lived in the
GitHub team — so the group returns **empty** and the teacher re-adds from the
pool. `ghTeamId`/`ghTeamSlug` are rewritten from the new team.

`deleteGroup`'s `has_repo` guard is **unchanged**. The repo is the durable
thing; the group row is not.

#### Two kinds of stray repo — do not conflate them

| | Group row | Repo | Cause | Recovery |
|---|---|---|---|---|
| **Unrecorded** | exists, `ghRepoFullName = NULL` | exists | `createWorkRepo` died after creating it | adoption (find-or-create) |
| **Orphaned** | gone | exists | *only* the GET-path delete | — |

Nothing in `apps/api/src` ever deletes a GitHub repo (verified: no `DELETE
/repos`, no `deleteRepo`). Student work is never destroyed by the app.

With the `has_repo` guard holding and this GET-path delete removed, **an
orphaned repo can no longer be created.** Adoption's real job is recovering a
partial `createWorkRepo` — an *unrecorded* repo, whose row still exists — which
is exactly what its docstring claims.

> `groups.ghRepoId` is globally `.unique()` (`app-schema.ts:93`) and adoption
> writes it. Adoption is therefore only safe while no *other* group row holds
> that repo id — true for the unrecorded case, and guaranteed by §5's lab-title
> constraint for everything else.

## 4. Reads after the change

### Teacher hub — `GET /api/classes`

| Field | Source | Cost |
|---|---|---|
| authorization | `orgMembership(org, callerLogin).role === "admin"` | 1 GitHub call **per class** |
| `installationId` | `live.installationId`, in memory | free (already fetched) |
| `login`, `avatarUrl` | `/user/installations` payload | free (already fetched) |
| `name` | cached `classes` row | free |
| students / pending / teachers | `class_members` | free |
| linked SWITCH users | `linkedUsers` | 1 DB query |
| labs | DB | 1 DB query |

Writes: **none.**

Two verified facts this rests on:

- `inst.account.avatar_url` is a required `string` on `GET /user/installations`
  (typechecked). `inst.account.name` is `string | null | undefined` — optional,
  so `name` cannot be trusted from that payload and must come from `orgInfo`
  (hence: the button).
- `/user/installations` returns installations the caller can *access*, not ones
  they own — a student with push on a work repo may appear there. So the live
  `orgMembership` check per class is **not optional**. `class_members` may never
  authorize.

Cost: **~4N GitHub calls → N + 1** (one profile fetch for the caller's login,
one membership check per class).

The teacher's card renders from `live.installationId`, never the stored value,
so a stale pointer cannot break the page that carries the fix.

### Everyone else

Routes that don't fetch `/user/installations` (student hub, join, lab pages)
read the stored `installationId`. If it is stale, the GitHub call 404s. Surface
`409 { error: "class_needs_reconcile" }` → *"This class needs reconciling — ask
your teacher."* Students structurally cannot repair it: re-deriving the id
requires `GET /user/installations`, which only lists installations the caller
administers.

The teacher can, from either end: reinstalling through the Setup URL (§3.3), or
pressing Reconcile, which derives the live id before it authorizes (§3.1). Those
are the only two writers of `classes.installationId`.

## 5. Schema

Migration `0011`:

```
classes.rosterSyncedAt   integer (timestamp), null
labs: unique(classId, title)
```

### `labs: unique(classId, title)`

A group's slug — and therefore its **repo name** — is
`` `${slugify(lab.title)}-${slugify(group.name)}` `` (`lib/groups.ts:59`). The
database only enforces `unique(labId, slug)` and `unique(labId, name)`
(`app-schema.ts:101`): **per lab**, not per org. And `labs.title` has no unique
constraint within a class, nor any check in `handlers/labs.ts`.

So two labs in one class both titled *"Lab 1"*, each with a group *"Alpha"*,
compute the same repo name in the same org. GitHub's team-name 422 blocks the
second *team* today — but only while the first team lives. Once it is gone
(§3.4), the second lab's group creates its team and then **adopts the first
lab's repo**: one lab's student work, attached to another lab's group, silently.

`unique(classId, title)` makes `slugify(title)-slugify(name)` genuinely
org-unique, so adoption can only ever re-attach a repo to the group that owns
it. `createLab`/`updateLab` return `409 { error: "title_taken" }`.

Repo names stay human-readable, and no existing group's slug changes — which
matters, because a recomputed slug would stop matching the repo it names, and
adoption would never find it again.

> Drizzle emits `unique()` on SQLite as `CREATE UNIQUE INDEX` (see `0010`,
> lines 25-28) — one statement, no table rebuild. It **fails at apply time if
> duplicates already exist**. Check before deploying:
>
> ```sql
> SELECT class_id, title, COUNT(*) FROM labs GROUP BY class_id, title HAVING COUNT(*) > 1;
> ```
>
> The local dev database is clean (12 labs, no duplicates). Production is
> unverified.

- `null` ⇒ never reconciled → the card renders **"Roster not synced · [Reconcile]"**.
- set ⇒ the popover footer renders **"Synced 2 days ago · [Reconcile]"**.

It cannot be inferred from `class_members` row count: the join flow inserts rows
into a class that has never been reconciled, and a reconciled class with no
students has only teacher rows. The column states the fact directly.

`join.ts:135` (the identity-cache refresh on the preview GET) is **deleted**
rather than moved. The join page already fetches `orgInfo` live for its own
render; persisting it there was opportunistic. Reconcile owns that write now.

## 6. UI

`PeopleChip` popover footer, on the teacher's class card:

```
┌─ 12 students · 1 pending ──────────────┐
│  Switch identity      GitHub identity  │
│  Alice Dupont         @alice           │
│  …                                     │
├────────────────────────────────────────┤
│  Synced 2 days ago      [ Reconcile ]  │
└────────────────────────────────────────┘
```

Always reachable, because the card always renders (§4). A class with
`rosterSyncedAt === null` renders the not-synced state on the card itself, so
the first reconcile does not require opening a popover.

On success the button reports what changed, in both directions: *"+2 added, 3
removed · 12 students, 1 pending"*. Reconcile creates, updates and deletes
(§2), and a silent success on a destructive sync is how a teacher fails to
notice it removed a student — or that it discovered two who had joined the org
without ever using the link.

## 7. Non-goals

- **Webhooks.** Still not adopted. Drift self-heals at the join `POST`s and at
  reconcile.
- **Promoting `class_members` to authority.** That belongs to the
  student-owned-repos proposal, which is an idea, not a plan. This design keeps
  it a display cache with the never-authorize invariant intact.
- **The `listClasses` decomposition.** Tracked separately (§9).

## 8. Testing

| Claim | Test |
|---|---|
| A session-less callback repairs an existing row | `POST` the callback with no cookie → `installationId` updated, `status`/`joinToken`/`connectedByUserId` unchanged |
| A session-less callback cannot create a class | no cookie, unknown `orgId` → redirect, no row |
| Reconcile repairs a stale pointer it needed to authorize | seed a stale `installationId`, `POST .../reconcile` → authorizes off the live id, persists it, syncs |
| The hub GET writes nothing | seed a stale `installationId`, hit `GET /api/classes`, assert the row is untouched and the card still renders |
| Reconcile syncs and stamps | `POST .../reconcile` → rows written, departed deleted, `rosterSyncedAt` set |
| Reconcile discovers an out-of-band member | a student on the org roster who never used the join link → row created, counted in `added` |
| Reconcile promotes a new org Owner | a member whose GitHub role became `admin` → row updated to `teacher` |
| Reconcile refuses to wipe on a GitHub failure | `orgPeople` throws → `500`, `class_members` untouched, `rosterSyncedAt` unchanged |
| A failing `syncRoster` no longer hides the class | force `syncRoster` to throw inside reconcile → `500`, but `GET /api/classes` still lists the class |
| An orphaned group is surfaced, not deleted | `teamMembers` → `null` → group returned with `teamMissing: true`, row still present |
| …and its repo is never orphaned | the group had a repo → row and `ghRepoFullName` both survive the GET |
| Recreate team restores push | `POST .../groups/:groupId/team` → new team under the same slug, `grantTeamRepo` re-run, roster empty, `ghTeamId` rewritten |
| Delete still refuses a group with a repo | `DELETE .../groups/:groupId` on a `teamMissing` group with a repo → `409 has_repo` |
| Two labs in a class cannot share a title | `createLab` with an existing title → `409 title_taken` |
| The join preview writes nothing | `GET /join/:token` for an active member → `class_members` unchanged |
| `POST /confirm` records acceptance | → row flips `pending` → `active` |

`apps/api/test/classes-list.test.ts` and `join.test.ts` already cover these
routes and are the regression net for the refactor.

## 9. Follow-ups (not in this spec)

- **`listClasses` decomposition** — `callerGithubId` (extract; two call sites at
  `classes.ts:60` and `access.ts:131`, both re-deriving the `Number.isFinite`
  invariant on a TEXT column), `teachingClass`, `reconcileClass`,
  `enrolledClasses`, `hasOlderThan`; parallelize the per-class fan-out with
  `Promise.all`.
- **The `catch {}` at `classes.ts:195`** swallows Drizzle errors as "org
  failure" and drops the class from the teacher's hub. This design fixes it by
  construction (the writes leave the read path), but the bare catch should still
  narrow to GitHub errors and log what it swallows.
- **`enrolledTeachers`' inline join** (`classes.ts:243-257`) reimplements
  `linkedUsers` with a left join.

## 10. Rollout

No backfill script. **Reconcile is the backfill** — per class, on demand, run by
the person who knows whether the roster is right. Every existing class shows
"Roster not synced" until its teacher clicks once, which is honest: we genuinely
do not know their roster.

Classes created after the change fill `class_members` from the join `POST`s as
students arrive. That covers students who use the link — the normal path — but
never anyone added to the org directly on GitHub. Those appear on the first
reconcile (§2), which is the only operation that reads the whole roster.

So the cache converges from two directions: upward from each student's own join,
and downward from the teacher's reconcile. Neither alone is sufficient, and
neither runs on a `GET`.

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

| Trigger | Effect |
|---|---|
| `POST /join/:token` — invite sent | upsert `pending` |
| `POST /join/:token` — already a member | `observeMembership` (upsert active/pending/teacher, or forget) |
| `POST /join/:token/confirm` — student accepted | `observeMembership` |
| `POST /classes/:id/roster/reconcile` | full sync: upsert roster, **delete departed** |
| lazy repair (`observeMembership`, membership `null`) | `forgetMember` |

Only reconcile deletes rows for people who left; the rest converge from below.

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

→ 200 { students, pending, teachers, removed, syncedAt }
```

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

Instead: return the group with `teamMissing: true` and an empty roster. The
teacher's roster row renders it as broken, with a *Remove group* action wired
to the existing `DELETE /classes/:id/groups/:groupId`. Deletion becomes a
`DELETE`, performed by someone who can see what they're destroying.

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

One nullable column, migration `0011`:

```
classes.rosterSyncedAt  integer (timestamp), null
```

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

On success the button reports what changed: *"12 students, 1 pending · 3
removed"*. Silent success on a destructive sync is how a teacher fails to
notice that reconcile deleted a student who was never really in the org.

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
| A failing `syncRoster` no longer hides the class | force `syncRoster` to throw inside reconcile → `500`, but `GET /api/classes` still lists the class |
| An orphaned group is surfaced, not deleted | `teamMembers` → `null` → group returned with `teamMissing: true`, row still present |
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

No backfill. Every existing class shows "Roster not synced" until its teacher
clicks once — which is honest, since we genuinely do not know their roster.
Classes created after the change populate `class_members` from the join `POST`s
as students arrive, and get a full sync on the first reconcile.

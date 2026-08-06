# Reconcile

GitHub holds the state that matters: org membership, teams, team rosters, repository grants, the App
installation. roster caches parts of it so pages render without calling GitHub, and writes to GitHub
through its own flows (see [classes and assignments](./classes-and-assignments.md)). Anyone with rights on the org
can edit a team, remove a member, flip a setting, or reinstall the App without telling roster.
Reconcile is how a teacher sees that and decides what to do about it. It lives in
`apps/api/src/lib/reconcile/`, behind two endpoints in `apps/api/src/handlers/reconcile.ts`.

## Two phases

The audit reads. `GET /api/classes/:id/audit` runs every reconciler and returns
`{ auditedAt, class, findings }`, writing nothing; `apps/api/test/reconcile-registry.test.ts` pins
that by comparing the tables before and after `runAudit`. Apply writes.
`POST /api/classes/:id/reconcile` takes `{ keys }` (200 at most), performs exactly those operations,
and answers `{ applied, failed }`. Both routes are registered in `apps/api/src/routes/classes.ts`. The
handler dispatches and reports; it never stamps the class row, because "when Apply last ran" answers
a different question from "is this class in sync", and only a fresh audit answers the second.

Both endpoints resolve the live installation id from `GET /user/installations` before authorizing,
then check `isOrgAdmin` against it. Authorizing through the stored `classes.installationId` would
make the page refuse to load exactly when the pointer it repairs is dead. A cached `teacher` row in
`class_members` authorizes nothing; see [identity](./identity.md).

`buildContext` (`context.ts`) is a reconciler's only handle on truth: the class row, the live org
login and installation id, and six memoized thunks (`orgInfo`, `people`, `orgPolicy`, `groups`,
`orgRepos`, `members`). Each source is fetched at most once per audit, rejections included, and
never at all if no reconciler asks. `orgPeople` alone costs three paginated calls.

A `Finding` (`types.ts`) carries a content-addressed `key`, a `severity` of `broken`, `drift` or
`info`, a one-line `title`, a `detail` of what was seen, a `fix` sentence (`null` means visible but
unfixable), and a `change` of `{ from, to }` for the state chips. `runAudit` never rejects: a
reconciler that throws yields one `info` finding keyed `<name>:unavailable`, so a dead installation,
which breaks every GitHub reconciler at once, still renders the page that repairs it.

## The registry

`index.ts` is a list. Adding a factor means adding a file that exports `{ name, audit, apply }` plus
one line. Order matters twice: `installation` runs first because every other GitHub read depends on
the pointer, and `group-members` follows `group-teams` because a group whose team is gone has no
roster to compare.

| Reconciler, key | Detects | Reads | Apply writes |
|---|---|---|---|
| `installation`<br>`installation:repair` | the stored pointer differs from the live installation id (a reinstall mints a new one) | `ctx.installationId`, `cls.installationId` | `classes.installationId`, matched on `orgId`, the one handle a reinstall preserves |
| `identity`<br>`identity:refresh` | `classes.login`, `name` or `avatarUrl` no longer match the org | `orgInfo()` | those three fields on the class row |
| `roster`<br>`roster:{add,remove,promote,demote,refresh}:{user,invite}=id` | the live org roster (members, Owners, open invitations) against the `class_members` cache | `people()`, `members()` | one row per accepted key, through `observeMember` / `forgetMember`, from a re-read of GitHub |
| `group-teams`<br>`group-teams:delete:groupId=…` | a group row whose GitHub Team 404s | `groups()`, one `teamMembers` call per group | deletes that group row; the work repo is untouched |
| `group-members`<br>`group-members:sync:groupId=…` | the live team roster differs from the `group_members` cache, or no roster was ever recorded | `groups()`, `teamMembers`, `cachedRosters`, assignment titles | `syncGroupMembers` replaces the group's cached rows with GitHub's team |
| `work-repos`<br>`work-repos:adopt:groupId=…` | a group with `ghRepoFullName` NULL while `org/slug` exists in the org, skipping the assignment's own template | `groups()`, `orgRepos()`, `assignments.templateRepoFullName` | `grantTeamRepo`, then `groups.ghRepoId` and `ghRepoFullName` |
| `base-permission`<br>`base-permission:reset`, `base-permission:repo-creation` | base repository permission other than `none`; members allowed to create repositories | `orgPolicy()` | one `enforceOrgPolicy` PATCH asserting both settings |

The caches they repair are in [data model](./data-model.md), the vocabulary in
[nomenclature](./nomenclature.md), the Worker they run on in [architecture](./architecture.md).

## The rules

**A 404 means unknowable, not empty.** `teamMembers` returns `null` on 404 and throws on anything
else. `group-members` skips a group whose team read came back `null`: diffing against nothing would
propose emptying a group whose roster merely failed to read. `group-teams` alone decides a vanished
team's fate, and pays for one call per group rather than one listing of the org's teams, because a
team the App cannot see would read as deleted, and that finding deletes a row.

**Follow GitHub rather than fight it.** As far as GitHub is concerned the team is the group: it holds
the roster and the push grant on the work repo. Delete the team and both are gone for good, so
`group-teams` drops the group row instead of recreating an empty team nobody asked for. The repo
stays, because nothing in `apps/api` deletes a GitHub repository and student work outlives the group
that made it. Orphans re-attach by name: a group recreated with the same assignment title and group name
computes the same slug, which `createWorkRepo`'s find-or-create path (or `work-repos`) links straight
back. Teams that exist on GitHub with no group row are left alone; an org has teams roster never
made, and roster cannot know which assignment they would belong to.

**Apply names its subjects.** `roster:remove` deletes one row through `forgetMember`, never
`syncRoster`, whose meaning is "delete everyone absent from the live roster". A proposal that goes
stale between audit and apply can therefore only do too little. `reconcile-roster.test.ts` holds that
line: GitHub's roster empty, one box checked, exactly one of three rows destroyed.

**Every operation is idempotent, so a second apply writes the same rows.** Deleting a row already
gone is a success, in both `roster` and `group-teams`; a work repo linked between audit and apply is
a no-op success that never calls GitHub; `enforceOrgPolicy` asserts the whole policy, so repairing
one setting leaves a correct one alone. Apply re-reads GitHub rather than trusting the proposal,
since the teacher chose which subject to fix, not what to write: an invitation accepted since the
audit lands as `active`, not as the `pending` the audit described.

**Failures are per key.** One reconciler throwing loses no other reconciler's results, in either
phase; one operation failing loses no other operation. A key whose prefix owns no reconciler comes
back as `{ ok: false, error: "unknown_reconciler" }`.

## How a teacher gets there

The class card carries a "GitHub sync" popover (`hub/class-card.tsx`), labeled with the word in a
teacher's head, whose button navigates to `/classes/:id/reconcile`. The popover says what the click
does: a read-only comparison, and nothing changes until Apply. Students meet the subsystem from the
other end. A join link against a stale pointer answers `409 class_needs_reconcile`, and the join page
tells them to ask their teacher; re-deriving the installation id needs an endpoint that lists only
installations the caller administers, so a student cannot repair it.

`apps/www/app/pages/reconcile-page.tsx` groups findings into Class, Roster, Groups and Security by
reconciler name, and sweeps unrecognised names into a final "Other" section so a new reconciler
cannot vanish from the page that exists to surface it. Every finding with a `fix` starts checked; the
rest get no checkbox and read "Nothing to apply". The `change` pair renders as a from/to chip, and
the `fix` sentence stands in when a finding has no two-state reading.

`reconcile/reconcile-guide-dialog.tsx` answers "What does reconcile cover?" from a hand-written
`GUIDE` array: the same four sections, one entry per drift, plus the promise that a check which
cannot run reports itself alone. It is prose because titles are generated per finding, leaving no
static list to render, and a quiet link rather than a banner. Its entries match the registry today,
one for `installation`, one for `identity`, four for `roster`'s operations, three for the group
reconcilers, two for `base-permission`'s settings.

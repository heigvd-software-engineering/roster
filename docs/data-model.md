# Data model

One D1 (SQLite) database, described by Drizzle table models in `packages/db`.
`src/auth-schema.ts` holds the four tables Better Auth owns, `src/app-schema.ts`
the app's six, and `src/schema.ts` re-exports both: that barrel is what `getDb`
registers and what drizzle-kit reads. Keeping them in sibling files means
regenerating the auth schema can never wipe an app table. The rule the app tables
follow is to store only what GitHub cannot express: org membership, team
membership and repo permissions live on GitHub, and what the app keeps of them is
a cache, marked as such below.

## Better Auth tables

The Better Auth CLI generates `auth-schema.ts` (`pnpm --filter @roster/api run
auth:schema`); never edit it by hand. `user` holds one person, `email` unique,
with `firstName`/`lastName` fed from edu-ID claims through `additionalFields`.
`session` holds cookie sessions, `verification` Better Auth's own store. The one
that matters downstream is `account`, one row per linked provider: `providerId`
is `eduid` or `github`, `accountId` is that provider's user id, `accessToken`
holds the GitHub token. It is the join between GitHub's id space and the app's.
See [identity.md](./identity.md).

## App tables

| Table | Holds | Points at |
|---|---|---|
| `classes` | A connected class: the anchor row for one GitHub org App installation. `orgId` unique, `installationId` refreshed on reinstall, `joinToken` unique, `status` `active`/`archived`, and a `login`/`name`/`avatarUrl` identity cache so the student class list costs zero GitHub calls. | `connectedByUserId` → `user.id` |
| `assignments` | An assignment: `title`, `deadline`, optional `startAt` gate, `groupMode` (`individual`/`group`) with `minMembers`/`maxMembers`, and the optional template repo (`templateRepoId`, `templateRepoFullName`) that work repos are generated from. | `classId` → `classes.id`, `createdByUserId` → `user.id` |
| `groups` | A student group owning exactly one assignment, backed by one GitHub Team, plus that group's work repo (`ghRepoId`, `ghRepoFullName`, both null until the repo exists). | `assignmentId` → `assignments.id`, `creatorUserId` → `user.id` |
| `group_members` | Display cache of a team's roster: `githubId`, `login`, `avatarUrl`. | `groupId` → `groups.id`, `ON DELETE CASCADE` |
| `class_members` | Display cache of org membership: `state` (`pending`, `pending_teacher`, `active`, `teacher`), `githubId`, `invitationId`, `login`, `avatarUrl`. | `classId` → `classes.id` |
| `class_creators` | The class-creation grant. The row's presence is the grant, so no boolean can drift. | `userId` → `user.id`, primary key |

The shape is a chain: a class has assignments, an assignment has groups, a group has cached
members. A group reaches its class through `assignment.classId` and stores no `classId`
of its own, so there is nothing to keep in sync. Only the last link cascades:
`groups.assignmentId` carries no `ON DELETE` clause, so `deleteAssignment` deletes the groups
itself, in order, after deleting their GitHub Teams. `class_creators` says who may
create a class, never who may grant that; super admins are config, not a table.
`index.ts` exports `getDb(d1)` and the row types `User`, `Account`, `Class`,
`Assignment`, `Group`, `ClassCreator`.

## Ids are keys, names are display

Every GitHub-backed row keys on the numeric id and caches the human-readable
string beside it. A class keys on `orgId`, which survives an uninstall and
reinstall, while `installationId` changes and is refreshed on read. A group keys
on `ghTeamId` and `ghRepoId`, because a rename changes a team's slug and a
transfer changes a repo's full name. Login, name and avatar are cache: correct
enough to render, never load-bearing.

Groups carry three identifiers on purpose: `name` ("Team Alpha") is the display
label, unique per `(assignmentId, name)` and never sent to GitHub; `slug` is
`slugify(assignment.title)-slugify(name)`, org-unique by construction, and names both
the team and the work repo; `ghTeamSlug` is what GitHub returned, the truth for
API paths, equal to `slug` unless GitHub deduped.

## The display caches never authorize

`class_members` and `group_members` mirror state GitHub owns, and no endpoint may
authorize against either. A stale row would be a stale grant: team membership is
what grants push on a group's work repo, so a `group_members` row that outlived
the real membership would show a student as entitled to a repo GitHub has locked
them out of, or the reverse. Org membership is likewise what makes someone a
member of a class. Anything that grants access or touches a GitHub resource
verifies live, or acts through a token and lets GitHub refuse. A stale row may
show a dead class card or a stale face on a roster; it must never open a door.

Both caches are written where the app already observes the truth for free:
`syncGroupMembers` re-reads the one team it just mutated and replaces that
group's rows, `observeMember` and `forgetMember` write the one person the caller
just saw. Neither has a bulk sweep, because a "delete everyone absent from the
roster" writer would let one stale read remove students it never named.
Whole-roster drift is the reconciler's job, one accepted finding at a time
([reconcile.md](./reconcile.md)).

## A 404 from GitHub means unknowable, not empty

When `syncGroupMembers` asks for a team's roster and GitHub answers 404, it
returns null and leaves the cached rows alone. The roster only ever lived in the
team, so deleting the rows would destroy the only surviving record of who was in
the group on the strength of a call that merely failed. Deciding that a team is
really gone belongs to the `group-teams` reconciler, which checks each team
individually (from a bulk listing, a team the App cannot see would read as
deleted). Accepting its finding deletes the group row, never the work repo:
nothing here deletes a GitHub repository, because student work outlives the group
that made it.

## Unique constraints

| Constraint | Prevents |
|---|---|
| `classes.org_id` | Two class rows anchored to the same GitHub org. |
| `classes.join_token` | Two classes reachable through one join link. |
| `assignments (class_id, title)` | Two assignments in one class sharing a repo namespace. Group slugs derive from the assignment title, so identical titles make two assignments' groups compute the same repo name in the same org, and the work-repo reconciler could adopt one assignment's student work into another assignment's group. |
| `groups.gh_team_id` | Two group rows claiming one GitHub Team. |
| `groups.gh_repo_id` | Two groups claiming one work repo. |
| `groups (assignment_id, name)` | Duplicate friendly names inside an assignment, caught with a readable error and no GitHub round-trip. Names still reuse freely across assignments. |
| `groups (assignment_id, slug)` | Two groups in an assignment computing the same team and repo name. |
| `group_members (group_id, github_id)` | A person listed twice on one roster. |
| `class_members (class_id, github_id)` | A person enrolled twice in one class. |
| `class_members (class_id, invitation_id)` | One open invitation tracked by two rows. |

`class_members` needs two constraints because "person" spans two id spaces. An
open invitation read off `GET /orgs/{org}/invitations` carries an invitation id,
a login and an email, but no user id, so `githubId` is null on those rows, while
membership rows have a user id and no invitation. Neither index needs a
`WHERE ... IS NOT NULL` predicate: SQLite treats NULLs as distinct in a unique
index, so each already constrains only the rows where its column is set. Both
stay non-partial because `observeMember` upserts on either one, and a partial
index is an upsert target only if `ON CONFLICT` repeats its predicate. A plain
index on `class_members.github_id` answers "which classes has this person been
invited to?", asked at every sign-in; the unique index leads with `classId` and
cannot serve it.

## Why there is no participations table

An earlier model had reusable class-scoped groups joined to assignments through a
`student_lab_repos` pairing table, one row per group-assignment pair holding that pair's
repo. The many-to-many relation it expressed was the bug: one team's roster was
atomic across every assignment it touched, so a student could not have different
groupmates on different assignments without abandoning a group elsewhere.

Groups are now per-assignment, each owning its own team, which leaves the pairing table
1:1 with the group and therefore pure overhead. The repo columns moved onto
`groups` and migration 0010 dropped the table. With one assignment per group, the group
IS the participation: it holds the roster (in the team), the repo, and the assignment
link. "At most one group per student per assignment, no restriction across assignments" becomes
a lookup inside one assignment's groups instead of a cross-assignment collection walk. Reusing
a group means copying its roster into a fresh group for this assignment, and drift
between the copies is the point.

## Migrations, and what this package is not

`packages/db` is schema only, with no query-helper layer. Endpoints write their
Drizzle queries inline and the response types reach the SPA through Hono's
`hc<AppType>` inference, so the Drizzle models stay the single source of truth.
Shared logic that queries lives in `apps/api/src/lib/`, and the package carries
no tests: query behavior is tested in `apps/api` against a real local D1.

Changing the schema means editing `app-schema.ts` (or regenerating
`auth-schema.ts` for an auth config change), then running
`pnpm --filter @roster/db db:generate --name <what_it_does>`. Always pass
`--name`; never ship drizzle-kit's random names. Migrations are numbered SQL
files under `packages/db/migrations`, applied by wrangler in order; see
[architecture.md](./architecture.md) for the commands.

Generated SQL is hand-adjusted where SQLite's limits require it, and can then
differ from what Drizzle declares. `classes.join_token` is the live case: Drizzle
marks it `NOT NULL`, but `ALTER TABLE ADD COLUMN` cannot add a NOT NULL column
without a constant default, so the SQLite column is nullable and existing rows
were backfilled with random hex. Every insert path must therefore mint a token
itself, since the database will not catch a missing one.

Related: [classes-and-assignments.md](./classes-and-assignments.md) for the flows that write
these tables, [nomenclature.md](./nomenclature.md) for the vocabulary.

# Classes and labs

A class is a GitHub organization, a lab is an assignment in it, a group is a GitHub
Team, and a work repo is a private repository the team holds push on. GitHub owns
every fact that grants access; roster stores pointers and display caches. See also
[data model](./data-model.md), [identity](./identity.md), [reconcile](./reconcile.md)
and [nomenclature](./nomenclature.md).

## Connecting a class

A teacher connects a class by installing the roster GitHub App on an organization they
own. GitHub then calls the App's Setup URL, `GET /api/github/setup`
(`apps/api/src/handlers/setup.ts`), which resolves `installation_id` through the App's
own JWT (`installationAccount`), so GitHub, not the caller, names the org; a personal
account redirects with `not_an_org`.

The handler then splits. **Repair** covers an org that already has a class row. A
reinstall often fires the callback with no roster cookie, and an App has one
installation per org, so GitHub's answer pins the write target and repair needs
neither session nor ownership check. It writes the installation pointer and the org
identity cache, nothing else: never `status`, so a session-less call cannot resurrect
a deactivated class, never `joinToken`, so a reinstall cannot kill the cohort's link.

**Create** demands a session, the `class_creators` grant (`userCanCreateClasses`, one
condition for everyone, super admins included), a usable GitHub token, and
`userHasInstallation` proving the caller holds this installation. Installation ids are
enumerable, so without that check any signed-in user could claim any org's
installation. Both paths then run `seedRoster`, mirroring the org's live people into
the `class_members` display cache.

`POST /api/classes/:id/confirm`, behind the confirm page's button, PATCHes the org to
`default_repository_permission: "none"` and `members_can_create_repositories: false`,
re-reads both, and returns `ok` only when both took
(`apps/api/src/lib/github/org.ts`). No access is the isolation rule the model rests
on: membership grants nothing by itself, so a student sees only repos their team was
granted, and any repo they could create would sit outside every gate. The organization
is the record.

## Enrollment

`classes.joinToken` is a capability: 128 random bits as 32 hex chars
(`apps/api/src/lib/join-token.ts`), separate from the class `id`, so a leak is fixable
without touching identity. Only teachers see it, since `GET /api/classes` is filtered
to live org Owners. `POST /api/classes/:id/join-token` rotates it and moves nothing
else: enrolled students hold org membership, so rotating costs a new link, never
anyone's access.

The student flow (`apps/api/src/handlers/join.ts`) sits behind `requireAuth` and a
rate limiter. `GET /api/join/:token` previews the class and the caller's live
membership and writes nothing. `POST /api/join/:token` reads live membership first,
and any existing membership, active or pending, short-circuits, so an Owner opening
their own link is never demoted by a `role: "member"` PUT; otherwise `PUT
/orgs/{org}/memberships/{username}` creates the pending invite and a `pending` row
lands in the display cache. The student accepts natively on GitHub and returns, and
the page POSTs `/api/join/:token/confirm`, which re-reads live membership rather than
trusting the client and caches an Owner as `teacher`, never as an enrollee. An unknown
token is `404 invalid_link`, so no response reveals whether a class exists; a valid
token whose org is unreachable is `409 class_needs_reconcile`, telling the student
their teacher must fix something.

## Teachers

A teacher is a live org Owner. There is no teacher table: making a co-teacher means
making them an Owner, and demoting them removes their access on the next read. The hub
answers the Owner question for every class in two bulk user-token calls:
`userInstallationsByOrgId`, the orgs the App still reaches for this caller,
intersected with `userOrgMemberships`, their role and state in each. A class shows
only when its org is in both maps and the membership reads `role: "admin", state:
"active"`, so a pending Owner invite sees nothing and an org missing from either call
is skipped.

`POST /api/classes/:id/teachers` invites one by GitHub username. `lookupUser`
canonicalizes it, then membership decides: a pending invite of any role is `409
already_invited`, an existing admin `409 already_teacher`, an active member is
promoted in place and teaches instantly, and a non-member gets an Owner invitation
cached as `pending_teacher`, so an invited teacher never lists among the students.

## Labs

A lab (`apps/api/src/handlers/labs.ts`, teacher-only) carries a title, a `deadline`,
an optional `startAt`, a `groupMode` of `individual` or `group`, `minMembers` and
`maxMembers` for group labs, and an optional template repo. Group labs need
`minMembers <= maxMembers`; individual labs take neither, being groups of one. A
duplicate title in the class is `409 title_taken`, because two labs with one title
would share a repo namespace: a group's work repo is named
`slugify(lab.title)-slugify(group.name)`. A `startAt` at or after the `deadline` is
`409 start_after_deadline`, the only date rule; lab ranges overlap freely.

`DELETE /api/classes/:id/labs/:labId` (`deleteLab`) removes the lab, every group in it,
their GitHub Teams and the cached rosters that cascade off them. Both it and
`deleteGroup` hand the groups to `deleteGroupsWithTeams` (`apps/api/src/lib/groups.ts`),
the counterpart of `createGroupInLab` and the one place that knows the order: teams
before rows, so a GitHub failure leaves rows the `group-teams` reconciler already knows
how to clear rather than teams nothing can name again. The work repositories survive in
the org, orphaned; nothing in this codebase deletes a GitHub repository.

Neither handler refuses anything: **the app has one deletion rule, and it lives in the
client.** `DeleteDialog` (`apps/www/app/components/custom/delete-dialog.tsx`) names what
goes, names what survives, and asks for the thing's own name to be typed out; its
`STAKES` sentences are the single wording every call site composes. There is no gentler
variant and no second gate behind it, because "did you mean it" is a fact about a person
that no handler can check. `deleteGroup` used to answer `409 has_repo` on a group whose
work repo existed, which read as a guarantee it never was, since deleting the lab above
it took that same group anyway; the block is gone and only join and leave still speak
`has_repo`.

The ceremony is affordable because the loss is bounded, but the way back is the
reconciler, NOT the create path. The orphaned repo waits under its old name; recreate a
group with the same lab title and group name and the row becomes the `work-repos`
reconciler's UNRECORDED case, which the teacher adopts from the class's GitHub sync.
Clicking "create repository" on that group instead answers `repo_name_taken` —
`createWorkRepo` is create-only and never adopts (see its doc).

`startAt` is the start gate. `labStarted` (`apps/api/src/lib/groups.ts`) is `startAt
=== null || startAt <= now`, derived per request, so a lab opens on time, with no
draft state. Before the start every student action answers `409 not_started`: creating
a group, joining or leaving one, creating the work repo, accepting an individual lab.
Teachers pass every gate, the deliberate escape hatch, and the gate precedes even the
idempotent repo return, so a pre-created repo stays shut.

What the gate hides matters as much as what it blocks. A pre-start student calling
`listLabGroups` gets the lab and class identity with empty `groups`, `users` and
`students`, so pre-formed rosters stay invisible and a direct URL renders a "starts on
..." page, not a 404. The class card's labs table hides the starter-code note from
students on a locked lab (`apps/www/app/components/custom/classes/labs/labs-table.tsx`),
because the template repository's name, something like `lab1-solution`, is itself the
leak. `GET /api/classes/:id/templates` lists the org repos flagged `is_template`, the
only ones `/generate` accepts. Lab lists run in course order, by `coalesce(startAt,
createdAt)`.

## Groups

A group belongs to exactly one lab and owns its GitHub Team; "reuse a group" copies a
roster forward into a fresh one rather than sharing. The invariant is therefore local:
at most one group per student within a lab, none across labs. Of the three identifiers
only `name` ("Team Alpha") is human-facing, unique per lab; `slug` is
`slugify(labTitle)-slugify(name)`, org-unique and handed to GitHub as the team's name;
`ghTeamSlug` is what GitHub returned.

Any active member may create a group, `POST /api/classes/:id/labs/:labId/groups`
(`createGroupInLab`, `apps/api/src/lib/groups.ts`); a duplicate display name is
`name_taken`. The team is `secret`, so nobody discovers it out of band, and members
are always role `member`, so only roster and org Owners manage rosters. A creating
student auto-joins; a teacher stays out, and `copyFromGroupId` seeds the roster from a
group in another lab, all or nothing.

Join and leave are `PUT` and `DELETE /api/classes/:id/groups/:groupId/membership`,
where the caller only ever acts on themselves (`apps/api/src/handlers/groups.ts`);
teachers use `.../members/:login` to move anyone. Every refusal is a 409:
`not_started` before the lab opens, `has_repo` once the work repo exists,
`member_already_participating` when the student already has a group in this lab,
`group_full` at the lab's max (1 for individual, unlimited when `maxMembers` is null),
and `group_incomplete` when repo creation finds the group under the lab's min
(`labMin`, 1 for individual labs and `minMembers ?? 1` otherwise). A later size change
evicts nobody.

The lock is the group's freeze moment: once `groups.ghRepoId` is set the group is a
deliverable, join and leave answer `has_repo`, and `addGroupMember` and
`removeGroupMember` are the teacher's escape hatch. Deletion is NOT gated on it (see
above): the lock decides who may move in and out of a group, never whether the group
may exist. The check reads roster's own
column, so cache drift cannot weaken it, and since repo creation writes `ghRepoId`
only after a chain of GitHub calls, join and leave re-read the lock after the team
write and roll back before answering 409.

The GitHub Team is the authority: it holds the roster and it carries the push grant.
Every mutation ends in `team.syncMembers`, mirroring that one team into
`group_members` (`apps/api/src/lib/group-members.ts`), so display reads cost no GitHub
calls and an out-of-band edit self-heals on the next mutation. Deleting a group is
teacher-only and drops the team and the row, or the row alone if the team is gone.

## Work repositories

A work repo is created once a group meets the lab's min, by any member of the group or
by a teacher: `POST /api/classes/:id/labs/:labId/groups/:groupId/repo`. The
completeness check reads the live team roster, never the cache, because it gates an
irreversible create. The repo is named by the group's `slug`, private, generated from
the lab's template or empty and auto-initialized; `grantTeamRepo` gives the team
`push`. Repos belong to the class org, not to students.

Creation is create-only and never adoption. Students pick group names, so a group
named to collide with the teacher's private `lab1-solution` would, under adoption, end
with students granted push on the solution. A collision answers `repo_name_taken` on
every path, and an interrupted create is recovered on the audit page (see
[reconcile](./reconcile.md)). The group row is written after creation and before the
grant, so a request that dies mid-flight leaves a recorded repo with a missing grant,
re-asserted by the next accept click (`regrantWorkRepo`). The teacher's `POST
/api/classes/:id/labs/:labId/repos` creates every missing repo in the lab,
sequentially because creation bursts trip GitHub's abuse limits, skipping blockers.
For individual labs `POST /api/classes/:id/labs/:labId/accept` finds or creates the
caller's solo group, named after their login, and creates the repo in one click.

Missing repos are detected for free. `listLabGroups` already pages the org's repos for
push activity, so a linked repo absent from that listing is a suspect, not proof: a
rename drops the old full name exactly as a deletion does. Each suspect costs one
`getOrgRepo` by the group's original slug, which follows GitHub's rename redirect, so
a rename heals silently while a confirmed 404 becomes `repoStatus: "missing"`, never
stored. The check runs only when the listing succeeded, so an outage never reads as
"every repo is gone". A missing repo would lock the group forever, so the teacher
unlinks it with `DELETE /api/classes/:id/groups/:groupId/repo`, which re-verifies live
and answers `409 still_exists` when the repo came back.

## Access scoping

Every class-scoped route first resolves a scope (`apps/api/src/lib/class-scope.ts`)
and works inside it. `findGroupInClass` and `findLabInClass` keep child lookups inside
the same boundary, so a valid group or lab id from another class resolves to nothing.

`resolveClassAsMember` serves routes where the caller acts as themselves, returning
the class row, the org and caller logins, `isTeacher`, the live membership state, and
the class's Team API pre-bound to this installation. Active members only, unless the
route passes `allowPending` so a read-only surface can say "accept your invitation
first" instead of 404. `resolveClassAsTeacher` is a different mechanism, not a
stricter version: it asks the org, through the installation token, whether the
caller's stored GitHub account id is an Owner, and never touches their OAuth token, so
a teacher whose GitHub link expired can still run the class. Both read names from
caches, so the hot path costs one GitHub call, the authorization itself; a miss
re-derives the names and retries once. Both deny with null and routes answer 404, so
an outsider never learns a class exists, while `GithubUnavailableError` propagates and
an outage answers 503.

Authorization asks GitHub, always. `class_members` and `group_members` are display
caches, and a cached `teacher` row is a display fact, not a role. Where an answer
authorizes or gates an irreversible write, the code reads live: is the caller an
Owner, are they in this group, is the group complete enough for a repo. The caches
make rendering cheap and decide nothing.

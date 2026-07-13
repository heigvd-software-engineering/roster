# Lock group membership once the work repo exists

**Date:** 2026-07-13
**Branch:** `milestone-8-security`
**Status:** Approved

## Problem

A student can leave their lab group after its work repository exists, join
another group, and — because repo push access is granted via the GitHub team —
immediately see that group's work. Nothing blocks the hop:

- `leaveGroup` (`apps/api/src/handlers/groups.ts`) has no repo-existence
  check, unlike `deleteGroup` (409 `has_repo`).
- `joinGroup` has no repo-existence check either; joining adds the caller to
  the GitHub team, which carries push on the group's private repo.
- The solo "Withdraw" button calls the group-delete endpoint, which already
  refuses `has_repo` — so individual labs are covered on the backend today.
  (Discovered during planning: that endpoint is also admin-gated, so a
  student's Withdraw has always failed with a silent 404. It is also only
  reachable in a rare failure state — accept creates group + repo in one
  click, and the button needs `repo === null`. Decision: REMOVE the button.
  Accepting an individual lab is that mode's point of no return, mirroring
  the group repo lock; the teacher deletes solo groups when needed.)

## Design

Once a group's work repository exists (`groups.ghRepoId !== null`), its
membership is **locked**: students can neither join nor leave on their own.
Only the teacher can change a locked group, via the existing teacher-only
`addGroupMember` / `removeGroupMember` endpoints. The moment of no return is
**repo creation**, and the student who triggers it is warned.

### 1. Backend guards (authoritative) — `apps/api/src/handlers/groups.ts`

- **`leaveGroup`**: if the group's `ghRepoId !== null`, return
  `409 { error: "has_repo" }` — the same error code `deleteGroup` uses for
  the same condition. (Solo "Withdraw" goes through the delete endpoint,
  whose `has_repo` guard already exists — individual labs need no new
  backend work.)
- **`joinGroup`**: same guard, same 409. This is the check that closes the
  peek vector — it compares against our own DB column, so cache drift cannot
  weaken it.
- **Teacher paths untouched**: `addGroupMember` / `removeGroupMember` keep no
  repo guard. They are the deliberate escape hatch.

### 2. Frontend — student view (`student-lab-groups.tsx`)

Mirror the existing teacher Delete-button pattern (disabled + `title`
tooltip; the server refuses anyway, the disabled state just says so up
front):

- **Leave**: when `repo !== null`, disabled with tooltip
  *"The group's work repository exists — ask your teacher to move you."*
- **Join**: stays visible when the group has space, but when `repo !== null`
  it is disabled with tooltip
  *"This group's repository exists — only your teacher can add members."*
- **Solo Withdraw**: removed entirely. It was broken (student-side 404
  against an admin-only endpoint) and only reachable when the accept's repo
  step had failed — a state whose correct action is the existing "Create
  repository" retry, not bailing out. Accepting an individual lab is final
  from the student's side; the teacher deletes solo groups when needed.

### 3. Frontend — create-repo confirmation (`start-lab-card.tsx`)

Wrap the group-lab "Create repository" action in the existing
`ConfirmDialog`:

> **Create the work repository?**
> This locks the group: once the repository exists, nobody can join or leave
> on their own — only your teacher can change the group. Make sure everyone
> is in before you continue.

- No dialog for joining/leaving groups that have no repo yet.
- No dialog for individual-lab accept (solo group — nothing to warn about).
- The teacher's batch "Create N missing repositories" confirm gains one
  sentence noting that groups lock on creation.

### 4. Tests

- **API** (`apps/api/test/groups.test.ts`):
  - leave on a repo-having group → 409 `has_repo`;
  - join on a repo-having group → 409 `has_repo`;
  - both still succeed when `ghRepoId` is null;
  - teacher `addGroupMember` / `removeGroupMember` still work on a locked
    group.
- **www** (`apps/www/test/student-lab-page.test.tsx`, lab-dialog tests):
  - Leave is disabled with the tooltip when the repo exists;
  - Join is disabled when the repo exists;
  - Create-repo shows the confirm dialog and only calls the API on confirm.

## Accepted risks (documented, not engineered around)

- **GitHub-side team leave.** GitHub lets a team member leave the team on
  github.com, bypassing our API. This is self-sabotage only: they lose their
  repo access, the reconciler drops the cache row, and they can then join
  only repo-less groups (the backend join guard reads `groups.ghRepoId`, not
  the cache) — so there is nothing to peek at. The drift is visible to the
  teacher as a group below min size.
- **Leave-vs-create race.** A leave landing between `createLabRepo`'s
  min-size check and the repo write could yield a locked group below min.
  The teacher re-adds the student; not worth a transactional dance.
- **Premature-lock griefing.** A min-size group can create its repo early to
  lock others out. The confirmation dialog warns, and the teacher can still
  add members afterwards.

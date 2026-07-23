# Detect and surface repos deleted directly on GitHub

**Date:** 2026-07-23
**Branch:** (none yet)
**Status:** Proposed

## Problem

A group's `groups.ghRepoFullName` / `groups.ghRepoId` point at a GitHub repo.
If a teacher deletes that repo directly on GitHub (bypassing the app),
nothing detects it:

- `RepoLink` (`apps/www/app/components/custom/classes/groups/shared/group-tile.tsx:74-87`)
  renders a plain `<a>` from the stored `repoFullName` — a dead link, 404 on
  click.
- `deleteGroup` refuses with `409 { error: "has_repo" }` whenever `ghRepoId
  !== null` (`apps/api/src/handlers/groups.ts:13,156-158`) — the group stays
  permanently un-deletable.
- The create-repo button never reappears; both teacher and student UIs only
  show it when `repoFullName === null`
  (`teacher-lab-groups.tsx:414-435`, `start-lab-card.tsx:37-38`).
- `apps/api/src/lib/reconcile/work-repos.ts` only handles the opposite drift
  (an org repo that exists but isn't linked yet); its header comment assumes
  "nothing in apps/api ever deletes a GitHub repo," which stops being true
  the moment a repo is deleted by hand.

No in-app signal, no way out, for a case a teacher will occasionally hit.

## Design

### 1. Detection — piggyback on the existing fetch, stay free

`listLabGroups` already pages through the entire org's repos on every
lab-page visit via `orgRepoActivity`, into a map keyed by full name, purely
to compute `pushedAt`/`repoCreatedAt` for status chips
(`apps/api/src/handlers/lab-groups.ts:129-149`). Reuse that map instead of
adding a new GitHub call for the common case:

- After a **successful** `orgRepoActivity` fetch, any group with
  `repoFullName` set but absent from the map is a suspect. (Track fetch
  success as its own boolean, separate from the map — on failure the map is
  simply empty, and treating that as "everything deleted" would misfire on
  every GitHub outage or rate limit.)
- Suspects are rare (zero in the common case), so confirm each with one
  direct call, `getOrgRepo` (`apps/api/src/lib/github/repo.ts:31-43`):
  - **404** → truly deleted.
  - **200 with a different `full_name`** → GitHub followed a rename
    redirect, not a deletion. Silently heal `groups.ghRepoFullName` to the
    new value and continue — no badge, no teacher involvement. (Skipping
    this check would misreport every rename as "deleted" and could send a
    teacher to needlessly delete a working group.)
- Add one derived field to `listLabGroups`'s per-group response:
  `repoStatus: "ok" | "missing"`. Not persisted — recomputed on each fetch;
  `ghRepoFullName` remains the source of truth for the link itself.

### 2. UI — reuse existing affordances, no new one-off buttons

In `group-tile.tsx`, when `repoStatus === "missing"`, render a small red
"404" badge next to `RepoLink`. Clicking it opens a popover:

> **This repository no longer exists on GitHub.**
> Unlink it to delete this group or create a new repository.
>
> [Unlink repository]

The popover has exactly one action — **Unlink**. It deliberately does not
grow bespoke "delete" or "recreate" buttons: unlinking clears
`ghRepoId`/`ghRepoFullName`, which flips the tile back to its normal
unlinked-group render, and the tile's *existing* Delete-group button and
*existing* Create-repo button appear on their own — same two flows every
other unlinked group already uses.

- **Badge + explanation**: visible to everyone who sees the tile (student or
  teacher) — it's status information.
- **Unlink button**: teacher-only, matching the existing rule that only the
  teacher changes a locked group's lifecycle
  (`groups.ts:11`, the same actor who already deletes groups).

### 3. Backend — one small endpoint

`POST /classes/:id/labs/:labId/groups/:groupId/unlink-repo`, teacher-gated
like `deleteGroup`:

- Re-verify with `getOrgRepo` at click time — don't trust a stale
  client-side `repoStatus` to null out a possibly-working link.
- **Still 404** → set `ghRepoId = null`, `ghRepoFullName = null`, return 200.
- **Now resolves** (edge case: someone recreated a repo with the same name
  between page load and click) → return `409 { error: "still_exists" }`;
  frontend just re-fetches and re-renders normally.

### 4. Tests

- **API** (`apps/api/test/lab-groups.test.ts`): `repoStatus` is `"missing"`
  when a group's `repoFullName` isn't in `orgRepoActivity`'s result and a
  follow-up `getOrgRepo` 404s; stays `"ok"` on a rename (and
  `ghRepoFullName` is healed); stays `"ok"` (not misreported) when the
  activity fetch itself throws.
- **API** (`apps/api/test/groups.test.ts`): `unlink-repo` clears both
  columns on a confirmed-404 repo; returns `409 still_exists` when the repo
  is still there; teacher-only (403/404 for non-teachers, matching
  `deleteGroup`'s existing gate).
- **www**: badge renders only when `repoStatus === "missing"`; popover's
  Unlink is hidden for students; after Unlink succeeds, Delete-group and
  Create-repo buttons reappear (i.e. the tile re-renders as a normal
  unlinked group).

## Explicitly out of scope

- No webhook/GitHub-event-driven detection — stays consistent with the
  rest of the app's poll-on-visit model (`GITHUB_APP_SETUP.md:104-109`).
- No auto-delete of the group or auto-create of a replacement repo — the
  teacher always makes the call via the existing buttons; Unlink only
  removes the stale pointer.
- No change to `apps/api/src/lib/reconcile/work-repos.ts` — this path
  covers the case on every page visit, which is faster than a manual
  reconcile pass would be; the reconciler's "repos are never deleted"
  comment can be revisited separately if it starts being cited elsewhere.

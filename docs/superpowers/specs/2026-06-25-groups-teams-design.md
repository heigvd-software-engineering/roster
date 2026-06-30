# Groups & Teams — design reference

**Date:** 2026-06-25
**Project:** `labs`
**Relates to:** `2026-06-25-foundation-identity-design.md` (S3 Groups),
`2026-06-25-data-model.md`

How groups map to GitHub, and the GitHub mechanics the app relies on.

---

## 1. Groups are GitHub Teams

A student group **is a GitHub Team**, the same mechanism GitHub Classroom uses
for group assignments. A group is **reusable** — the same team can be granted a
repo for several labs (one repo per lab). The mapping:

| Group concept | GitHub Team |
|---|---|
| Join a group if not full | Join the team if under the lab's **max** (**Labs-enforced** — GitHub has no size cap) |
| Create a group | Create a team |
| The group's student lab repo | The team is granted the repo |
| Min / max members | **Labs-enforced** at join time against the team's current size (GitHub Teams have no native min/max) |
| Creator removes a member | Team membership change |
| Member leaves | Remove self from the team |

**Membership persists in the team** — the team's member list *is* the group
roster. The app reads the team to render the group and writes via the team API
on join/leave/remove.

Students are always added with role **`member`** (never `maintainer`), so only
Labs (via the installation token) and org **Owners** (teachers) can manage team
membership. A **solo lab** is simply a group of one (a team with one member).

The app's DB holds only what a team can't express: the group's class, creator,
and team id/slug (`groups` table); the **group↔lab links** (`student_lab_repos`,
many-to-many); and per-lab **min/max** (`labs`).

---

## 2. Team lifecycle (GitHub API)

The app performs the full lifecycle with an installation token.

| Operation | API |
|---|---|
| Create team | `POST /orgs/{org}/teams` — `name`, `privacy: secret` |
| Add / remove member | `PUT` / `DELETE /orgs/{org}/teams/{slug}/memberships/{username}` (students always role `member`) |
| Grant team repo access | `PUT /orgs/{org}/teams/{slug}/repos/{owner}/{repo}` `{ permission: "push" }` |
| Delete team | `DELETE /orgs/{org}/teams/{slug}` |

Constraints:

- **Team slugs are unique org-wide.** The app **generates collision-safe slugs**
  and stores them.
- Teams are created **`secret`** so non-members can't discover or request to join
  out of band; the roster is managed only through Labs and by org Owners.
- Restricting org-wide *team creation* to Owners is **not API-settable** (web-UI
  only), so Labs does **not** rely on it: isolation holds anyway because base
  permission is `No access`, repos are private, and only Labs ever grants a team
  repo access — a stray member-created team grants access to nothing.

---

## 3. GitHub App permissions

- **Organization → Members: Read & Write** — create/delete/edit teams,
  manage team membership, read Owner/Member roles, and **invite students to the
  org** on enrollment (`PUT /orgs/{org}/memberships/{username}` — the student then
  accepts on GitHub's native page).
- **Organization → Administration: Read & Write** — read and set the org base
  repository permission (`No access`) on connect (`PATCH /orgs/{org}`).
- **Repository → Administration: Read & Write** — grant a team access to a repo
  and create repos (from a template via `/generate`, or empty via
  `POST /orgs/{org}/repos`).

---

## 4. Staying in sync — reconcile on read

Labs subscribes to **only the `installation` webhook** (class lifecycle). Team and
membership changes are **not** webhook-driven: because the roster is read live from
the team on every render, there is nothing cached to keep in sync.

Instead Labs **reconciles on read**. When it fetches a team and finds drift, it
surfaces the mismatch and reconciles the thin `groups` row:

- team **deleted** on GitHub (`404`) → mark the group orphaned / offer cleanup;
- team **renamed** → refresh the cached `name`;
- current size **violates a lab's min/max** → flag at the relevant action (also
  enforced by Labs at join time).

Optional short-TTL caching may smooth API usage, but it is a cache, **not** a sync
authority — GitHub remains the source of truth, read live.

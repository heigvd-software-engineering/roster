# Data Model — current state

**Date:** 2026-06-25
**Project:** `labs`
**Relates to:** `2026-06-25-foundation-identity-design.md`,
`2026-06-25-groups-teams-design.md`

The schema. It separates the **Slice 1 tables (Better Auth)** from the
**app tables** owned by later slices, and lists what we **do not store** because
GitHub owns it.

> ORM: **Drizzle + Cloudflare D1 (SQLite)**, one schema in `packages/db`.
> Better Auth tables are generated via `@better-auth/cli generate` and then owned
> in-repo. App tables are hand-written.

---

## 0. Guiding principle — delegate to GitHub

We store only what GitHub can't express. Anything GitHub already models is read
live (or cached thinly and reconciled via webhook), never treated as our own
authority.

| Concept | Authority | We store? |
|---|---|---|
| Teacher vs student | GitHub org **Owner / Member** | ❌ read live |
| Class existence | GitHub **App installation** | ⚠️ thin anchor row (cache), keyed on stable `orgId` |
| Org members / repos | GitHub | ❌ read live (teacher views) |
| **Student's own enrollment** | GitHub org membership | ⚠️ **display cache** in `class_members` — written at observation points, lazily repaired, **never authorization** (see §2) |
| **Group membership** | GitHub **Team** membership | ❌ lives in the team |
| Repo access / permissions | GitHub | ❌ set via API, not stored |
| GitHub user tokens | — | ✅ in Better Auth `account` |
| Lab definition, group↔team link, student lab repo records | — (no GitHub equivalent) | ✅ app tables |

---

## 1. Slice 1 — Better Auth tables (concrete)

Generated + owned in-repo. We do **not** add custom user fields in Slice 1.
(Columns below are the relevant Better Auth defaults; exact set comes from the
generator.)

### `user`
| column | type | notes |
|---|---|---|
| `id` | text, pk | |
| `name` | text | from edu-ID claims |
| `email` | text, unique | |
| `emailVerified` | boolean | |
| `image` | text, null | |
| `createdAt` / `updatedAt` | timestamp | |

### `session`
| column | type | notes |
|---|---|---|
| `id` | text, pk | |
| `userId` | text, fk → `user.id` | |
| `token` | text, unique | session token (first-party cookie) |
| `expiresAt` | timestamp | |
| `ipAddress` / `userAgent` | text, null | |
| `createdAt` / `updatedAt` | timestamp | |

### `account` — one row per linked provider (edu-ID + GitHub)
| column | type | notes |
|---|---|---|
| `id` | text, pk | |
| `userId` | text, fk → `user.id` | |
| `providerId` | text | e.g. `eduid` (generic OIDC) / `github` |
| `accountId` | text | provider's user id — edu-ID `sub` / GitHub user id |
| `accessToken` | text, null | **GitHub token lives here** |
| `refreshToken` | text, null | |
| `accessTokenExpiresAt` | timestamp, null | |
| `scope` | text, null | e.g. `read:org` |
| `idToken` | text, null | |
| `createdAt` / `updatedAt` | timestamp | |

> **"GitHub linked?"** = a row exists with `providerId = 'github'` for the user.
> No custom field, no `/api/me` — read via Better Auth's `listAccounts()`.

### `verification`
Better Auth's verification table (id, identifier, value, expiresAt, timestamps).
Present by default; minimal use with OAuth/OIDC-only providers.

**Slice 1 stops here — no app-domain tables.**

---

## 2. App tables (later slices)

All key on **stable GitHub ids** where a GitHub object is involved. App table
names are **plural** (`classes`, `labs`, `groups`, `student_lab_repos`), which
also sidesteps the SQL reserved words `class`/`group`; the Better Auth tables
keep the library's singular names.

### `classes` (S2) — thin anchor to an App installation
| column | type | notes |
|---|---|---|
| `id` | text, pk | our id |
| `orgId` | integer, **unique** | **stable** GitHub org (account) id — the real key |
| `installationId` | integer | refreshable — **changes on reinstall** |
| `connectedByUserId` | text, fk → `user.id` | who connected it |
| `joinToken` | text, unique | the class **join link** token (`/join/{joinToken}`); **regenerable** to revoke the old link |
| `status` | text | `active` / `archived` (on uninstall) |
| `createdAt` / `updatedAt` | timestamp | |

> Existence is owned by GitHub; this row is a cache + anchor for app data,
> maintained via the **`installation`** webhook. Name, avatar, login, members,
> and the teacher/student split are all **read live from GitHub** each visit —
> none stored. *(Optional, for the student list to reach zero GitHub calls:
> cache `login`/`name`/`avatarUrl` on this row, refreshed whenever `orgInfo`
> is fetched on a teacher path.)*

### `class_members` (S5 — student class list) — enrollment display cache
| column | type | notes |
|---|---|---|
| `id` | text, pk | |
| `classId` | text, fk → `classes.id` | |
| `githubId` | text | GitHub **user** account id — matches `account.accountId`; resolve to an app user via the `account` table, never stored as `userId` (webhook/API payloads and `orgPeople` carry GitHub ids, not app ids) |
| `state` | text | `pending` (invited) / `active` (member) |
| `createdAt` / `updatedAt` | timestamp | |

Unique on `(classId, githubId)`.

> **A cache of what GitHub owns, not an authority** — the deliberate exception
> to §0, accepted so the student's class list is a pure DB read (zero GitHub
> calls) instead of a per-visit membership sweep. Rules that keep it honest:
>
> - **Write points** (everywhere the app already observes membership, for free):
>   - `requestJoin` after inviting → upsert `pending`;
>   - `previewJoin` seeing an `active` membership → upsert `active` (the common
>     path: the student lands back on the join page after accepting);
>   - the teacher hub's `orgPeople` fetch → **full-roster sync** for that class
>     (upsert `active` students, upsert `pending` invitees, delete rows whose
>     github id is no longer on the roster) — this is the reconciliation that
>     catches everything the join flow missed, refreshed every teacher visit.
> - **Lazy repair**: any GitHub call that reveals non-membership (404/403 on an
>   action against the org) deletes the row.
> - **Invariant — display only.** No endpoint may use `class_members` to
>   authorize a privileged action; anything that grants or touches GitHub
>   resources verifies against GitHub (or simply acts via an installation/user
>   token and lets GitHub refuse). A stale row may show a dead class card;
>   it must never grant access.
> - **No webhooks required.** Accepted drift: a removed student sees a stale
>   card until lazy repair or the next teacher visit; a student who accepted
>   off-platform and never revisits any observation point stays invisible until
>   the teacher's roster sync. Both self-heal; neither affects access control.
> - The student list endpoint reads `class_members ⋈ classes ⋈ labs` for the
>   caller's github id (via their `account` row) — no GitHub traffic.
>
> The student-owned-repos proposal (`2026-07-05-student-owned-repos.md` §4)
> later **promotes** this table from cache to authority (join inserts directly;
> org invites disappear). Same table, hardened semantics — the `state` column
> collapses to `active`-only in that model.

### `labs` (S4)
| column | type | notes |
|---|---|---|
| `id` | text, pk | |
| `classId` | text, fk → `classes.id` | |
| `title` | text | |
| `templateRepoId` | integer, null | source repo; the app ensures it's marked a GitHub template (`is_template`) so `/generate` works. **Optional** — when null, accept creates an **empty** repo (`POST /orgs/{org}/repos`) instead |
| `templateRepoFullName` | text, null | cache for display |
| `deadline` | timestamp | **required**; controls timing; lab is visible on create |
| `groupMode` | text | `individual` (a group of one, min=max=1) \| `group` |
| `minMembers` / `maxMembers` | integer, null | group labs only |
| `createdByUserId` | text, fk → `user.id` | |
| `createdAt` / `updatedAt` | timestamp | |

> Single published state (visible on creation) — no draft/send. Enforcement of
> min/max happens at join time against the team's current size.

### `groups` (S3) — reusable team link row (membership NOT stored here)
| column | type | notes |
|---|---|---|
| `id` | text, pk | |
| `classId` | text, fk → `classes.id` | a group is **class-scoped and reusable** |
| `ghTeamId` | integer, unique | the GitHub Team (membership lives there) |
| `ghTeamSlug` | text | DB-generated, collision-safe slug |
| `name` | text | display name |
| `creatorUserId` | text, fk → `user.id` | powers "**creator or a teacher (org Owner)** can remove / delete" |
| `createdAt` / `updatedAt` | timestamp | |

> A group is **reusable**: it links to **many labs** via `student_lab_repos`
> (groups ↔ labs is many-to-many). Its **roster is the team's membership** — read
> live, written via the team API on join/leave/remove; **reconciled on read** (drift
> surfaced as a mismatch — no `team`/`membership` webhooks). A **solo lab** is a
> group of one (a team with one member).

### `student_lab_repos` (S4) — a group's repo for a lab (solo = group of one)
| column | type | notes |
|---|---|---|
| `id` | text, pk | |
| `labId` | text, fk → `labs.id` | |
| `groupId` | text, fk → `groups.id` | **the group↔lab link** — every lab uses a group (a solo lab is a group of one) |
| `ghRepoId` | integer, unique | repo created via `/generate` (template) or `POST /orgs/{org}/repos` (empty, no template) |
| `ghRepoFullName` | text | for display / direct link |
| `createdAt` | timestamp | |

> Unique on `(labId, groupId)`. This row **links a group to a lab** (many-to-many)
> and holds that pairing's repo. **Invariant:** a student is in at most **one
> participating group per lab**. Anchors the teacher dashboard (otherwise a live
> aggregation over GitHub).

---

## 3. Relationships

```
user 1───* session
user 1───* account            (eduid + github)
user 1───* classes            (connectedBy)
classes 1───* class_members   (enrollment display cache; github id → user via account)
classes 1───* labs
classes 1───* groups          (reusable teams)
user  1───* groups            (creator)
labs *───* groups             via student_lab_repos (many-to-many)
labs 1───* student_lab_repos
groups 1───* student_lab_repos (every lab uses a group; solo = group of one)
```

Not modeled in our DB (delegated): org membership as **authority**
(Owner/Member — `class_members` is only a display cache of it),
**team membership** (= group roster), repo collaborators/permissions.

---

## 4. Keying rules (to avoid orphaning)

- **A class keys on `orgId`** (stable), never `installationId` (changes on
  reinstall).
- GitHub-backed rows store the GitHub object's **numeric id** as the stable key
  and cache the human-readable login/slug/name separately (these can change).
- Slugs we create (team slugs) are **generated and owned by us**, collision-safe
  org-wide.

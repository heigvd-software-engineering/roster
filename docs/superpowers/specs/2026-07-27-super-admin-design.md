# Super admin: restrict class creation to designated users

**Date:** 2026-07-27
**Branch:** `feat/super-admin`
**Status:** Approved

## Problem

Any signed-in user with a linked GitHub account can create a class today —
"connect a class" installs the GitHub App on an org and the setup callback
births the class row, no questions asked. For real use the school needs to
decide **who** may create classes.

What we want: a **class creator** capability — deliberately not called
"teacher", because `class_members.state = "teacher"` already means *teacher
of one class* (org-scoped) and reusing the word would make it mean two
things. Class creation is the **only** thing gated; everything a user
already has (their classes, enrollments, group membership) is untouched.

Granting is done by a **super admin** from a small admin zone reached
through the account menu. Super admins are not stored in the database:
they are exactly the users whose email appears in a config variable —
which also solves first-admin bootstrap (add an email, redeploy).

## Design

### 1. Data model

- New app-owned table `class_creators` in `packages/db/src/app-schema.ts`
  (the auth schema stays a pure Better Auth CLI artifact):
  - `userId` — text, **primary key**, references `user.id`;
  - `createdAt` — timestamp, not null.
- **Row presence is the capability.** Grant = insert (idempotent upsert),
  revoke = delete. No boolean column, no state to drift.
- Migration name: `class_creators`.

### 2. Super admin identity (config, not data)

- New public var `SUPER_ADMIN_EMAILS` in `apps/api/wrangler.jsonc` `vars`
  (and `wrangler.demo.jsonc`; `.dev.vars` overrides it locally): a
  comma-separated list of edu-ID emails. Emails are not secrets — this
  sits next to `GITHUB_APP_SLUG`, and the Worker env stays the single
  configuration surface.
- One helper, `isSuperAdmin(env, email)` in `apps/api/src/lib/auth/`:
  case-insensitive membership of `user.email` in the list, tolerant of
  whitespace. Empty/unset var = **no super admins**: nobody can grant, and
  if `class_creators` is also empty, nobody can create classes at all —
  deployments must set the var (deliberate: fail closed, not open).
- The create capability is the `class_creators` row, **one condition for
  everyone** — super admins hold no implicit grant and flip their own
  toggle in the zone like anyone else. Super admin = access to the zone
  and managing grants, nothing more; it is config-only, never grantable
  from the app.

### 3. API

- `/api/me` (the boot fetch) gains two booleans: `isSuperAdmin` and
  `canCreateClasses`. The SPA learns everything it needs in the request
  it already makes.
- New handler group `apps/api/src/handlers/admin.ts`, mounted at
  `/api/admin`, entirely behind a `requireSuperAdmin` guard (403 for
  non-admins, 401 for no session):
  - `GET /api/admin/users` — every `user` row (id, name, email,
    createdAt) with `canCreateClasses` (the grant row — exactly what
    the gate checks) and `isSuperAdmin` (config status, shown as a
    display-only badge; the toggle stays live for admins too).
    School-scale data: no pagination; keyword filtering is client-side.
  - `PUT /api/admin/users/:id/class-creator` body `{ enabled: boolean }`
    — idempotent insert/delete; 404 for an unknown user id. PUT because
    the request states the desired end state.

### 4. Enforcement (the API is the boundary)

- The real gate is in `/api/github/setup`: when the callback would
  **create a new class row** and the caller lacks `canCreateClasses`,
  no row is born — redirect to the connect-failed page with a new
  reason (`not_class_creator`), which explains that class creation is
  restricted and names no remedy beyond "contact an administrator".
- The **reconfigure path of an existing class stays open** — a revoked
  creator keeps managing the classes they already have; revocation only
  stops future creation. No retroactive effect of any kind.
- UI courtesy on top: the classes hub hides the "New class" action
  unless `me.canCreateClasses`. (Hidden, not disabled — a user who
  cannot create has nothing to configure.)

### 5. Admin zone UI

- "Super admin" item in the account menu (`MainSwitchIdentity`),
  rendered only when `me.isSuperAdmin`, navigating to a new lazy `/admin`
  route. The route itself also checks `me.isSuperAdmin` and bounces
  non-admins to `/classes` — the menu link is convenience, the API
  guard is the security.
- The page: a heading, a search input, and the user list. Search
  filters client-side on name + email as you type. Each row shows the
  user's identity (initials avatar, name, email — the existing
  `UserIdentity` component) and a switch labelled "Can create classes".
  Toggling calls the PUT and updates the row on success.
- Visual design is worked out incrementally at build time, per the
  project's usual approach (shadcn + Tailwind, named wrappers).

### 6. Testing

Written after the feature is validated by hand, per working mode:

- **API** (`apps/api/test/admin.test.ts` + a `setup.test.ts` addition):
  guard answers 401/403 correctly; list includes the join correctly;
  PUT is idempotent both ways and 404s unknown users; setup callback
  refuses a new class for a non-creator, allows it for a creator/admin,
  and still allows reconfigure of an existing class for anyone.
- **Frontend**: menu shows the Super admin item only for admins; /admin
  filters and toggles; classes hub hides "New class" without the
  capability.

## Out of scope

- Storing super admins in the database, or granting super admin from
  the UI (config-only, by decision).
- Pagination/virtualization of the user list.
- Any change to per-class teacher/student roles or existing classes.
- Audit trail of grants beyond `class_creators.createdAt`.

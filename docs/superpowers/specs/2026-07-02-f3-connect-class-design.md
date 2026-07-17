# F3 — Teacher connects a class (design)

**Date:** 2026-07-02 · **Status:** approved (design) · **Feature:** F3 of the
labs implementation plan.

## Goal

A teacher connects a **GitHub organization they own** as a "class". Connecting =
**installing the labs GitHub App** on that org. On the install callback the app
records a thin `classes` row keyed on the stable `orgId`, then sets the org's
**base repository permission to "No access"** and verifies it. Nothing about the
org is stored beyond the anchor row — name, avatar, and members are read live.

**Feature outcome:** signed-in user clicks "Connect a GitHub organization" →
installs the App on an org → lands on a confirm page → the app sets base
permission to "No access" → the class appears in their list (live org name +
avatar). Viewing people (F5), the join link (F4), and labs (F6) are out of scope.

## Prerequisite (manual, one-time) — GitHub App reconfiguration

The existing App currently only does **user auth** (user-to-server OAuth). Before
F3 works, in the App settings (github.com/settings/apps/<app>):

- **Organization permissions:** `Administration: Read & write` (to `PATCH` the
  org base permission). Add `Members: Read & write` too (needed by F4 enrollment)
  to avoid a second reconfigure — but F3 only exercises Administration.
- **Where can this App be installed:** allow installation on organizations
  (public/"Any account" for real teachers later; for F3 the owner installs on
  their own org).
- **Setup URL:** `https://localhost:3000/api/github/setup` (dev), "Redirect on
  update" on. This is the install callback.
- **Secrets** (Worker secrets, `apps/api/.dev.vars`): `GITHUB_APP_ID`,
  `GITHUB_APP_PRIVATE_KEY` (the PEM). The existing `GITHUB_CLIENT_ID` /
  `GITHUB_CLIENT_SECRET` (user OAuth) are unchanged.

No `installation` webhook is configured in F3 (see Scope).

## Scope

**In:** connect happy-path — install → callback creates the `classes` row →
confirm page → set base permission "No access" + verify → list connected classes
(live org name/avatar). Introduces the server-to-server **Octokit App** client,
the typed **`hc<AppType>`** client on the frontend (first app-data read), and the
**`requireAuth`** middleware (first protected data endpoints).

**Out / deferred:**

- The **`installation` webhook** (uninstall → `status: archived`, reinstall →
  refresh `installationId`). Handled instead by **reconcile-on-read**: when
  listing classes we read `GET /user/installations` and refresh a stale
  `installationId` / drop orgs no longer installed. A real-time webhook is a
  later slice.
- `joinToken` + enrollment (F4), people view (F5), labs (F6+).

## Schema — `packages/db`, table `classes`

App-domain table, **plural** name. Minimal columns only:

| column | type | notes |
|---|---|---|
| `id` | text, pk | our id |
| `orgId` | integer, **unique** | stable GitHub org account id — the real key |
| `installationId` | integer | refreshable (changes on reinstall) |
| `connectedByUserId` | text, fk → `user.id` | who connected it |
| `status` | text | `active` / `archived` — F3 only ever writes `active` |
| `createdAt` / `updatedAt` | integer timestamp | |

**No `joinToken`** (F4). Added to the hand-owned barrel `schema.ts` (not the
CLI-generated `auth-schema.ts`); migration via `drizzle-kit generate`.

## Server (`apps/api`)

### Octokit App client

- Add `@octokit/app` (latest, tooling-driven). Cloudflare Workers-compatible
  (JWT signing via Web Crypto).
- `createAppClient(env)` → an `App` from `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY`.
- Helpers: `getInstallationOctokit(installationId)` (installation token) and an
  app-JWT client for `GET /app/installations/{id}`.

### `requireAuth` middleware + `AuthedEnv`

Per the plan's decided approach: a Hono middleware that loads the Better Auth
session and sets `c.get("user")` (typed, non-null; 401 otherwise). Applied
per-route on the protected class endpoints. `/api/me` stays session-optional.

### Routes

- **`GET /api/github/setup`** — the App **Setup URL** callback. Query:
  `installation_id`, `setup_action`, `state`. Steps: (1) require the signed-in
  user (session cookie, same origin); (2) app-JWT `GET /app/installations/{id}`
  → `account.id` (orgId), `account.login`, `account.type` (must be
  `Organization`); (3) **upsert** `classes` on `orgId`
  (`installationId`, `connectedByUserId = user.id`, `status: "active"`);
  (4) redirect to `/classes/{id}/confirm`. Idempotent on re-install.
- **`POST /api/classes/:id/confirm`** (`requireAuth`) — with an installation
  token, `PATCH /orgs/{login}` `{ default_repository_permission: "none" }`, then
  re-`GET /orgs/{login}` and assert it is `none`. Returns `{ ok, org }`.
- **`GET /api/classes`** (`requireAuth`) — the caller's connected classes:
  read `GET /user/installations` (user token), intersect with our rows,
  **reconcile** stale `installationId`, and enrich each with **live**
  `{ login, name, avatarUrl }` (installation token). Response type inferred via
  `hc<AppType>` — no hand-written shape.

`AppType` grows to include these routes; secrets never returned to the client.

## Frontend (`apps/www`)

- **Typed API client:** introduce `hc<AppType>` reads for `GET /api/classes`
  (the existing `~/lib/api` `useApi` hook already supports this).
- **Home** (`home-page.tsx`): replace the placeholder body with
  - a **"Connect a GitHub organization"** button → navigates to the App install
    URL `https://github.com/apps/{slug}/installations/new?state={csrf}`;
  - a **list of connected classes** (live org avatar + name), empty-state when
    none.
- **Confirm page** (`/classes/:id/confirm`): "Connecting **{org}** — labs will
  set its base permission to **No access** so only granted repos are visible."
  → primary button calls `POST /api/classes/:id/confirm`; on success routes home
  with the class active; on failure shows the error (e.g. missing permission).
- Reuse the existing layout primitives + typography; a class row is a small
  named component (org avatar + name), consistent with the styling convention.

## Cross-cutting

- **Least privilege:** all org writes/reads-of-private use the **installation
  token**; the user token is only used for `GET /user/installations`.
- **Reconcile-on-read** keeps `installationId` fresh without a webhook.
- **Same-origin:** the Setup URL callback relies on the first-party session
  cookie to attribute `connectedByUserId`; `state` guards CSRF on the install
  kickoff.
- **Secrets** are Worker secrets; the App private key never leaves the server.

## Error handling

- Setup callback with no session → redirect to login (then back).
- Installation account not an `Organization` (personal) → reject with a clear
  message; do not create a row.
- `PATCH /orgs` 403 (App lacks Administration) → confirm page surfaces
  "the App is missing the Organization Administration permission" (points at the
  prerequisite).
- Re-verify mismatch → confirm returns not-ok and the page shows the error +
  a retry button. **No stored "confirmed" flag** (not in the minimal schema) —
  the org's base permission is GitHub-owned and read live when it matters; the
  `classes` row simply exists (`active`) once installed.

## Testing

- **Real tests (our logic):** `classes` query helpers + the unique-`orgId`
  constraint; the setup-upsert and confirm-verify route behavior with a **mocked
  Octokit** (no live GitHub in unit tests).
- **No tests** for the CLI-generated schema or pure passthroughs.
- **Human 🔴 gate:** live walk — reconfigure the App, install it on a real test
  org, confirm the `classes` row is written, the base permission flips to "No
  access", and the class lists with live name/avatar.

## Open decisions (defaulted; revisit if needed)

- Webhook **deferred** (reconcile-on-read) — chosen for a minimal F3.
- Connect entry point on the **home** page (no separate teacher dashboard yet —
  that's F10).
- `hc<AppType>` client + `requireAuth` middleware **land in F3** (first need).

## Post-review decisions (2026-07-02)

- The spec's `state` CSRF param on the install kickoff is **superseded** by a
  server-side installation-ownership check in the setup callback: before
  upserting, the callback fetches the signed-in user's own `GET
  /user/installations` (with their linked GitHub token) and requires the
  callback's `installation_id` to be among them. This is **stronger** than a
  `state` CSRF token — it binds the callback's caller directly to the
  installation being claimed, rather than merely proving the install kickoff
  and callback are the same browser session.
- On an `orgId` conflict, the upsert **keeps the first connector**
  (`connectedByUserId` is not overwritten on re-install by a different user).
  `connectedByUserId` is **provenance** (who connected the class), not an
  access-control list — multi-teacher visibility/access to the same class is
  deferred to **F5** (people/roles).

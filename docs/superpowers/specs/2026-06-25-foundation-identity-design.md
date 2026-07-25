# Foundation & Identity — Design Spec

**Date:** 2026-06-25
**Status:** Awaiting review
**Project:** `labs` — HEIG-VD GitHub Classroom replacement
**Repo:** private `heigvd-software-engineering/labs`
**Slice:** 1 of the roadmap

---

## 1. Context & Goal

`labs` is HEIG-VD's in-house replacement for GitHub Classroom. North star:
**zero-friction UX** — minimum actions per task, simple and delightful.

- Identity is **SWITCH edu-ID** (OIDC).
- Each user links a **personal GitHub account** so the app can act on GitHub
  repositories on their behalf.
- The **class** is a GitHub **organization** (the teaching unit); the app adds
  the structure GitHub lacks (groups, organized views).

**Guiding principle — delegate to GitHub.** Whatever GitHub models (org
membership, team membership, repo access, templates) is read live or mirrored,
never duplicated as our own authority. Our DB stores only what GitHub can't
express.

**Slice 1** delivers the foundation: project scaffold, edu-ID login, mandatory
GitHub linking, and the end-to-end type-safety architecture every later slice
builds on.

---

## 2. Architecture decisions

| Area | Decision |
|---|---|
| Identity provider | **SWITCH edu-ID** (OIDC). Dev uses edu-ID's **test/integration IdP**. |
| Auth library | **Better Auth** (MIT) — a library running inside our Hono API on Workers, data in our D1. |
| GitHub backbone | **A single GitHub App**, installed on each class org. Installation tokens (Octokit) for org/repo ops; the App's user-authorization for account linking. |
| Org provisioning | The teacher installs the App on an org **they own**; the app never creates orgs via API. |
| Dedicated org per class | The org is **created explicitly for the class** — no reuse of existing/populated orgs, whose content and base-permission settings would conflict with student isolation. *(A future multi-class setup may reconsider reusing existing course orgs.)* |
| Class | A **GitHub organization** — the teaching unit. GitHub owns its existence (= an App installation); the app keeps a thin row keyed on the stable **`orgId`** (`installationId` is a refreshable attribute). Per-teacher list via **`GET /user/installations`**; a **connect-confirm** step verifies base permission; **`installation` webhooks** drive lifecycle. Org name/avatar/members read live each visit — no stored or editable name. |
| GitHub linking | **Mandatory at first login.** Every account has a linked GitHub identity. |
| Global roles | **None.** A logged-in user is just a user; capability derives from GitHub org membership (Owner/Member) and org ownership for class creation. |
| Teacher vs student | Org **Owner = teacher**, **Member = student**, read live from GitHub. |
| Student enrollment | **One durable class join link.** Opening it makes Labs create an org-membership invite (installation token, `PUT /orgs/{org}/memberships`), then redirect to GitHub's **native accept page** (`/orgs/{org}/invitation`). No per-student teacher action; **user scope stays `read:org`** (GitHub can't force-join — the student consents natively). Every enrolled student is an org **Member** (required: team members must be org members). |
| Repo isolation | **So a student sees only their own repo, never the solution or a classmate's** (teachers see all as Owners): org **base permission = `No access`** — the app sets it on connect (`PATCH /orgs/{org}`); all repos **private**; access **per repo via the group team**; never `internal`. |
| Groups | A student group **is a GitHub Team** — team membership is the group's persistence; the app grants that team a **student lab repo per lab** it's used on (one repo per lab). A **solo lab** is a group of one. |
| Student lab repo | The repo a group works in (a **solo lab is a group of one**) — created by GitHub **native template generation** (`POST /repos/{tmpl}/generate`) when the lab has a template, or as an **empty repo** (`POST /orgs/{org}/repos`) when it has none; always `private`. |
| Sessions | **Better Auth**, **first-party** cookie (same-origin). |
| Hosting / origin | **Cloudflare.** One Worker serves the SPA static assets **and** `/api/*` (static-assets binding + Hono) → same-origin, first-party cookies. D1 now, R2 later. |
| Type safety | **End-to-end, no codegen.** Drizzle `$infer*` (entities) → zod **inputs** + enums in `packages/types` → **Hono RPC** client (`hc<AppType>`); response types **inferred**. A schema change breaks frontend `typecheck`. |
| Database / ORM | **Drizzle + Cloudflare D1**, schema in `packages/db`. |

### Roadmap

1. **Foundation & Identity** — this spec
2. **Class** — connect an org; **students self-enroll via the class join link**; display teachers (Owners) / students (Members) read live
3. **Groups** — **reusable** student groups as GitHub Teams (create, invite-grid, join, leave, remove, delete); one team usable across many labs
4. **Labs** — optional template + deadline + group settings; accept ⇒ student lab repo; group labs reuse / join / create a group
5. **Teacher dashboard** — organized aggregation view over GitHub (repos/teams) + lab metadata

---

## 3. User flows

Tagged by the slice that owns each. Written to the zero-friction bar.

### 3.1 First-time sign-in & onboarding (S1)

1. User clicks **Sign in with SWITCH edu-ID**.
2. edu-ID authenticates; Better Auth creates the `user` from standard OIDC
   claims (name, email) and keeps the edu-ID `sub` in its `account` table.
3. With no GitHub account linked, the route guard sends them to
   **`/onboarding/github`**.
4. User clicks **Link your GitHub account** → GitHub authorizes → Better Auth
   stores the `github` `account` (tokens, `read:org`).
5. Onboarding complete → authed **home**.

### 3.2 Returning sign-in (S1)

1. **Sign in with SWITCH edu-ID** → Better Auth matches the existing `user`.
2. GitHub already linked → straight to **home**.

### 3.3 Sign out (S1)

1. **Sign out** → Better Auth clears the session → login screen.

### 3.4 Teacher — connect a class (S2)

1. Teacher clicks **New class → Connect a GitHub organization** (a dedicated org
   they own, created for this class).
2. App sends them to install the **GitHub App** on that org (only owners can
   install — self-gating).
3. On the install callback, the app records a thin class row keyed on the
   org id.
4. App shows a short **confirm page**, then **sets the org base permission to
   `No access`** itself (`PATCH /orgs/{org}`) and re-verifies — no manual GitHub
   settings work for the teacher. The class is then ready.

### 3.5 Teacher — share the class join link (S2)

- Each class has one **durable join link** (`/join/{joinToken}`). The teacher
  **copies it once** and shares it with the cohort (LMS, course page) — the only
  per-cohort enrollment action. **Regenerating** the link revokes the old one.

### 3.6 Teacher — view the class's people (S2)

- The app **reads org membership live** and displays it split by type —
  **students = Members**, **teachers = Owners** — and explains the rule.
- People are added/removed **on GitHub**; the app reads and displays.

### 3.7 Teacher — create a lab (S4)

1. **New lab:** pick an optional **template repository**, set a **deadline**, and
   **group settings** (individual, or group with min/max).
2. The lab is **visible to students on creation**; the **deadline** controls
   timing.

### 3.8 Student — join a class (S2)

1. Student opens the **class join link** (already signed in to Labs with GitHub
   linked — otherwise they sign in / link first, then continue).
2. Labs invites them to the org as a **Member** via the installation token
   (`PUT /orgs/{org}/memberships/{ghUsername}`) — GitHub can't force-join, so this
   is a **pending** invite — and **redirects to `github.com/orgs/{org}/invitation`**.
3. Student clicks **Join** on GitHub's native page → returns to Labs, now an org
   **Member** = **enrolled**. (No extra user scope — acceptance is native.)
4. **Idempotent:** an already-enrolled student just lands on **home**. There is
   **no public discovery** — joining always requires a link.

### 3.9 Student — home: browse classes & labs (S2–S4)

A **single page** is the student's hub.

- Lists the **classes** where the student is an org **Member** (read live). Each
  class is a **section**: org name + avatar (live), teachers (Owners).
- Under each class, its **labs** — each showing **title**, **deadline** (countdown),
  **mode** (individual/group), and the student's **standing**.
- **Standing:** not accepted → **Accept**; accepted → direct **repo link**, plus
  (group labs) the **group name + member avatars** (live from the team).
- **Accept** opens an **inline drawer/modal** over home (see 3.11) and closes back
  to the same page, where the lab row flips to its accepted state.
- **Empty states:** no classes → "Open the join link your teacher shared to join a
  class"; a class with no labs → "No labs published yet."

### 3.10 Student — groups (S3)

A group **is a reusable GitHub Team** in the class — the same group can be used
for **many group labs**. Team membership is the group's persistence.

- A student can **create a group** and **invite classmates** from a **grid of the
  class**; students already in a group for the lab in question are **greyed out**.
- The **creator** removes any member; **any member** leaves; the **creator or a
  teacher** deletes the group.
- Min/max come from the lab and are enforced against the team's current size.

### 3.11 Student — accept a lab (S4)

**Individual lab (a group of one):** student clicks **Accept** → the app creates
a **team of one**, generates their **student lab repo** (from the template, or an
**empty** repo if the lab has none), and grants the **team** access.

**Group lab:** the app minimizes friction by proposing, in order:

1. **Reuse a group** the student was in (same teammates), if it fits this lab's
   min/max — one click.
2. **Join an existing group** already on this lab that isn't full.
3. **Create a new group** and invite classmates (grid; greyed out = already in a
   group for this lab).

Once a group is set for the lab, the app **generates the group's student lab
repo** (from the template via `POST /repos/{tmpl}/generate`, or an **empty** repo
if the lab has none — one per group) and grants the **team** access; members who
join later inherit access via the team. Teachers see all as
Owners. The student gets a direct link to the repo.

### 3.12 Teacher — organized dashboard (S5)

- A read/aggregation view that joins GitHub (repos/teams/members) with our lab
  metadata to present templates, labs, groups, and student repos in an organized,
  filterable layout GitHub itself lacks.

---

## 4. Repo structure

```
labs/
  apps/
    www/        # React Router 7 SPA (ssr:false), Tailwind 4, shadcn;
                #   better-auth/react client + hono/client (hc<AppType>)
    api/        # Hono on Workers; serves SPA static assets + /api/* (same-origin);
                #   Better Auth at /api/auth/*; Drizzle+D1; Octokit (GitHub App);
                #   exports `AppType`
  packages/
    db/         # @roster/db — Drizzle schema (auth + app tables), drizzle config,
                #   migrations, query helpers, inferred entity types
    types/      # @roster/types — zod request-validation schemas + shared enums
                #   (response types come from Hono RPC inference)
  docs/superpowers/specs/
  package.json, pnpm-workspace.yaml, biome.json, tsconfig.base.json,
  lefthook.yml, .github/workflows/ci.yml
```

- Package scope: **`@roster/*`**.
- Tooling: pnpm workspaces, Biome (double quotes, semicolons, 2-space, 80 cols),
  Vitest, lefthook, Wrangler.
- The frontend app is **`apps/www`**, `ssr:false`, `~` alias to `app/`.
- The Worker serves the built SPA assets via the Cloudflare **static-assets
  binding** and runs Hono for `/api/*` — one origin, one deploy.

---

## 5. End-to-end type safety

The chain that makes "edit a model → frontend typecheck fails" hold:

1. **Entities** — `packages/db` exports Drizzle-inferred types:
   `type User = typeof user.$inferSelect`, `… $inferInsert`. Relation and
   partial-select queries infer exact result types at the call site.
2. **Inputs & enums** — `packages/types` holds **zod** schemas for request inputs
   (validated with `@hono/zod-validator`) and shared enums. Response shapes are
   **not authored here**.
3. **Transport** — `apps/api` exports `type AppType = typeof routes`; `apps/www`
   type-imports it and builds `const api = hc<AppType>(API_URL)`. Response types
   are inferred from each handler's `c.json(...)` (JSON-serialized — `Date` →
   `string`), tracing back to the Drizzle entities.

Rule: never re-declare a response shape by hand.

---

## 6. Auth with Better Auth

Mounted on Hono:

```ts
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
```

- **Adapter:** `drizzleAdapter(db, { provider: "sqlite" })` against D1.
- **edu-ID:** `genericOAuth` plugin — OIDC discovery (issuer), `clientId`/
  `clientSecret` (Worker secrets), scopes `openid profile email`. The sign-in
  method; dev uses edu-ID's test issuer.
- **GitHub linking:** GitHub configured with the **GitHub App's** OAuth client
  credentials — a link-only provider via account linking. Better Auth stores the
  GitHub `access_token`/`refresh_token` in its `account` table.
- **Account linking:** edu-ID (login) and GitHub (linked) attach to one `user`.
- **No custom user fields** — Better Auth's default `user` + `account` cover
  identity.
- **Same-origin:** SPA and API share one origin, so the session is a normal
  **first-party** cookie.

### Onboarding gate (mandatory GitHub linking)

- "Is GitHub linked?" is read from the Better Auth client (`listAccounts()` /
  `customSession`).
- **Route guard** (`apps/www`): authenticated **and** no linked GitHub **and**
  route ≠ onboarding → redirect to `/onboarding/github`, a single
  "Link your GitHub account" button calling
  `authClient.linkSocial({ provider: "github" })`.

### GitHub App (server-to-server)

`apps/api` sets up an **Octokit App** client (`appId` + `privateKey` as Worker
secrets) for installation tokens. The user link requests `read:org` so later
slices can read org role.

---

## 7. Data model (Slice 1)

Better Auth tables, generated via `@better-auth/cli generate` and owned in-repo:
`user` (default fields, no customs), `session`, `account` (holds the edu-ID `sub`
and GitHub tokens; a `github` row = GitHub linked), `verification`.

Full schema (including planned app tables) lives in `2026-06-25-data-model.md`.
No app-domain tables are part of Slice 1.

---

## 8. Frontend (`apps/www`)

Minimal shadcn UI, three states:

1. **Login** — one button: "Sign in with SWITCH edu-ID".
2. **Onboarding gate** — "Link your GitHub account".
3. **Authed shell** — top bar (name, GitHub login/avatar, sign-out); home
   placeholder.

`better-auth/react` `useSession` + `listAccounts` for state; a route-guard
component enforcing auth and the GitHub-linked invariant.

---

## 9. Security

- **GitHub tokens** live in Better Auth `account`; never returned to the client
  or logged. GitHub App private key, OAuth secret, and edu-ID secret are
  **Worker secrets**.
- **OAuth/OIDC CSRF + redirects** handled by Better Auth.
- **Least privilege:** the user link requests only `read:org` (+ profile/email);
  org-write powers belong to the App installation, not user tokens.
- **Cookies:** secure, httpOnly, **first-party** (`SameSite=Lax`).

---

## 10. Testing

- **API** (`@cloudflare/vitest-pool-workers`): edu-ID sign-in creates a `user`;
  GitHub link attaches an `account`; the client reports GitHub-linked correctly;
  unauthenticated link attempt rejected.
- **Types:** a deliberate schema change in `packages/db` fails `apps/www`
  `typecheck` — a CI step guards the chain.
- **Frontend** (`@testing-library/react`): route guard redirects
  authenticated-but-unlinked → onboarding; linked user reaches home.

---

## 11. Slice 1 scope boundary

Slice 1 ends at a deployable walking skeleton: **edu-ID login → mandatory GitHub
link → authed home**, same-origin on Cloudflare, type-safe end-to-end.

Owned by later slices: org connect & membership display, groups, labs, the
teacher dashboard.

Not in scope: bulk roster import (xlsx/GAPS) and app-driven org invitations.

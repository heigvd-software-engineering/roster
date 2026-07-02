# Labs Implementation Plan — feature-iterative

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. The **Progress Tracker** below is the source of truth for what's done — update it after each gate. **Do NOT commit** (see Working Mode).

**Goal:** Build `labs` (HEIG-VD's GitHub Classroom replacement) **one thin feature at a time**. Each milestone delivers a single user-visible feature with only the schema and code that feature needs — no speculative tables, columns, or abstractions.

**Architecture:** A pnpm monorepo. One Cloudflare Worker (`apps/api`, Hono) serves the React Router 7 SPA (`apps/www`) static assets **and** `/api/*` — same origin, first-party cookies. Better Auth (edu-ID OIDC, later GitHub linking) persists to Drizzle/D1. Types flow Drizzle `$infer*` → (zod inputs when a feature needs them) → Hono RPC client, no codegen. Domain state delegates to GitHub; the DB stores only what GitHub can't express, **and only once a feature requires it**.

**Tech Stack:** pnpm workspaces, TypeScript, Hono on Cloudflare Workers, Better Auth, Drizzle ORM + Cloudflare D1, Octokit (GitHub App), React Router 7 (SPA, `ssr:false`), Tailwind 4, shadcn/ui, Biome, Vitest (`@cloudflare/vitest-pool-workers` + `@testing-library/react`), lefthook, Wrangler.

## Working Mode (read first)

1. **Iterative & minimal.** A milestone is **one feature**. Implement the **smallest** schema + code that makes that feature work end-to-end. Do not pre-build the full data model, do not add columns/tables/types/UI a later feature will need — add them in the iteration that needs them. YAGNI is the governing rule here, above completeness.
2. **No commits.** Do **not** `git commit`, `git push`, amend, or tag. History is hidden for now; all work stays in the **working tree**. The user will decide when/how to commit (likely a squash) later. Each task ends at a *tested, green, uncommitted* increment — not a commit.
3. **Minimal also means deferring infra.** Things like `packages/types`, a CI type-safety guard, and the full three-state UI are **not** built until a feature needs them. They appear in the feature that first requires them, not up front.
4a. **UI/UX is a first-class citizen; eyeball every viewable change.** Reducing user friction (less manual work), organizing data clearly per view, and a deliberate look-and-feel are primary goals. UI is designed **incrementally per feature** (no big up-front UX spec) and **every viewable change triggers the 👁 Visual gate** below (run the dev server, review the real screen together, discuss, then approve). Stack: **shadcn/ui + Tailwind** (both required — shadcn is built on Tailwind; Tailwind does layout, shadcn does components). Primitive layer: **Base UI** (`base-nova` shadcn style), lucide icons, `~/` aliases — matching the sibling `monorepo` project.
4. **Tooling-driven setup — never hand-author from memory (deps, configs, AND schema).** My training has a cutoff, so typed versions and copied configs/schemas are stale or wrong. Always: install with `pnpm add <pkg>@latest`; **scaffold** projects with official tools (`pnpm create cloudflare@latest`, React Router's create, `pnpm create vite`, `shadcn init`); **generate** schemas with the project's own CLI (`@better-auth/cli generate` for the auth schema, `drizzle-kit` for migrations); consult official **docs** for config. **Then trim to the minimal footprint.** Any code/config/version block in this plan is a **trim-target to converge toward, NOT text to hand-copy.** After setup the automated gate must pass on the actually-installed latest; if a new major broke our code, adapt — don't downgrade.

## Global Constraints

Apply to every task.

- **Package scope:** `@labs/*`.
- **Biome style:** double quotes, semicolons, 2-space indent, 80-column width.
- **Type safety:** no codegen. Drizzle `$inferSelect`/`$inferInsert` for entities; zod for request **inputs** (only when a feature has inputs to validate); response types **inferred** via `hc<AppType>`. Never hand-declare a response shape.
- **Frontend:** `apps/www` is `ssr:false`; `~` alias → `app/`.
- **Same-origin:** SPA + API one origin; session cookie **secure, httpOnly, `SameSite=Lax`**.
- **Secrets are Worker secrets** (never in code/responses): edu-ID `clientSecret`, GitHub App `privateKey`, GitHub App OAuth `clientSecret`.
- **DB naming:** app-domain tables **plural** (`classes`, `labs`, `groups`, `student_lab_repos`); Better Auth tables keep singular library names.
- **Delegate to GitHub:** never duplicate GitHub-owned state; read live or cache-thin + reconcile-on-read. Only the `installation` webhook is consumed.
- **Least privilege:** user GitHub authorization requests only `read:org` (+ profile/email). Org/repo writes use the **App installation** token.

---

## Validation Model

Every task ends with **two gates**; do not advance until both pass.

### Automated gate (agent runs, must be green)

Only the packages a task touched need their checks run, but nothing previously green may regress:

```bash
pnpm run biome           # = "biome check ." — call the SCRIPT (no extra args;
                         #   `pnpm biome check .` double-appends args → noisy)
pnpm -r typecheck        # tsc --noEmit
pnpm -r test             # vitest (TDD: test written before impl)
```

(`build`/`wrangler dry-run` only on tasks that wire the Worker.) **No commit** closes the task — leave the green increment in the working tree.

### Human gate (you approve, agent waits)

After green, the agent presents: the change summary + new test output; anything not auto-verifiable (a real edu-ID login, a rendered screen); any deviation. You reply **approve** or **changes**. 🔴 tasks require you to exercise the real flow before approving.

**👁 Visual gate (MANDATORY for any user-visible change).** Whenever a task changes something *viewable* — any UI, screen, layout, component, or styling change — the agent MUST run the dev server (`pnpm --filter @labs/www dev`) and we review the rendered result **together on the real screen** before approval. A written summary is never sufficient for viewable changes. UI/UX and look-and-feel are first-class; we iterate on the actual screen. This gate is in addition to (not a replacement for) the automated gate.

### Loop protocol (per task)

1. Read the task brief + Global Constraints + Working Mode.
2. TDD: failing test → run (red) → minimal impl → run (green). **No commit.**
3. Run the automated gate; fix until green.
4. Tick the tracker's Auto box; request the human gate.
5. Approve → tick Human + Done, advance the cursor → next task. Changes → back to 2.

---

## Progress Tracker

**▶ Active cursor:** _**Milestone 1 (F0 + F1 + F2) MERGED to `main`** (PR #1, `954b4f2`); commit-per-milestone, no co-author trailer. **Now on branch `milestone-2-classes`** — a refinement pass (UNCOMMITTED, full gate green 2026-07-02) before F3:_
> - **App shell + account menu** — `AppHeader` (wordmark + top-right identity + brand hairline, white bg); shadcn `dropdown-menu` (Base UI); hover-opened menu.
> - **Auth context** — `AuthProvider`/`useAuth()` = one identity source (`/api/me` + reactive), specific actions `signIn`/`signOut`/`linkGithub`/`unlinkGithub`.
> - **Identity wrappers** (wrap the `UserIdentity` primitive, context-sourced): `SwitchIdentity` (edu-ID, always initials; the account menu — lists affiliation emails, incorporates GitHub + unlink + sign out) and `GithubIdentity`.
> - **GitHub link resilience (F2 hardening)** — `/api/me` `githubLinked` = *usable now* (profile fetched); a broken/expired/absent link → `false` → onboarding gate self-routes to re-link. Added **unlink** action.
> - **edu-ID affiliation emails** — request SWITCH `swissEduID*` claims (`authorizationUrlParams`), decode the stored id_token in `/api/me` → `affiliations` (`swissEduIDLinkedAffiliationMail` only). No schema change.
> - **Dev loop** — Vite HMR proxying `/api` to the Worker (`vite.config.ts`), to avoid the build/client EBUSY rebuild dance.
>
> _**Feature 3 — Teacher connects a class: DONE + live 🔴 walk PASSED** (2026-07-02). Spec `specs/2026-07-02-f3-connect-class-design.md`, plan `plans/2026-07-02-f3-connect-class.md`; 10 tasks, subagent-driven, all committed on `milestone-2-classes` (gate green: db 2 / api 16 / www 12 tests, post-review). GitHub App `heigvdlabs` reconfigured (org Admin+Members write, public, Setup URL, PKCS#8 key). **Next: Feature 4 — class join link + enrollment** (`classes.joinToken`; 🔴). Also pending: **PR `milestone-2-classes` → `main`**. Deferred: `installation` webhook (reconcile-on-read instead), silent token refresh, PATCH /orgs deprecation. See ledger `.superpowers/sdd/progress.md`._
> - Whole-branch review (2026-07-02): 1 Critical (setup installation-ownership) + 5 Important fixed; minors logged in ledger.

`[ ]` pending → `[x]` passed. **Auto** = automated gate green. **Human** = your approval (🔴 = needs real edu-ID/GitHub flow first; 🟢 routine). **Done** = both gates passed (uncommitted increment in the tree).

### Feature 0 — Scaffold (shared infra, tooling-driven)

> Rebuilt from scratch with official tooling after the clean-up (`pnpm init`, `pnpm dlx @biomejs/biome init`, workspace file, shared tsconfig base).

| Task | Auto | Human | Done |
|---|---|---|---|
| 1. Monorepo root via `pnpm init` + `biome init` + workspace | [x] | [x] 🟢 | [x] |

### Feature 1 — Sign in with edu-ID (tooling-driven)

> Smallest login slice: edu-ID OIDC → authed home → sign out. Apps **scaffolded** (C3 / React Router create); auth schema **generated** by the Better Auth CLI. No GitHub, no app tables, no `packages/types`, no route guard yet.

| Task | Auto | Human | Done |
|---|---|---|---|
| 2. Scaffold `apps/api` (Hono creator) + Better Auth (edu-ID) config | [x] | [x] 🟢 | [x] |
| 3. Generate Better Auth schema via CLI → `packages/db` + migration | [x] | [x] 🟢 | [x] |
| 4. Scaffold `apps/www` (React Router SPA) + login/home/sign out | [x] | [x] 🟢 | [x] |
| 5. Same-origin Worker + live edu-ID smoke | [x] | [x] 🔴 | [x] |

> **Superseded:** the earlier hand-written `packages/db` (old Task 2) is replaced — its `getDb`/config may be reused, but `schema.ts` is **regenerated** by the Better Auth CLI in Task 3.

**Feature 1 gate:** [x] all tasks done · [x] live walk passed (edu-ID login → home → sign out). **COMPLETE + committed.**

### Features 2–10 (one feature each; outlined until reached)

| # | Feature | New schema (minimal) | Status |
|---|---|---|---|
| F2 | Mandatory GitHub linking (onboarding gate + route guard) | none (uses `account` github row) | [x] DONE (merged `154b3bb`); **hardened** on `milestone-2-classes` (liveness gate → self-re-link, unlink) |
| F3 | Teacher connects a class (org → class, base permission `No access`) | `classes` (id, orgId, installationId, connectedByUserId, status) | [x] **DONE + live 🔴 walk PASSED** (2026-07-02) — see `plans/2026-07-02-f3-connect-class.md` + `specs/2026-07-02-f3-connect-class-design.md`; on `milestone-2-classes`, uncommitted-merge pending. Octokit App, setup callback, confirm→base-permission, list+reconcile. |
| F4 | Class join link + student enrollment | `classes.joinToken` | [ ] |
| F5 | View class people (live Owners/Members) | none (read live) | **F5a (teacher access model) [x] DONE + live 🔴 PASSED** (2026-07-02, pulled ahead of F4): teacher = live org `admin`; list = installations ∩ rows + admin filter; writes 404 for non-admins; co-owner + demote both live-verified. See `specs/2026-07-02-f5a-teacher-access-design.md`. F5b (people UI, health chip) [ ] |
| F6 | Create a lab | `labs` (minimal) | [ ] |
| F7 | Groups (create/join/leave/remove/delete) | `groups` | [ ] |
| F8 | Accept a lab → student lab repo (solo = team of one) | `student_lab_repos` | [ ] |
| F9 | Student home (browse classes/labs/standing) | none | [ ] |
| F10 | Teacher dashboard | none | [ ] |

Each feature is expanded into full tasks **in this file** (replacing its row's section) when the prior feature is approved.

---

## Resume & Session Continuity

Multi-session, **and nothing is committed** — so resume relies on this file + the working tree, not `git log`.

**To resume:**

1. Read the **▶ Active cursor** and the latest **Session Log** row.
2. `git status` — uncommitted changes are the work so far (everything sits on top of the scaffold). There is no per-task commit; the tracker is the record of which tasks are *complete*.
3. Run the **automated gate** (`pnpm run biome && pnpm -r typecheck && pnpm -r test`). Green = the last completed task is intact; red = a task was left mid-flight — finish or undo it.
4. Open the first task whose **Done** is unchecked; start at its Step 1.
5. 🔴 human gates need the user present with real credentials — pause there if absent.

> ⚠️ Because work is uncommitted, `git reset --hard`, `git stash`, `git clean -fdx`, or branch switches can **destroy** it. Avoid them. The tracker + working tree are the only state.

**Before ending a session:** tick completed gates/Done, move the **▶ Active cursor**, append a **Session Log** row. Do not commit.

### Session Log

| Session date | Tasks completed | Cursor left at | Blockers / notes |
|---|---|---|---|
| 2026-06-30 | Task 1 (scaffold) approved; plan re-cut to feature-iterative + no-commit | F1 · Task 2 | edu-ID test-IdP creds needed before Task 5 (🔴). Repo `heigvd-software-engineering/labs` exists with 2 baseline commits (scaffold) — see controller note re: hiding history. |
| 2026-06-30 | Cleaned slate; rebuilt root + apps/api + packages/db **tooling-driven** (latest deps). Better Auth edu-ID config + CLI-generated auth schema (isolated in `auth-schema.ts`, barrel in `schema.ts`) + migration + health test. **Tasks 2+3 green, human gate pending.** | F1 · Task 4 (apps/www) | ⛔ **SWITCH edu-ID access not yet approved** → Task 5 blocked. `better-call@1.3.7` override + `allowBuilds` in pnpm-workspace.yaml. Workers-pool tests deferred (vitest-4 churn). Everything UNCOMMITTED. |
| 2026-07-01 | Audited 2+3 (found + fixed missing `@labs/db` type exports; reverted an over-eager db shape-test — CLI-generated code needs no test). **Approved Tasks 2, 3, 4.** Built `apps/www` (React Router **8.1** framework-mode SPA, `ssr:false`) subagent-driven: login/home/sign-out, better-auth/react client, 2 tests; task review clean. Upgraded www stragglers to latest (TS 6.0.3, RR 8.1, @types/node 26, better-auth 1.6.23); fixed RR 8.1 `AppLoadContext` removal in `entry.server.tsx`. **Kept framework mode** (deliberate — typed routes + loaders for F5+ + monorepo consistency). Full gate green; login screen visually confirmed. | F1 · Task 5 (BLOCKED) | ⛔ Still waiting on SWITCH edu-ID creds for Task 5. Everything UNCOMMITTED. |
| 2026-07-01 (cont.) | **UI foundations:** shadcn init (Base UI `base-nova`, matches monorepo); styled login screen (Swiss-precision: graph-paper bg, Geist, brand-red, mono eyebrow) — visually approved. Component conventions: `components/ui` (generated) vs `custom/` (ours) + READMEs; `pages/` + `routes/` split. **Styling policy:** wrap Tailwind into named components — `custom/layout/` (Stack, Container + tokens) + `custom/typography/` (Title, Lead, Eyebrow); strict YAGNI (only used variants). Added **👁 visual gate** to plan (run dev server for every viewable change). **Task 5 automated gate ✅** (same-origin Worker + ASSETS SPA fallback; verified via wrangler dev; wrangler→4.105). | F1 · Task 5 human gate (BLOCKED) | ⛔ Only the 🔴 live edu-ID walk remains for F1 (needs creds + real D1). Everything UNCOMMITTED. |
| 2026-07-02 (F5a + refactor) | **F5a — multi-teacher access: DONE, live 🔴 PASSED both ways** (co-owner who never installed sees + confirms; demoted Member loses it). Teacher = live org `admin` (`github/teacher.ts`: stored account id + installation-token admin list); list = installations ∩ rows + admin filter (F8 guard); `connectedByUserId` = provenance only. Also: **whole-branch independent review** → 1 Critical (setup installation-ownership hijack) + 5 Important fixed (`108b895`); **api reorganized by concern** (`auth/ github/ switch/`, shared `user-installations` extraction, `847ce38`) + dead code removed (`dc297f3`). | **F4 (join link)**, then F5b (people UI) | PR #2 open, all pushed. Second GitHub account = future test student. |
| 2026-07-02 (F3 built + live walk) | **Feature 3 — Teacher connects a class: DONE, live 🔴 walk PASSED.** Brainstorm→spec→plan→subagent-driven (10 tasks): `classes` table + real D1 test infra; Octokit App client (`@octokit/app`, **PKCS#8** key, `\n` normalize); `requireAuth`; DB helpers; `GET /api/github/setup` (install callback → upsert row); `POST /api/classes/:id/confirm` (base perm "No access" + verify); `GET /api/classes` (reconcile + live enrich); home connect button + `ClassCard`; confirm page. Live: installed `heigvdlabs` on **Test TWeb 2026** org → row (org_id 299160351) → base perm flipped → class lists. Gate green (db2/api12/www7). GitHub App reconfig (Admin+Members write, public via Advanced, Setup URL). | **F4 (join link)** + PR `milestone-2-classes`→`main` | PATCH /orgs deprecated (2028); webhook + silent-refresh deferred. |
| 2026-07-02 (milestone-2 refinements) | Milestone 1 **merged to `main`** (PR #1). On **`milestone-2-classes`**: app shell + account menu (shadcn `dropdown-menu`); **auth context** (`useAuth`, specific actions); identity wrappers **`SwitchIdentity`**/**`GithubIdentity`** wrapping `UserIdentity`; **GitHub link resilience** (`githubLinked` = usable-now → broken link self-routes to onboarding) + **unlink**; **edu-ID affiliation emails** (SWITCH claims via `authorizationUrlParams` → decode stored id_token in `/api/me`, `swissEduIDLinkedAffiliationMail` only); Vite `/api` proxy for HMR. Full gate green; UNCOMMITTED. | **F3 (expand + start)** | 🔴 F3 needs GitHub App creds. Chose onboarding-re-link over silent token refresh. |
| 2026-07-01 (F1 close + F2) | **edu-ID creds arrived → F1 Task 5 🔴 live walk PASSED → Feature 1 COMPLETE.** **Mode change: started committing per-milestone** (no co-author trailer) — `d47dcfb` Milestone 1 foundation, `00d7398` milestone-review fixes. Then **built Feature 2 — mandatory GitHub linking** (committed `154b3bb`): GitHub OAuth link provider + `trustedProviders` fix, `customSession`/`/api/me` returning GitHub profile, onboarding gate + route guard (`OnboardingGate`), home shows GitHub profile as auth proof; new UI: `UserAvatar`/`UserIdentity`/`Row` (+ shadcn avatar), layout token additions. SSR-safety fixes: dropped `window.location.origin` from auth client, `typeof window` guard on API client. All gates green; SPA prod build OK. | **F3 — Teacher connects a class** (needs task expansion + GitHub App creds) | Branch `milestone-1-foundation`, HEAD `154b3bb`, tree clean. Docs (this tracker + ledger) had drifted behind git — reconciled 2026-07-02. |

---

# Feature 1 — Sign in with edu-ID (detailed)

**Feature outcome:** a user opens the app, clicks "Sign in with SWITCH edu-ID", authenticates, lands on an authed home showing their name, and can sign out. Nothing more.

**Files introduced this feature**

```
packages/db/   # @labs/db — Better Auth schema (4 tables) + getDb + inferred types
apps/api/      # @labs/api — Hono Worker, Better Auth (edu-ID only), AppType
apps/www/      # @labs/www — SPA: login + authed home + sign out
```

Deferred (NOT this feature): `packages/types` (no inputs yet), route guard / onboarding (F2), app tables (F3+), CI type-safety guard.

---

### Task 2: `packages/db` — Better Auth tables + `getDb`

**Files:** Create `packages/db/{package.json,tsconfig.json,drizzle.config.ts,src/schema.ts,src/index.ts,test/types.test.ts}`

**Interfaces produced:** `@labs/db` exporting tables `user`, `session`, `account`, `verification`; types `User`, `Account`, `Session` (inferred selects); `getDb(d1: D1Database)`.

**Minimal note:** these four are Better Auth's required tables — the minimum login needs. Add **no** app-domain tables here.

- [ ] **Step 1: Package + tsconfig** — `packages/db/package.json`:
```json
{
  "name": "@labs/db",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run", "build": "tsc --noEmit", "db:generate": "drizzle-kit generate" },
  "dependencies": { "drizzle-orm": "^0.36.0" },
  "devDependencies": { "drizzle-kit": "^0.28.0", "@cloudflare/workers-types": "^4.20240000.0" }
}
```
`packages/db/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["@cloudflare/workers-types"] }, "include": ["src", "test", "drizzle.config.ts"] }
```

- [ ] **Step 2: Failing test** — `packages/db/test/types.test.ts`:
```ts
import { expect, test } from "vitest";
import type { Account, User } from "../src/index";
import { account, user } from "../src/index";

test("user schema exposes Better Auth default columns", () => {
  expect(Object.keys(user)).toEqual(
    expect.arrayContaining(["id", "name", "email", "emailVerified"]),
  );
});

test("account schema holds provider + token columns", () => {
  expect(Object.keys(account)).toEqual(
    expect.arrayContaining(["userId", "providerId", "accountId", "accessToken"]),
  );
});

test("entity types are assignable from inferred selects", () => {
  const u: User = {
    id: "u1", name: "A", email: "a@b.ch", emailVerified: false,
    image: null, createdAt: new Date(), updatedAt: new Date(),
  };
  expect(u.id).toBe("u1");
});
```

- [ ] **Step 3: Run → fails** — `pnpm --filter @labs/db test` → cannot find `../src/index`.

- [ ] **Step 4: Implement** — `packages/db/src/schema.ts`:
```ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
};

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
  image: text("image"),
  ...timestamps,
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  ...timestamps,
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id),
  providerId: text("provider_id").notNull(),
  accountId: text("account_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  ...timestamps,
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ...timestamps,
});
```
`packages/db/src/index.ts`:
```ts
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export * from "./schema";

export type User = typeof schema.user.$inferSelect;
export type Account = typeof schema.account.$inferSelect;
export type Session = typeof schema.session.$inferSelect;

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
```
`packages/db/drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({ schema: "./src/schema.ts", out: "./migrations", dialect: "sqlite", driver: "d1-http" });
```

- [ ] **Step 5: Run → passes** — `pnpm --filter @labs/db test` (3 tests).
- [ ] **Step 6: Generate migration** — `pnpm --filter @labs/db db:generate` → `migrations/0000_*.sql` with the 4 tables.
- [ ] **Step 7: Automated gate** — `pnpm biome check . && pnpm -r typecheck && pnpm -r test` green. **Do not commit.**

**Human gate:** 🟢 confirm only the 4 Better Auth tables exist (no app tables).

---

### Task 3: `apps/api` — Hono Worker + Better Auth (edu-ID only) + `AppType`

**Files:** Create `apps/api/{package.json,tsconfig.json,wrangler.toml,vitest.config.ts,src/index.ts,src/routes.ts,src/auth.ts,test/health.test.ts,test/auth.test.ts}`

**Interfaces produced:** `createAuth(env)` (Better Auth, edu-ID genericOAuth only); `routes` with `/api/auth/*` + `GET /api/health` → `{ ok: true }`; `type AppType = typeof routes`. **No GitHub provider, no `customSession` yet** — those arrive in F2.

- [ ] **Step 1: Package, wrangler, vitest** — create `apps/api/package.json` with name/scripts only (no version pins):
```json
{
  "name": "@labs/api",
  "version": "0.0.0",
  "type": "module",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run", "build": "wrangler deploy --dry-run --outdir dist", "dev": "wrangler dev" }
}
```
Then install **latest** (resolver fills versions):
```bash
pnpm --filter @labs/api add hono better-auth @labs/db@workspace:*
pnpm --filter @labs/api add -D wrangler @cloudflare/workers-types @cloudflare/vitest-pool-workers
```
`apps/api/wrangler.toml`:
```toml
name = "labs"
main = "src/index.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "labs"
database_id = "REPLACE_BEFORE_DEPLOY"
migrations_dir = "../../packages/db/migrations"

[vars]
EDUID_ISSUER = "https://eduid.ch/idp/profile/oidc"
BETTER_AUTH_URL = "http://localhost:8787"
# Secrets (.dev.vars): EDUID_CLIENT_ID, EDUID_CLIENT_SECRET, BETTER_AUTH_SECRET
```
`apps/api/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["@cloudflare/workers-types"] }, "include": ["src", "test"] }
```
`apps/api/vitest.config.ts`:
```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
export default defineWorkersConfig({ test: { poolOptions: { workers: { wrangler: { configPath: "./wrangler.toml" } } } } });
```

- [ ] **Step 2: Failing tests** — `apps/api/test/health.test.ts`:
```ts
import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import worker from "../src/index";

test("GET /api/health returns ok", async () => {
  const res = await worker.fetch(new Request("https://x/api/health"), env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
```
`apps/api/test/auth.test.ts`:
```ts
import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import worker from "../src/index";

test("auth handler is mounted at /api/auth", async () => {
  // unknown sub-route still routes through Better Auth (not a 404 from Hono)
  const res = await worker.fetch(
    new Request("https://x/api/auth/ok", { method: "GET" }), env,
  );
  expect(res.status).not.toBe(404);
});
```

- [ ] **Step 3: Run → fails** — `pnpm --filter @labs/api test` → cannot find `../src/index`.

- [ ] **Step 4: Implement** — `apps/api/src/auth.ts`:
```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins";
import { getDb } from "@labs/db";
import type { Env } from "./routes";

export function createAuth(env: Env) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(env.DB), { provider: "sqlite" }),
    advanced: {
      cookies: { sessionToken: { attributes: { sameSite: "lax", secure: true, httpOnly: true } } },
    },
    plugins: [
      genericOAuth({
        config: [{
          providerId: "eduid",
          discoveryUrl: `${env.EDUID_ISSUER}/.well-known/openid-configuration`,
          clientId: env.EDUID_CLIENT_ID,
          clientSecret: env.EDUID_CLIENT_SECRET,
          scopes: ["openid", "profile", "email"],
        }],
      }),
    ],
  });
}
```
`apps/api/src/routes.ts`:
```ts
import { Hono } from "hono";
import { createAuth } from "./auth";

export type Env = {
  DB: D1Database;
  EDUID_ISSUER: string;
  EDUID_CLIENT_ID: string;
  EDUID_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
};

const app = new Hono<{ Bindings: Env }>();

export const routes = app
  .on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw))
  .get("/api/health", (c) => c.json({ ok: true } as const));

export type AppType = typeof routes;
```
`apps/api/src/index.ts`:
```ts
import { routes } from "./routes";
export default { fetch: routes.fetch };
```

- [ ] **Step 5: Run → passes** — `pnpm --filter @labs/api test`.
- [ ] **Step 6: Schema parity check** — `pnpm dlx @better-auth/cli@latest generate --config apps/api/src/auth.ts`; reconcile any diff into `packages/db` (regenerate migration if needed).
- [ ] **Step 7: Automated gate** — biome + typecheck + test green (+ `wrangler deploy --dry-run` builds). **Do not commit.**

**Human gate:** 🟢 (full live edu-ID round-trip is exercised in Task 5).

---

### Task 4: `apps/www` — login + authed home + sign out

**Files:** Create `apps/www/{package.json,tsconfig.json,vite.config.ts,react-router.config.ts,app/root.tsx,app/routes.ts,app/routes/_index.tsx,app/lib/auth.ts}`

**Interfaces produced:** `authClient` (`useSession`, `signIn`, `signOut`); an index route that shows the **login** button when unauthenticated and an **authed home** (name + sign out) when signed in.

**Minimal note:** no route guard, no onboarding, no `hc`/`AppType` client yet (no API data calls in this feature — auth client talks to `/api/auth/*` directly). The typed `hc<AppType>` client arrives when a feature first reads app data (F5).

- [ ] **Step 1: Package + config** — create `apps/www/package.json` with name/scripts only (no version pins):
```json
{
  "name": "@labs/www",
  "version": "0.0.0",
  "type": "module",
  "scripts": { "typecheck": "react-router typegen && tsc --noEmit", "test": "vitest run", "build": "react-router build", "dev": "react-router dev" }
}
```
Then install **latest** (resolver fills versions):
```bash
pnpm --filter @labs/www add react react-dom react-router better-auth
pnpm --filter @labs/www add -D @react-router/dev vite tailwindcss @tailwindcss/vite \
  @testing-library/react @testing-library/jest-dom jsdom vitest
```
(Optionally scaffold the SPA with React Router's create tool first, then trim to this minimal shape — either way, deps are latest.)
`react-router.config.ts`: `import type { Config } from "@react-router/dev/config"; export default { ssr: false } satisfies Config;`
`vite.config.ts`:
```ts
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
export default defineConfig({ plugins: [reactRouter(), tailwindcss()], resolve: { alias: { "~": "/app" } } });
```
`tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "lib": ["DOM", "DOM.Iterable", "ES2022"], "jsx": "react-jsx", "paths": { "~/*": ["./app/*"] }, "types": ["@react-router/dev"] }, "include": ["app", "test", ".react-router/types"] }
```

- [ ] **Step 2: Auth client** — `app/lib/auth.ts`:
```ts
import { createAuthClient } from "better-auth/react";
import { genericOAuthClient } from "better-auth/client/plugins";
export const authClient = createAuthClient({ baseURL: window.location.origin, plugins: [genericOAuthClient()] });
export const { useSession, signIn, signOut } = authClient;
```

- [ ] **Step 3: Failing test** — `apps/www/{vitest.config.ts,test/setup.ts,test/index.test.tsx}`:
```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "jsdom", setupFiles: ["./test/setup.ts"], globals: true }, resolve: { alias: { "~": "/app" } } });
```
```ts
// test/setup.ts
import "@testing-library/jest-dom/vitest";
```
```tsx
// test/index.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
vi.mock("~/lib/auth", () => ({
  useSession: () => ({ data: { user: { name: "Alice" } }, isPending: false }),
  signIn: { oauth2: vi.fn() }, signOut: vi.fn(),
}));
import Index from "~/routes/_index";
test("authed home shows the user's name", () => {
  render(<Index />);
  expect(screen.getByText("Alice")).toBeInTheDocument();
});
```

- [ ] **Step 4: Run → fails** — `pnpm --filter @labs/www test` → cannot find `~/routes/_index`.

- [ ] **Step 5: Implement** — `app/routes.ts`: `import { type RouteConfig, index } from "@react-router/dev/routes"; export default [index("routes/_index.tsx")] satisfies RouteConfig;`
`app/root.tsx`:
```tsx
import { Links, Meta, Outlet, Scripts } from "react-router";
export default function Root() {
  return (
    <html lang="en"><head><meta charSet="utf-8" /><Meta /><Links /></head>
      <body><Outlet /><Scripts /></body></html>
  );
}
```
`app/routes/_index.tsx`:
```tsx
import { signIn, signOut, useSession } from "~/lib/auth";
export default function Index() {
  const { data, isPending } = useSession();
  if (isPending) return null;
  if (!data?.user) {
    return (
      <main>
        <h1>labs</h1>
        <button type="button" onClick={() => signIn.oauth2({ providerId: "eduid", callbackURL: "/" })}>
          Sign in with SWITCH edu-ID
        </button>
      </main>
    );
  }
  return (
    <main>
      <header><span>{data.user.name}</span>
        <button type="button" onClick={() => signOut()}>Sign out</button></header>
      <p>Home</p>
    </main>
  );
}
```

- [ ] **Step 6: Run → passes** — `pnpm --filter @labs/www test`.
- [ ] **Step 7: Automated gate** — biome + typecheck (`react-router typegen && tsc`) + test green (+ `react-router build`). **Do not commit.**

**Human gate:** 🟢 (real screens validated in Task 5).

---

### Task 5: Same-origin Worker + live edu-ID smoke 🔴

**Files:** Modify `apps/api/{wrangler.toml,src/index.ts}`; add root `package.json` ordered `build` script.

**Interfaces produced:** one Worker serving `/api/*` via Hono and all else from the SPA build (SPA fallback) — same origin, first-party cookie.

- [ ] **Step 1: Assets binding** — append to `apps/api/wrangler.toml`:
```toml
[assets]
directory = "../www/build/client"
binding = "ASSETS"
not_found_handling = "single-page-application"
```
Add `ASSETS: Fetcher` to `Env` in `routes.ts`.

- [ ] **Step 2: Fall through to assets** — `apps/api/src/index.ts`:
```ts
import { routes } from "./routes";
import type { Env } from "./routes";
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return routes.fetch(req, env, ctx);
    return env.ASSETS.fetch(req);
  },
};
```

- [ ] **Step 3: Ordered build** — root `package.json` script: `"build": "pnpm --filter @labs/www build && pnpm --filter @labs/api build"`.

- [ ] **Step 4: Build check** — `pnpm build`: `apps/www/build/client` exists; `wrangler deploy --dry-run` resolves assets.

- [ ] **Step 5: Automated gate** — full gate + `pnpm build` green. **Do not commit.**

**Human gate:** 🔴 **REQUIRED** — provision a real D1 (`wrangler d1 create labs`, apply the migration), set `database_id`, put edu-ID **test-IdP** creds in `.dev.vars`, run `wrangler dev`, and in a browser: **edu-ID login → authed home (your name) → sign out**. Confirm a `user` + `eduid` `account` row are created and the session cookie is first-party. This is the Feature 1 acceptance.

---

## Feature 1 self-review (coverage)

edu-ID login → Tasks 3+5. Authed home + sign out → Task 4. Persistence (Better Auth tables only) → Task 2. Same-origin → Task 5. **No** GitHub, app tables, route guard, `packages/types`, or CI guard — correctly deferred to the features that need them.

---

# Features 2–10 — outlines (expanded when reached)

Each is a single feature: smallest schema + code, auto + human gate per task.

> **Decided — auth middleware (lands with its first consumer, F3+):** protected
> data endpoints use a `requireAuth` Hono middleware + an `AuthedEnv` type
> (`Bindings` + `Variables { user, session }`), applied **per route module** via
> `.use(requireAuth)` (colocated, type-visible). Handlers read `c.get("user")`
> (typed, non-null; 401 otherwise). `/api/me` stays **session-optional** (no
> `requireAuth`). Not built ahead of need.

- **F2 — Mandatory GitHub linking.** Add the GitHub link provider to `createAuth`; add `customSession` exposing `githubLinked` (a `github` `account` row exists); add `/onboarding/github` + a route guard (authed & unlinked & not onboarding → redirect). UI gains the onboarding gate. *Schema: none.* *(Flows §3.1, §6 onboarding gate.)* 🔴 real GitHub link.
- **F3 — Teacher connects a class.** Add `classes` (id, orgId unique, installationId, connectedByUserId, status) — *only these columns*. Octokit App client; `GET /user/installations`; install callback writes the row; set base permission `No access` (`PATCH /orgs/{org}`) + confirm. *(Flows §3.4.)* 🔴 GitHub App.
- **F4 — Join link + enrollment.** Add `classes.joinToken` (unique, regenerable); teacher copy-link UI; student opens link → `PUT /orgs/{org}/memberships/{username}` → redirect to `github.com/orgs/{org}/invitation`; idempotent. *(Flows §3.5, §3.8.)* 🔴
- **F5 — View class people.** Read org Owners/Members live; split teachers/students. Introduces the typed `hc<AppType>` client (first app-data read). *Schema: none.* *(Flows §3.6.)*
- **F6 — Create a lab.** Add `labs` minimal (id, classId, title, deadline NOT NULL, groupMode; add templateRepoId / min-max only when accept needs them). *(Flows §3.7.)*
- **F7 — Groups.** Add `groups` (id, classId, ghTeamId, ghTeamSlug, name, creatorUserId); team lifecycle (create `secret`, add `member`, remove, delete); create/join/leave/remove; reconcile-on-read. *(Groups-teams.)* 🔴
- **F8 — Accept a lab.** Add `student_lab_repos` (id, labId, groupId, ghRepoId, ghRepoFullName; unique (labId, groupId)). Individual = team-of-one; group = reuse/join/create; repo via `/generate` or empty. *(Flows §3.11.)* 🔴
- **F9 — Student home.** By-class sections listing member classes (live) + labs + standing + inline accept drawer. *Schema: none.* *(Flows §3.9.)*
- **F10 — Teacher dashboard.** Live aggregation over GitHub + lab metadata; short-TTL caching. *Schema: none.* *(Flows §3.12.)*

---

## Execution

Per the **Validation Model**: each task ends with the automated gate **and** your approval, and leaves a tested, **uncommitted** increment. 🔴 tasks need the real edu-ID/GitHub flow first. Tick the **Progress Tracker** and append a **Session Log** row as you go.

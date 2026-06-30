# Labs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The **Progress Tracker** section below rolls up every task's two gates — update it after each gate.

**Goal:** Build `labs`, HEIG-VD's in-house GitHub Classroom replacement, as a same-origin Cloudflare app where SWITCH edu-ID identity + a mandatory linked GitHub account drive class/lab/group management that delegates to GitHub.

**Architecture:** A pnpm monorepo. One Cloudflare Worker (`apps/api`, Hono) serves the React Router 7 SPA (`apps/www`) static assets **and** `/api/*` — same origin, first-party cookies. Better Auth (edu-ID OIDC login + GitHub App account linking) persists to Drizzle/D1. End-to-end type safety flows Drizzle `$infer*` → zod inputs (`packages/types`) → Hono RPC client, no codegen. Domain state delegates to GitHub (org = class, team = group); the DB stores only what GitHub can't express.

**Tech Stack:** pnpm workspaces, TypeScript, Hono on Cloudflare Workers, Better Auth, Drizzle ORM + Cloudflare D1 (SQLite), Octokit (GitHub App), React Router 7 (SPA, `ssr:false`), Tailwind 4, shadcn/ui, Biome, Vitest (`@cloudflare/vitest-pool-workers` + `@testing-library/react`), lefthook, Wrangler.

## Global Constraints

These apply to **every** task. Copied verbatim from the specs.

- **Package scope:** `@labs/*` (e.g. `@labs/db`, `@labs/types`).
- **Biome style:** double quotes, semicolons, 2-space indent, 80-column width.
- **Type safety:** end-to-end, **no codegen**. Drizzle `$inferSelect`/`$inferInsert` for entities; zod for request **inputs** only; response types **inferred** from Hono `c.json(...)` via `hc<AppType>`. **Never re-declare a response shape by hand.**
- **Frontend:** `apps/www` is `ssr:false`; `~` alias points to `app/`.
- **Same-origin:** SPA + API share one origin; session is a first-party cookie — **secure, httpOnly, `SameSite=Lax`**.
- **Secrets are Worker secrets** (never in code or returned to client): edu-ID `clientSecret`, GitHub App `privateKey`, GitHub App OAuth `clientSecret`.
- **DB naming:** app-domain tables are **plural** (`classes`, `labs`, `groups`, `student_lab_repos`); Better Auth tables keep the library's **singular** names (`user`, `session`, `account`, `verification`).
- **Delegate to GitHub:** never duplicate GitHub-owned state as our authority — read live or cache-thin and reconcile on read. Only the `installation` webhook is consumed.
- **Storage:** D1 now, R2 later. No R2 in this plan.
- **Least privilege:** user GitHub authorization requests only `read:org` (+ profile/email). Org/repo writes use the **App installation** token, never user tokens.

---

## Validation Model

Every task ends with **two gates**. The agent does not proceed to the next task until both pass. Record both in the tracker.

### Automated gate (agent runs, must be green)

Run from repo root unless noted. A task only needs the gates relevant to the packages it touched, but the **full suite must stay green**:

```bash
pnpm biome check .          # lint + format, zero diagnostics
pnpm -r typecheck           # tsc --noEmit across all packages
pnpm -r test                # vitest across all packages
pnpm -r build               # tsc/vite/wrangler build succeeds
```

- New behavior is covered by a test written **before** its implementation (TDD).
- The task's own new test(s) pass; no previously-green test regresses.

### Human gate (you approve, agent waits)

After the automated gate is green, the agent presents:
1. the diff summary and the new test output,
2. anything that **cannot be auto-verified** (a real edu-ID login, a real GitHub link, a rendered screen),
3. any deviation from the plan and why.

You reply **approve** (agent ticks the human gate and continues) or **changes** (agent revises, re-runs the automated gate, re-presents). Tasks marked **🔴 needs live credentials/UX** below always require you to exercise the real flow before approving.

### Loop protocol (per task)

1. Agent reads the task + Global Constraints.
2. Agent works the steps (TDD: failing test → run → implement → run → commit).
3. Agent runs the **automated gate**; fixes until green.
4. Agent updates the tracker (automated ✅) and requests the **human gate**.
5. You approve → agent ticks human ✅ and starts the next task. Changes → back to step 2.

---

## Milestones

| # | Milestone | Slice | Detail level | Outcome |
|---|---|---|---|---|
| **M1** | **Foundation & Identity** | S1 | **Full (this doc)** | Deployable walking skeleton: edu-ID login → mandatory GitHub link → authed home, same-origin, type-safe end-to-end. |
| M2 | Class & enrollment | S2 | Outline | Connect an org as a class; share a join link; students self-enroll; live people view. |
| M3 | Groups | S3 | Outline | Reusable groups as GitHub Teams (create/invite/join/leave/remove/delete), reconcile-on-read. |
| M4 | Labs | S4 | Outline | Create labs (optional template, required deadline, group settings); accept ⇒ student lab repo (team-of-one for solo). |
| M5 | Teacher dashboard | S5 | Outline | Aggregated read view over GitHub + lab metadata. |

Each later milestone is expanded with full task/step detail **in this same file** (replacing its outline section) when M(N-1) is approved.

---

## Progress Tracker

**▶ Active cursor:** _M1 · Task 1 (not started)_ — update this line at the end of every session to point at the next task to run.

Update after every gate. `[ ]` pending → `[x]` passed. **Auto** = automated gate green (biome + typecheck + test + build). **Human** = your approval; 🔴 = requires exercising the real edu-ID / GitHub flow before approving, 🟢 = routine review. **Done** = both gates passed and committed.

### M1 — Foundation & Identity

| Task | Auto | Human | Done |
|---|---|---|---|
| 1. Monorepo scaffold & toolchain | [ ] | [ ] 🟢 | [ ] |
| 2. `packages/db` schema + entity types | [ ] | [ ] 🟢 | [ ] |
| 3. `packages/types` zod inputs + enums | [ ] | [ ] 🟢 | [ ] |
| 4. `apps/api` skeleton + `/api/health` + `AppType` | [ ] | [ ] 🟢 | [ ] |
| 5. Better Auth (edu-ID OIDC + GitHub link) | [ ] | [ ] 🔴 | [ ] |
| 6. `apps/www` scaffold + auth/API clients | [ ] | [ ] 🟢 | [ ] |
| 7. Route guard (auth + GitHub-linked invariant) | [ ] | [ ] 🟢 | [ ] |
| 8. Three states (login / onboarding / shell) | [ ] | [ ] 🔴 | [ ] |
| 9. Same-origin Worker + end-to-end smoke | [ ] | [ ] 🔴 | [ ] |
| 10. CI full gate + type-safety guard | [ ] | [ ] 🟢 | [ ] |

**M1 milestone gate:** [ ] all tasks done · [ ] CI green on PR · [ ] acceptance walk passed (edu-ID → forced link → home).

### M2–M5 (milestone-level until expanded into full tasks)

| Milestone | Plan expanded | All tasks done | Milestone gate |
|---|---|---|---|
| M2 — Class & enrollment | [ ] | [ ] | [ ] |
| M3 — Groups | [ ] | [ ] | [ ] |
| M4 — Labs | [ ] | [ ] | [ ] |
| M5 — Teacher dashboard | [ ] | [ ] | [ ] |

---

## Resume & Session Continuity

This run spans multiple sessions. **This file + `git log` are the source of truth** — a fresh session reconstructs all state from them; nothing lives only in chat memory.

**To resume at the start of any session:**

1. Read the **▶ Active cursor** line above and the most recent **Session Log** row below.
2. Run `git log --oneline -15` — each task ends with one commit (`feat(db): …`, `feat(api): …`, etc.), so the last task-commit is the real high-water mark. The tracker mirrors it; if they disagree, **git wins** — fix the tracker.
3. Run the **automated gate** (`pnpm biome check . && pnpm -r typecheck && pnpm -r test && pnpm -r build`) to confirm the tree is green before continuing. If red, the previous session left a task mid-flight — finish or revert it first.
4. Open the first task whose **Done** is unchecked and start at its Step 1. If its commit already exists but Done is unticked, verify the gate and tick it rather than redoing work.
5. Honour the **human gate**: 🔴 tasks must not be marked approved without the user exercising the real flow — if the user isn't present, pause at that gate and leave the cursor on it.

**Before ending a session**, the agent MUST: tick the gates/Done it completed, set the **▶ Active cursor** to the next task, append a **Session Log** row, and ensure every completed task is committed (no uncommitted task work left dangling).

### Session Log

Append one row per session (newest at bottom). Keep it terse.

| Session date | Tasks completed | Cursor left at | Blockers / notes |
|---|---|---|---|
| 2026-06-30 | — (plan authored) | M1 · Task 1 | Need git repo init; edu-ID test-IdP + GitHub App creds required before Tasks 5/8/9 (🔴). |

---

# Milestone 1 — Foundation & Identity (detailed)

### File structure introduced in M1

```
labs/
  package.json                      # root scripts, pnpm workspace, devDeps (biome, vitest, lefthook)
  pnpm-workspace.yaml
  biome.json                        # double quotes, semicolons, 2-space, 80 cols
  tsconfig.base.json                # shared compiler options
  lefthook.yml                      # pre-commit: biome check
  .github/workflows/ci.yml          # biome + typecheck + test + build + type-safety guard
  packages/
    db/        # @labs/db — drizzle schema (Better Auth tables), config, migrations, inferred types
      src/schema.ts, src/index.ts, drizzle.config.ts, package.json, tsconfig.json
    types/     # @labs/types — zod input schemas + shared enums
      src/index.ts, package.json, tsconfig.json
  apps/
    api/       # @labs/api — Hono Worker, Better Auth, routes, AppType export
      src/index.ts, src/auth.ts, src/routes.ts, wrangler.toml, vitest.config.ts,
      test/health.test.ts, test/auth.test.ts, package.json, tsconfig.json
    www/       # @labs/www — React Router 7 SPA
      app/root.tsx, app/routes.ts, app/lib/auth.ts, app/lib/api.ts,
      app/components/route-guard.tsx, app/routes/_index.tsx,
      app/routes/onboarding.github.tsx, vite.config.ts, vitest.config.ts,
      test/route-guard.test.tsx, package.json, tsconfig.json
```

**Boundaries:** `packages/db` owns persistence + entity types (no HTTP). `packages/types` owns request validation + enums (no DB, no response types). `apps/api` owns HTTP, auth, and is the single source of `AppType`. `apps/www` consumes `AppType` and the auth client; it never imports `packages/db` directly.

---

### Task 1: Monorepo scaffold & toolchain

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `biome.json`, `tsconfig.base.json`, `lefthook.yml`, `.gitignore`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: root scripts `biome check`, `typecheck`, `test`, `build` runnable via `pnpm -r`; workspace globs `packages/*`, `apps/*`; shared `tsconfig.base.json` extended by every package.

- [ ] **Step 1: Initialize the workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`package.json`:
```json
{
  "name": "labs",
  "private": true,
  "type": "module",
  "scripts": {
    "biome": "biome check .",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "build": "pnpm -r build"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "lefthook": "^1.7.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  },
  "packageManager": "pnpm@9.12.0"
}
```

`biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 80 },
  "javascript": { "formatter": { "quoteStyle": "double", "semicolons": "always" } },
  "linter": { "enabled": true, "rules": { "recommended": true } }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "types": []
  }
}
```

`lefthook.yml`:
```yaml
pre-commit:
  commands:
    biome:
      run: pnpm biome check --staged --no-errors-on-unmatched
```

`.gitignore`:
```
node_modules
dist
.wrangler
.dev.vars
*.local
```

- [ ] **Step 2: Install and verify the toolchain runs**

Run:
```bash
pnpm install
pnpm biome check .
```
Expected: install succeeds; `biome check` reports no files-to-check error and exits 0 (no diagnostics on config files).

- [ ] **Step 3: Initialize git and lefthook**

Run:
```bash
git init
pnpm lefthook install
```
Expected: `lefthook` installs the git hook (prints "hooks installed").

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo with biome, tsconfig base, lefthook"
```

**Automated gate:** `pnpm biome check .` green. (No typecheck/test/build yet — no packages.)
**Human gate:** confirm repo layout + tooling choices. 🟢 routine.

---

### Task 2: `packages/db` — Drizzle schema, D1 config, inferred entity types

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`, `packages/db/src/schema.ts`, `packages/db/src/index.ts`, `packages/db/test/types.test.ts`

**Interfaces:**
- Consumes: `tsconfig.base.json`.
- Produces: `@labs/db` exporting Better Auth tables `user`, `session`, `account`, `verification`; entity types `User = typeof user.$inferSelect`, `Account = typeof account.$inferSelect`; `getDb(d1: D1Database)` returning a Drizzle instance bound to D1.

- [ ] **Step 1: Package + tsconfig**

`packages/db/package.json`:
```json
{
  "name": "@labs/db",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "tsc --noEmit",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": { "drizzle-orm": "^0.36.0" },
  "devDependencies": {
    "drizzle-kit": "^0.28.0",
    "@cloudflare/workers-types": "^4.20240000.0"
  }
}
```

`packages/db/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["@cloudflare/workers-types"] },
  "include": ["src", "test", "drizzle.config.ts"]
}
```

- [ ] **Step 2: Write the failing test for the entity types & schema**

`packages/db/test/types.test.ts`:
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
  const a: Account = {
    id: "a1", userId: "u1", providerId: "github", accountId: "42",
    accessToken: "t", refreshToken: null, accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null, scope: "read:org", idToken: null,
    password: null, createdAt: new Date(), updatedAt: new Date(),
  };
  expect(u.id).toBe("u1");
  expect(a.providerId).toBe("github");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @labs/db test`
Expected: FAIL — cannot find module `../src/index`.

- [ ] **Step 4: Implement the schema (Better Auth tables) and exports**

`packages/db/src/schema.ts`:
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

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
});
```

> The schema here matches Better Auth's SQLite defaults so `@better-auth/cli generate` (run in Task 5) is a no-op diff. Keep them aligned.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @labs/db test`
Expected: PASS (3 tests).

- [ ] **Step 6: Generate the initial migration**

Run: `pnpm --filter @labs/db db:generate`
Expected: a `packages/db/migrations/0000_*.sql` file is created with the four tables.

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): drizzle Better Auth schema + inferred entity types"
```

**Automated gate:** `pnpm biome check . && pnpm -r typecheck && pnpm -r test` green.
**Human gate:** confirm schema matches data-model spec §1. 🟢 routine.

---

### Task 3: `packages/types` — zod input schemas + shared enums

**Files:**
- Create: `packages/types/package.json`, `packages/types/tsconfig.json`, `packages/types/src/index.ts`, `packages/types/test/inputs.test.ts`

**Interfaces:**
- Consumes: nothing from sibling packages.
- Produces: `@labs/types` exporting `providerIdEnum` (`"eduid" | "github"`) and a placeholder input schema `linkProviderInput` (zod) used to prove the validation chain. Later milestones add real inputs here.

- [ ] **Step 1: Package + tsconfig**

`packages/types/package.json`:
```json
{
  "name": "@labs/types",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run", "build": "tsc --noEmit" },
  "dependencies": { "zod": "^3.23.0" }
}
```

`packages/types/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

- [ ] **Step 2: Write the failing test**

`packages/types/test/inputs.test.ts`:
```ts
import { expect, test } from "vitest";
import { linkProviderInput, providerIdEnum } from "../src/index";

test("providerIdEnum accepts known providers and rejects others", () => {
  expect(providerIdEnum.parse("github")).toBe("github");
  expect(() => providerIdEnum.parse("gitlab")).toThrow();
});

test("linkProviderInput requires a known provider", () => {
  expect(linkProviderInput.parse({ provider: "github" })).toEqual({ provider: "github" });
  expect(() => linkProviderInput.parse({ provider: "x" })).toThrow();
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @labs/types test`
Expected: FAIL — cannot find module `../src/index`.

- [ ] **Step 4: Implement**

`packages/types/src/index.ts`:
```ts
import { z } from "zod";

export const providerIdEnum = z.enum(["eduid", "github"]);
export type ProviderId = z.infer<typeof providerIdEnum>;

export const linkProviderInput = z.object({ provider: providerIdEnum });
export type LinkProviderInput = z.infer<typeof linkProviderInput>;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @labs/types test`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/types
git commit -m "feat(types): zod input schemas + shared provider enum"
```

**Automated gate:** full suite green.
**Human gate:** 🟢 routine.

---

### Task 4: `apps/api` — Hono Worker skeleton, `/api/health`, `AppType` export

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/wrangler.toml`, `apps/api/vitest.config.ts`, `apps/api/src/index.ts`, `apps/api/src/routes.ts`, `apps/api/test/health.test.ts`

**Interfaces:**
- Consumes: `@labs/db` (`getDb`), `@labs/types`.
- Produces: `type AppType = typeof routes` exported from `apps/api/src/routes.ts`; a Worker `fetch` handler in `src/index.ts`; `GET /api/health` returning `{ ok: true }` (inferred response type).

- [ ] **Step 1: Package, wrangler, vitest config**

`apps/api/package.json`:
```json
{
  "name": "@labs/api",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "wrangler deploy --dry-run --outdir dist",
    "dev": "wrangler dev"
  },
  "dependencies": { "hono": "^4.6.0", "@labs/db": "workspace:*", "@labs/types": "workspace:*" },
  "devDependencies": {
    "wrangler": "^3.80.0",
    "@cloudflare/workers-types": "^4.20240000.0",
    "@cloudflare/vitest-pool-workers": "^0.5.0"
  }
}
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
database_id = "REPLACE_WITH_REAL_ID_BEFORE_DEPLOY"
migrations_dir = "../../packages/db/migrations"

# assets binding (apps/www build) is wired in Task 9
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["@cloudflare/workers-types"] },
  "include": ["src", "test"]
}
```

`apps/api/vitest.config.ts`:
```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: { wrangler: { configPath: "./wrangler.toml" } },
    },
  },
});
```

- [ ] **Step 2: Write the failing test**

`apps/api/test/health.test.ts`:
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

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @labs/api test`
Expected: FAIL — cannot find module `../src/index`.

- [ ] **Step 4: Implement routes + worker entry**

`apps/api/src/routes.ts`:
```ts
import { Hono } from "hono";

export type Env = { DB: D1Database };

const app = new Hono<{ Bindings: Env }>();

export const routes = app.get("/api/health", (c) => c.json({ ok: true } as const));

export type AppType = typeof routes;
```

`apps/api/src/index.ts`:
```ts
import { routes } from "./routes";

export default { fetch: routes.fetch };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @labs/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): hono worker skeleton, /api/health, AppType export"
```

**Automated gate:** full suite green (incl. `wrangler deploy --dry-run` build).
**Human gate:** 🟢 routine. Note: `database_id` placeholder is expected until a real D1 is provisioned (Task 9 human step).

---

### Task 5: `apps/api` — Better Auth (edu-ID OIDC login + GitHub App linking) 🔴

**Files:**
- Create: `apps/api/src/auth.ts`, `apps/api/test/auth.test.ts`
- Modify: `apps/api/src/routes.ts` (mount auth handler, add `customSession`), `apps/api/wrangler.toml` (vars/secrets bindings)

**Interfaces:**
- Consumes: `@labs/db` (`getDb`, schema), `@labs/types` (`providerIdEnum`).
- Produces: `createAuth(env)` returning a configured Better Auth instance; `/api/auth/*` mounted on Hono; a `customSession` that adds `githubLinked: boolean` to the session payload (derived from an `account` row with `providerId = "github"`). `AppType` now includes the auth routes.

🔴 **needs live credentials:** real verification requires edu-ID's **test/integration IdP** and the **GitHub App** OAuth credentials. Automated tests run against a mocked OIDC issuer + a seeded DB.

- [ ] **Step 1: Declare env bindings (vars + secrets)**

Append to `apps/api/wrangler.toml`:
```toml
[vars]
EDUID_ISSUER = "https://eduid.ch/idp/profile/oidc"   # test issuer in dev (.dev.vars)
BETTER_AUTH_URL = "http://localhost:8787"
# Secrets (wrangler secret put / .dev.vars): EDUID_CLIENT_ID, EDUID_CLIENT_SECRET,
#   GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, BETTER_AUTH_SECRET
```

Add to `apps/api/src/routes.ts` `Env` type: `EDUID_ISSUER`, `EDUID_CLIENT_ID`, `EDUID_CLIENT_SECRET`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (all `string`).

- [ ] **Step 2: Write the failing tests**

`apps/api/test/auth.test.ts`:
```ts
import { env } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";
import worker from "../src/index";
import { getDb, account, user } from "@labs/db";

async function seedUser() {
  const db = getDb(env.DB);
  await db.insert(user).values({
    id: "u1", name: "Test", email: "t@heig-vd.ch", emailVerified: true,
    image: null, createdAt: new Date(), updatedAt: new Date(),
  });
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM account; DELETE FROM session; DELETE FROM user;");
});

test("unauthenticated GitHub link attempt is rejected", async () => {
  const res = await worker.fetch(
    new Request("https://x/api/auth/link-social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "github" }),
    }),
    env,
  );
  expect(res.status).toBe(401);
});

test("githubLinked is false with no github account, true once linked", async () => {
  await seedUser();
  const db = getDb(env.DB);
  // simulate a completed GitHub link
  await db.insert(account).values({
    id: "a1", userId: "u1", providerId: "github", accountId: "42",
    accessToken: "t", refreshToken: null, accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null, scope: "read:org", idToken: null,
    password: null, createdAt: new Date(), updatedAt: new Date(),
  });
  const rows = await db.select().from(account);
  expect(rows.some((r) => r.userId === "u1" && r.providerId === "github")).toBe(true);
});
```

> These two tests pin the **observable invariants** we control without a live IdP: unauthenticated link is rejected, and "linked" is exactly "a `github` account row exists". The full edu-ID sign-in round-trip is exercised at the human gate against the test IdP.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @labs/api test test/auth.test.ts`
Expected: FAIL — `/api/auth/*` not mounted (404, not 401) and `account` import path unused.

- [ ] **Step 4: Implement Better Auth config**

`apps/api/src/auth.ts`:
```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { customSession, genericOAuth } from "better-auth/plugins";
import { account, getDb } from "@labs/db";
import { eq } from "drizzle-orm";
import type { Env } from "./routes";

export function createAuth(env: Env) {
  const db = getDb(env.DB);
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "sqlite" }),
    advanced: {
      cookies: { sessionToken: { attributes: { sameSite: "lax", secure: true, httpOnly: true } } },
    },
    account: { accountLinking: { enabled: true, trustedProviders: ["eduid", "github"] } },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: "eduid",
            discoveryUrl: `${env.EDUID_ISSUER}/.well-known/openid-configuration`,
            clientId: env.EDUID_CLIENT_ID,
            clientSecret: env.EDUID_CLIENT_SECRET,
            scopes: ["openid", "profile", "email"],
          },
          {
            providerId: "github",
            authorizationUrl: "https://github.com/login/oauth/authorize",
            tokenUrl: "https://github.com/login/oauth/access_token",
            clientId: env.GITHUB_OAUTH_CLIENT_ID,
            clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
            scopes: ["read:org", "read:user", "user:email"],
          },
        ],
      }),
      customSession(async ({ user: u, session }) => {
        const linked = await db
          .select({ id: account.id })
          .from(account)
          .where(eq(account.userId, u.id));
        const githubLinked = linked.length > 0
          ? (await db.select().from(account).where(eq(account.userId, u.id)))
              .some((a) => a.providerId === "github")
          : false;
        return { user: u, session, githubLinked };
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
```

`apps/api/src/routes.ts` (modify — mount auth before other routes):
```ts
import { Hono } from "hono";
import { createAuth } from "./auth";

export type Env = {
  DB: D1Database;
  EDUID_ISSUER: string;
  EDUID_CLIENT_ID: string;
  EDUID_CLIENT_SECRET: string;
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
};

const app = new Hono<{ Bindings: Env }>();

export const routes = app
  .on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw))
  .get("/api/health", (c) => c.json({ ok: true } as const));

export type AppType = typeof routes;
```

Add Better Auth deps to `apps/api/package.json` dependencies: `"better-auth": "^1.1.0"`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @labs/api test`
Expected: PASS (health + 2 auth tests). The unauth link now returns 401 from Better Auth.

- [ ] **Step 6: Run `@better-auth/cli generate` and diff against the schema**

Run: `pnpm dlx @better-auth/cli@latest generate --config apps/api/src/auth.ts`
Expected: the generated schema matches `packages/db/src/schema.ts` (no structural drift). Reconcile any diff into `packages/db` and regenerate the migration if needed.

- [ ] **Step 7: Commit**

```bash
git add apps/api packages/db
git commit -m "feat(api): better-auth edu-ID OIDC login + GitHub App linking + customSession"
```

**Automated gate:** full suite green.
**Human gate:** 🔴 **REQUIRED** — with edu-ID **test IdP** + GitHub App OAuth creds in `.dev.vars`, run `pnpm --filter @labs/api dev` and complete a real edu-ID sign-in and a real GitHub link; confirm a `user` row + an `eduid` and a `github` `account` row are created, and `githubLinked` flips true. Approve only after this works end-to-end.

---

### Task 6: `apps/www` — React Router 7 SPA scaffold + auth client + typed API client

**Files:**
- Create: `apps/www/package.json`, `apps/www/tsconfig.json`, `apps/www/vite.config.ts`, `apps/www/react-router.config.ts`, `apps/www/app/root.tsx`, `apps/www/app/routes.ts`, `apps/www/app/routes/_index.tsx`, `apps/www/app/lib/auth.ts`, `apps/www/app/lib/api.ts`

**Interfaces:**
- Consumes: `@labs/api` (`type AppType` only — type import).
- Produces: `authClient` (`better-auth/react`) with `useSession`, `signIn`, `linkSocial`, `listAccounts`; `api = hc<AppType>(...)` typed client; an index route rendering the login button.

- [ ] **Step 1: Package, vite, react-router config**

`apps/www/package.json`:
```json
{
  "name": "@labs/www",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "typecheck": "react-router typegen && tsc --noEmit",
    "test": "vitest run",
    "build": "react-router build",
    "dev": "react-router dev"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router": "^7.0.0",
    "better-auth": "^1.1.0",
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "@labs/api": "workspace:*",
    "@react-router/dev": "^7.0.0",
    "vite": "^5.4.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "jsdom": "^25.0.0"
  }
}
```

`apps/www/react-router.config.ts`:
```ts
import type { Config } from "@react-router/dev/config";
export default { ssr: false } satisfies Config;
```

`apps/www/vite.config.ts`:
```ts
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter(), tailwindcss()],
  resolve: { alias: { "~": "/app" } },
});
```

`apps/www/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "jsx": "react-jsx",
    "paths": { "~/*": ["./app/*"] },
    "types": ["@react-router/dev"]
  },
  "include": ["app", "test", ".react-router/types"]
}
```

- [ ] **Step 2: Auth + API clients**

`apps/www/app/lib/auth.ts`:
```ts
import { createAuthClient } from "better-auth/react";
import { genericOAuthClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [genericOAuthClient()],
});

export const { useSession, signIn, linkSocial, listAccounts, signOut } = authClient;
```

`apps/www/app/lib/api.ts`:
```ts
import { hc } from "hono/client";
import type { AppType } from "@labs/api";

export const api = hc<AppType>(window.location.origin);
```

- [ ] **Step 3: Root + index route (login state)**

`apps/www/app/routes.ts`:
```ts
import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("onboarding/github", "routes/onboarding.github.tsx"),
] satisfies RouteConfig;
```

`apps/www/app/root.tsx`:
```tsx
import { Links, Meta, Outlet, Scripts } from "react-router";

export default function Root() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
```

`apps/www/app/routes/_index.tsx`:
```tsx
import { signIn } from "~/lib/auth";

export default function Index() {
  return (
    <main>
      <h1>labs</h1>
      <button
        type="button"
        onClick={() => signIn.oauth2({ providerId: "eduid", callbackURL: "/" })}
      >
        Sign in with SWITCH edu-ID
      </button>
    </main>
  );
}
```

(Stub `apps/www/app/routes/onboarding.github.tsx` so the route resolves; it is fully built in Task 8.)
```tsx
export default function OnboardingGithub() {
  return <main>Onboarding</main>;
}
```

- [ ] **Step 4: Typecheck (proves the type chain links)**

Run: `pnpm --filter @labs/www typecheck`
Expected: PASS — `hc<AppType>` resolves against `@labs/api`'s exported type.

- [ ] **Step 5: Commit**

```bash
git add apps/www
git commit -m "feat(www): react-router 7 SPA scaffold, auth + typed hono clients, login screen"
```

**Automated gate:** full suite green (incl. `react-router build`).
**Human gate:** 🟢 routine; UX of the login screen is refined in Task 8.

---

### Task 7: `apps/www` — route guard enforcing auth + GitHub-linked invariant

**Files:**
- Create: `apps/www/app/components/route-guard.tsx`, `apps/www/test/route-guard.test.tsx`, `apps/www/vitest.config.ts`, `apps/www/test/setup.ts`
- Modify: `apps/www/app/root.tsx` (wrap `<Outlet/>` in the guard)

**Interfaces:**
- Consumes: `useSession`, `listAccounts` from `~/lib/auth`.
- Produces: `<RouteGuard>` that, for an authenticated user with **no** linked GitHub on a route ≠ `/onboarding/github`, redirects to `/onboarding/github`; renders children otherwise.

- [ ] **Step 1: Vitest config + setup for jsdom**

`apps/www/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"], globals: true },
  resolve: { alias: { "~": "/app" } },
});
```

`apps/www/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 2: Write the failing test**

`apps/www/test/route-guard.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const navigate = vi.fn();
vi.mock("react-router", () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: "/" }),
}));
vi.mock("~/lib/auth", () => ({
  useSession: () => ({ data: { user: { id: "u1" }, githubLinked: false }, isPending: false }),
}));

import { RouteGuard } from "~/components/route-guard";

test("authed-but-unlinked user is redirected to onboarding", () => {
  render(<RouteGuard><div>home</div></RouteGuard>);
  expect(navigate).toHaveBeenCalledWith("/onboarding/github", { replace: true });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @labs/www test`
Expected: FAIL — cannot find `~/components/route-guard`.

- [ ] **Step 4: Implement the guard**

`apps/www/app/components/route-guard.tsx`:
```tsx
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useSession } from "~/lib/auth";

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isPending || !data?.user) return;
    const onOnboarding = location.pathname === "/onboarding/github";
    if (!data.githubLinked && !onOnboarding) {
      navigate("/onboarding/github", { replace: true });
    }
  }, [data, isPending, location.pathname, navigate]);

  return <>{children}</>;
}
```

`apps/www/app/root.tsx` (wrap the outlet):
```tsx
import { Links, Meta, Outlet, Scripts } from "react-router";
import { RouteGuard } from "~/components/route-guard";

export default function Root() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <Meta />
        <Links />
      </head>
      <body>
        <RouteGuard>
          <Outlet />
        </RouteGuard>
        <Scripts />
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @labs/www test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/www
git commit -m "feat(www): route guard enforcing auth + mandatory GitHub link"
```

**Automated gate:** full suite green.
**Human gate:** 🟢 routine.

---

### Task 8: `apps/www` — the three states (login, onboarding gate, authed shell) 🔴

**Files:**
- Create: `apps/www/app/components/app-shell.tsx`; add shadcn primitives (`button`, `avatar`) under `apps/www/app/components/ui/`
- Modify: `apps/www/app/routes/_index.tsx` (authed shell vs login), `apps/www/app/routes/onboarding.github.tsx` (real link button)
- Test: `apps/www/test/onboarding.test.tsx`

**Interfaces:**
- Consumes: `useSession`, `signIn`, `signOut`, `linkSocial`.
- Produces: index renders **login** (unauth) or **authed shell** (top bar: name, GitHub avatar/login, sign-out + home placeholder); onboarding renders a single **Link your GitHub account** button calling `linkSocial`/`signIn.oauth2({providerId:"github"})`.

- [ ] **Step 1: Initialize shadcn + Tailwind entry**

Run: `pnpm --filter @labs/www dlx shadcn@latest init` then add `button` and `avatar`. Create `apps/www/app/app.css` with the Tailwind 4 import and reference it from `root.tsx` via `links`.

- [ ] **Step 2: Write the failing test for the onboarding button**

`apps/www/test/onboarding.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

const linkSocial = vi.fn();
vi.mock("~/lib/auth", () => ({ linkSocial, signIn: { oauth2: vi.fn() } }));

import OnboardingGithub from "~/routes/onboarding.github";

test("clicking link starts the GitHub link flow", async () => {
  render(<OnboardingGithub />);
  await userEvent.click(screen.getByRole("button", { name: /link your github/i }));
  expect(linkSocial).toHaveBeenCalledWith({ provider: "github", callbackURL: "/" });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @labs/www test test/onboarding.test.tsx`
Expected: FAIL — onboarding renders the Task-6 stub, no button.

- [ ] **Step 4: Implement onboarding + authed shell + index branching**

`apps/www/app/routes/onboarding.github.tsx`:
```tsx
import { linkSocial } from "~/lib/auth";

export default function OnboardingGithub() {
  return (
    <main>
      <h1>One more step</h1>
      <button
        type="button"
        onClick={() => linkSocial({ provider: "github", callbackURL: "/" })}
      >
        Link your GitHub account
      </button>
    </main>
  );
}
```

`apps/www/app/components/app-shell.tsx`:
```tsx
import { signOut } from "~/lib/auth";

export function AppShell({ name, githubLogin }: { name: string; githubLogin?: string }) {
  return (
    <div>
      <header>
        <span>{name}</span>
        {githubLogin ? <span>@{githubLogin}</span> : null}
        <button type="button" onClick={() => signOut()}>Sign out</button>
      </header>
      <main>Home</main>
    </div>
  );
}
```

`apps/www/app/routes/_index.tsx`:
```tsx
import { AppShell } from "~/components/app-shell";
import { signIn, useSession } from "~/lib/auth";

export default function Index() {
  const { data, isPending } = useSession();
  if (isPending) return null;
  if (!data?.user) {
    return (
      <main>
        <h1>labs</h1>
        <button
          type="button"
          onClick={() => signIn.oauth2({ providerId: "eduid", callbackURL: "/" })}
        >
          Sign in with SWITCH edu-ID
        </button>
      </main>
    );
  }
  return <AppShell name={data.user.name} />;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @labs/www test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/www
git commit -m "feat(www): login, onboarding gate, and authed shell states"
```

**Automated gate:** full suite green.
**Human gate:** 🔴 **REQUIRED** — run `dev`, eyeball all three states; confirm the zero-friction bar (one button each) and that the top bar shows name + GitHub identity. Frontend-design polish is acceptable as a follow-up but the states must be correct.

---

### Task 9: Same-origin Worker — serve built SPA assets + `/api/*`, end-to-end smoke 🔴

**Files:**
- Modify: `apps/api/wrangler.toml` (assets binding + SPA fallback), `apps/api/src/index.ts` (fall through to assets), root `package.json` (ordered build)

**Interfaces:**
- Consumes: the `apps/www` build output; the Hono `routes`.
- Produces: one Worker that serves `/api/*` via Hono and everything else from the SPA build (`index.html` fallback for client routes) — one origin, first-party cookies.

- [ ] **Step 1: Wire the assets binding**

Append to `apps/api/wrangler.toml`:
```toml
[assets]
directory = "../www/build/client"
binding = "ASSETS"
not_found_handling = "single-page-application"
```

Add `ASSETS: Fetcher` to the `Env` type in `routes.ts`.

- [ ] **Step 2: Fall through to assets for non-API routes**

`apps/api/src/index.ts`:
```ts
import { routes } from "./routes";
import type { Env } from "./routes";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      return routes.fetch(req, env, ctx);
    }
    return env.ASSETS.fetch(req);
  },
};
```

- [ ] **Step 3: Ordered build script**

Root `package.json` scripts:
```json
"build": "pnpm --filter @labs/www build && pnpm --filter @labs/api build"
```

- [ ] **Step 4: Verify the build produces one deployable Worker**

Run: `pnpm build`
Expected: `apps/www/build/client` exists; `wrangler deploy --dry-run` for `apps/api` resolves the assets directory without error.

- [ ] **Step 5: Commit**

```bash
git add apps/api package.json
git commit -m "feat: serve SPA assets + /api from one Worker (same-origin)"
```

**Automated gate:** `pnpm build` green; full test suite green.
**Human gate:** 🔴 **REQUIRED** — provision a real D1 (`wrangler d1 create labs`, apply migrations), set the real `database_id`, run `wrangler dev`, and walk the full skeleton in a browser: edu-ID login → forced GitHub link → authed home, same origin, session cookie present. This is the M1 acceptance walk.

---

### Task 10: CI — full gate + the type-safety guard

**Files:**
- Create: `.github/workflows/ci.yml`, `apps/www/test/typesafety.md` (documents the guard)

**Interfaces:**
- Consumes: all package scripts.
- Produces: a CI workflow running biome + typecheck + test + build, and a dedicated job proving a deliberate `packages/db` schema change breaks `apps/www` typecheck.

- [ ] **Step 1: Write the CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm biome check .
      - run: pnpm -r typecheck
      - run: pnpm -r test
      - run: pnpm -r build
  type-safety-guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: A response-shaping schema change must break www typecheck
        run: |
          sed -i 's/name: text("name").notNull()/fullName: text("name").notNull()/' packages/db/src/schema.ts
          if pnpm --filter @labs/www typecheck; then
            echo "Expected www typecheck to FAIL after renaming user.name → fullName"; exit 1
          else
            echo "Guard holds: schema change broke the frontend typecheck"; fi
```

> The guard renames `user.name`, which `AppShell` consumes via the inferred session type, so `apps/www` typecheck must fail. If it passes, the type chain is broken and CI fails.

- [ ] **Step 2: Run the guard locally to confirm it behaves**

Run the `sed` + `pnpm --filter @labs/www typecheck` locally; confirm it FAILS, then `git checkout packages/db/src/schema.ts` to restore.
Expected: typecheck fails on the renamed field; restored after checkout.

- [ ] **Step 3: Commit**

```bash
git add .github apps/www/test/typesafety.md
git commit -m "ci: full gate + end-to-end type-safety guard"
```

**Automated gate:** push to a branch; CI `verify` and `type-safety-guard` jobs both green.
**Human gate:** 🟢 confirm CI is green on the PR; this closes M1.

---

## M1 self-review (spec coverage)

- edu-ID OIDC login → Task 5. Mandatory GitHub link → Tasks 5 (server) + 7 (guard) + 8 (UI). Same-origin Worker → Task 9. End-to-end type safety + CI guard → Tasks 6 + 10. Better Auth tables only, no app tables → Task 2. Three frontend states → Tasks 6 + 8. Tests (API/types/frontend) → Tasks 4/5/7/8. **All Slice-1 scope items map to a task.**
- Out of M1 (correctly deferred): org connect, enrollment, groups, labs, dashboard (M2–M5).

---

# Milestone 2 — Class & enrollment (S2) — outline

> Expanded to a full plan when M1 is approved. Tasks (each: TDD + automated gate + human gate):

1. **`classes` table** — add plural app table (`id`, `orgId` unique, `installationId`, `connectedByUserId`, `joinToken` unique, `status`) to `packages/db`; migration; entity type. *(Data-model §2.)*
2. **GitHub App installation client** — Octokit App in `apps/api` (`appId` + `privateKey` secrets); installation-token helper keyed on `orgId`. 🔴 needs GitHub App.
3. **Connect a class** — `GET /user/installations` list; install callback records the `classes` row; **set base permission `No access`** (`PATCH /orgs/{org}`) + re-verify on a confirm page. *(Flows §3.4.)* 🔴
4. **`installation` webhook** — verify signature; drive `status` active/archived; refresh `installationId`. *(Foundation §2.)*
5. **Live people view** — read org Owners/Members live; split teachers/students. *(Flows §3.6.)*
6. **Join link (teacher)** — generate/regenerate `joinToken`; copy-link UI. *(Flows §3.5.)*
7. **Join a class (student)** — open link → `PUT /orgs/{org}/memberships/{username}` (installation token) → redirect to `github.com/orgs/{org}/invitation`; idempotent if already member; resume if not yet signed-in/linked. *(Flows §3.8.)* 🔴 validate the invite-creation capability.
8. **Student home (shell)** — by-class sections listing classes where the user is a Member (live); empty state. *(Flows §3.9; labs rows arrive in M4.)*

---

# Milestone 3 — Groups (S3) — outline

1. **`groups` table** — `id`, `classId`, `ghTeamId` unique, `ghTeamSlug`, `name`, `creatorUserId`. *(Data-model §2.)*
2. **Team lifecycle client** — create (`privacy: secret`), add/remove member (students always `member`), grant repo, delete; collision-safe slug generator. *(Groups-teams §2.)* 🔴
3. **Create group + invite grid** — class roster grid; greyed-out = already in a group for the lab in question. *(Flows §3.10.)*
4. **Join / leave / remove** — join if under max; member leaves; creator removes; creator-or-teacher deletes. Min/max Labs-enforced. *(Groups-teams §1.)*
5. **Reconcile-on-read** — drift detection (404 deleted, rename, size) surfaced as a mismatch; no team/membership webhooks. *(Groups-teams §4.)*

---

# Milestone 4 — Labs (S4) — outline

1. **`labs` table** — `id`, `classId`, `title`, `templateRepoId` null, `templateRepoFullName` null, `deadline` (required), `groupMode`, `min/maxMembers`, `createdByUserId`. *(Data-model §2.)*
2. **`student_lab_repos` table** — `id`, `labId`, `groupId` (always set), `ghRepoId` unique, `ghRepoFullName`; unique `(labId, groupId)`. *(Data-model §2.)*
3. **Create a lab** — optional template (ensure `is_template`), required deadline, group settings; visible on create. *(Flows §3.7.)*
4. **Accept — individual** — create team-of-one; generate repo (template `/generate` or empty `POST /orgs/{org}/repos`); grant team. *(Flows §3.11.)* 🔴
5. **Accept — group** — reuse / join / create order; finalize → repo per group; grant team. Inline drawer on student home. *(Flows §3.9 + §3.11.)*
6. **Lab standing on student home** — accepted state, repo link, group + member avatars (live). *(Flows §3.9.)*

---

# Milestone 5 — Teacher dashboard (S5) — outline

1. **Aggregation read** — join GitHub (repos/teams/members, live) with lab metadata; filterable layout. *(Flows §3.12.)*
2. **Per-lab rollup** — groups, student repos, acceptance status; anchored by `student_lab_repos`.
3. **Performance** — short-TTL caching of live GitHub reads (cache, not authority); document any coverage caps.

---

## Execution

Per the **Validation Model**: every task ends with the automated gate **and** your explicit approval. Tasks tagged 🔴 require exercising the real edu-ID / GitHub flow before approval. Tick the **Progress Tracker** rows above after each gate.

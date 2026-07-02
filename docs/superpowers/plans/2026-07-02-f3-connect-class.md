# F3 — Teacher connects a class · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This is **Feature 3** of the labs build; the parent plan + Progress Tracker live in `docs/superpowers/plans/2026-06-30-labs-implementation.md`. Design spec: `docs/superpowers/specs/2026-07-02-f3-connect-class-design.md`. **Commit per task** (commit-per-milestone mode; NO `Co-Authored-By` trailer).

**Goal:** A signed-in teacher connects a GitHub organization they own as a "class" — installing the labs GitHub App on the org writes a thin `classes` row, and the app sets the org's base repository permission to "No access".

**Architecture:** The org's *existence* is owned by GitHub (the App installation); we keep a thin `classes` row keyed on the stable `orgId`. The install Setup-URL callback attributes the row to the signed-in user (first-party cookie) and resolves the org via the App JWT. Org writes use an **installation token** (Octokit App), never the user token. Name/avatar/members are read live; staleness of `installationId` is reconciled on read (no webhook in F3).

**Tech Stack:** Hono on Cloudflare Workers, Better Auth (session), Drizzle + D1, `@octokit/app` (Workers-compatible App auth), React Router 7 SPA, `hc<AppType>` typed client, Vitest, Biome.

## Global Constraints

Apply to every task (copied from the spec + parent plan):

- **Package scope:** `@labs/*`. **Biome:** double quotes, semicolons, 2-space indent, 80 cols.
- **Type safety, no codegen:** Drizzle `$inferSelect`/`$inferInsert` for entities; zod for request **inputs** only where a feature validates input; response types **inferred** via `hc<AppType>` — never hand-declare a response shape.
- **DB naming:** app-domain tables **plural** (`classes`). Better Auth tables keep their singular library names.
- **Same-origin:** SPA + API one origin; session cookie secure, httpOnly, `SameSite=Lax`.
- **Secrets are Worker secrets** (never in code/responses/logs): `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM). Existing `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` (user OAuth) unchanged.
- **Delegate to GitHub:** store only the thin anchor; read name/avatar/members live.
- **Least privilege:** org writes/reads use the **installation** token; the **user** token is only for `GET /user/installations`.
- **Tooling-driven:** install deps with `pnpm add <pkg>@latest`; migrations via `drizzle-kit`. Present each tooling command before running.
- **Tests:** only OUR logic gets tests (middleware, DB helpers, route behavior with mocked Octokit). CLI-generated/declarative schema gets none.

## Prerequisite (manual, human — do before Task 5's human gate)

In the GitHub App settings (App is on a personal account for now):
- **Organization permissions:** `Administration: Read & write` (+ `Members: Read & write` for F4). **Repository → Metadata: Read** (implicit).
- **Installation target:** allow installation on organizations.
- **Setup URL:** `https://localhost:3000/api/github/setup`, "Redirect on update" ON.
- Generate a **private key**; put `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` (full PEM, `\n` preserved) in `apps/api/.dev.vars`.
- Note the App **slug** (from the App's public page URL) for the install link.

## File Structure

- `packages/db/src/schema.ts` — add the `classes` table (hand-owned barrel; app tables live here, not in CLI-generated `auth-schema.ts`).
- `packages/db/src/classes.ts` (new) — typed query helpers (`upsertClassByOrgId`, `listClassesByUser`, `refreshInstallationId`).
- `packages/db/migrations/…` — generated migration.
- `apps/api/src/github.ts` (new) — `createAppClient(env)` + installation/app-JWT Octokit helpers.
- `apps/api/src/require-auth.ts` (new) — `requireAuth` middleware + `AuthedEnv`.
- `apps/api/src/routes/setup.ts` (new) — `GET /api/github/setup`.
- `apps/api/src/routes/classes.ts` (new) — `POST /api/classes/:id/confirm`, `GET /api/classes`.
- `apps/api/src/routes.ts` — mount the new route modules (extends `AppType`).
- `apps/api/src/auth.ts` (`AuthEnv`) — add the two App secrets to the env type.
- `apps/www/app/pages/home-page.tsx` — connect button + class list.
- `apps/www/app/components/custom/class-card.tsx` (new) — org avatar + name row.
- `apps/www/app/pages/class-confirm-page.tsx` + `app/routes/class-confirm.tsx` (new) — confirm page + route.
- `apps/www/app/routes.ts` — register the confirm route.

---

### Task 1: `classes` table + migration

**Files:** Modify `packages/db/src/schema.ts`; generate `packages/db/migrations/000X_*.sql`.

**Interfaces produced:** `classes` table; `Class = typeof classes.$inferSelect` exported from `@labs/db`.

- [ ] **Step 1: Add the table** — in `packages/db/src/schema.ts`, after `export * from "./auth-schema";`:

```ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

/** A connected class = a thin anchor to a GitHub org App installation (F3). */
export const classes = sqliteTable("classes", {
  id: text("id").primaryKey(),
  // Stable GitHub org account id — the real key (survives reinstall).
  orgId: integer("org_id").notNull().unique(),
  // Refreshable: changes on reinstall (reconciled on read).
  installationId: integer("installation_id").notNull(),
  connectedByUserId: text("connected_by_user_id")
    .notNull()
    .references(() => user.id),
  status: text("status", { enum: ["active", "archived"] })
    .notNull()
    .default("active"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

- [ ] **Step 2: Export the inferred type** — in `packages/db/src/index.ts` add:

```ts
export type Class = typeof schema.classes.$inferSelect;
```

- [ ] **Step 3: Generate the migration** — present, then run: `pnpm --filter @labs/db db:generate`. Expect a new `migrations/000X_*.sql` with `CREATE TABLE classes` (unique on `org_id`).

- [ ] **Step 4: Apply locally** — `pnpm --filter @labs/api exec wrangler d1 migrations apply labs --local`.

- [ ] **Step 5: Automated gate** — `pnpm run biome && pnpm -r typecheck` green. No test (declarative schema).

- [ ] **Step 6: Commit** — `git add packages/db && git commit -m "feat(db): add classes table + migration"`

**Human gate:** 🟢 confirm only the 6 minimal columns exist; unique on `org_id`.

---

### Task 2: Octokit App client + secret env

**Files:** Create `apps/api/src/github.ts`; modify `apps/api/src/auth.ts` (`AuthEnv`), `apps/api/wrangler.jsonc` (none — secrets only), `apps/api/.dev.vars` (human).

**Interfaces produced:** `createAppClient(env): App`; `appJwtOctokit(env)`; `installationOctokit(env, installationId): Promise<Octokit>`.

- [ ] **Step 1: Install** — present, then: `pnpm --filter @labs/api add @octokit/app`.

- [ ] **Step 2: Add secrets to the env type** — in `apps/api/src/auth.ts`, extend `AuthEnv`:

```ts
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
```

Re-run `pnpm --filter @labs/api run cf-typegen` if `wrangler types` is used.

- [ ] **Step 3: Implement `github.ts`**:

```ts
import { App } from "@octokit/app";
import type { AuthEnv } from "./auth";

/** The GitHub App (server-to-server). Workers-compatible: @octokit/app signs
 *  the App JWT with Web Crypto. */
export function createAppClient(env: AuthEnv): App {
  return new App({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
  });
}

/** App-JWT client — for App-level reads like GET /app/installations/{id}. */
export function appJwtOctokit(env: AuthEnv) {
  return createAppClient(env).octokit;
}

/** Installation-scoped client — for org reads/writes with least privilege. */
export async function installationOctokit(
  env: AuthEnv,
  installationId: number,
) {
  return createAppClient(env).getInstallationOctokit(installationId);
}
```

- [ ] **Step 4: Automated gate** — `pnpm run biome && pnpm --filter @labs/api typecheck` green. (No unit test — construction is config; exercised via mocked Octokit in later tasks and the live gate.)

- [ ] **Step 5: Commit** — `git add apps/api && git commit -m "feat(api): GitHub App (Octokit) client + secret env"`

**Human gate:** 🟢 (live App auth exercised in Task 10).

---

### Task 3: `requireAuth` middleware + `AuthedEnv`

**Files:** Create `apps/api/src/require-auth.ts`, `apps/api/test/require-auth.test.ts`.

**Interfaces produced:** `requireAuth` (Hono middleware); `AuthedEnv` = `{ Bindings: AuthEnv; Variables: { user: User } }`.

- [ ] **Step 1: Failing test** — `apps/api/test/require-auth.test.ts`:

```ts
import { Hono } from "hono";
import { expect, test, vi } from "vitest";
import { requireAuth } from "../src/require-auth";

vi.mock("../src/auth", () => ({
  createAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) =>
        headers.get("x-test-user")
          ? { user: { id: headers.get("x-test-user") } }
          : null,
    },
  }),
}));

const app = new Hono().use("/p", requireAuth).get("/p", (c) =>
  c.json({ id: c.get("user").id }),
);

test("401 without a session", async () => {
  const res = await app.request("/p");
  expect(res.status).toBe(401);
});

test("passes the user through when signed in", async () => {
  const res = await app.request("/p", { headers: { "x-test-user": "u1" } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: "u1" });
});
```

- [ ] **Step 2: Run → fails** — `pnpm --filter @labs/api test` → cannot find `../src/require-auth`.

- [ ] **Step 3: Implement** — `apps/api/src/require-auth.ts`:

```ts
import type { User } from "@labs/db";
import { createMiddleware } from "hono/factory";
import type { AuthEnv } from "./auth";
import { createAuth } from "./auth";

export type AuthedEnv = { Bindings: AuthEnv; Variables: { user: User } };

/** Loads the Better Auth session; 401 if absent, else sets a non-null user. */
export const requireAuth = createMiddleware<AuthedEnv>(async (c, next) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("user", session.user as User);
  await next();
});
```

- [ ] **Step 4: Run → passes** — `pnpm --filter @labs/api test`.

- [ ] **Step 5: Automated gate** — biome + typecheck + test green.

- [ ] **Step 6: Commit** — `git add apps/api && git commit -m "feat(api): requireAuth middleware + AuthedEnv"`

**Human gate:** 🟢.

---

### Task 4: `classes` DB helpers

**Files:** Create `packages/db/src/classes.ts`, `packages/db/test/classes.test.ts`; export from `packages/db/src/index.ts`.

**Interfaces produced (all take `db = getDb(...)`):**
- `upsertClassByOrgId(db, { id, orgId, installationId, connectedByUserId, now }): Promise<Class>` — insert or, on `orgId` conflict, update `installationId` + `status:"active"` + `updatedAt`.
- `listClassesByUser(db, userId): Promise<Class[]>`.
- `getClassById(db, id): Promise<Class | undefined>`.
- `refreshInstallationId(db, orgId, installationId, now): Promise<void>`.

- [ ] **Step 1: Failing test** — `packages/db/test/classes.test.ts` (uses an in-memory better-sqlite3 drizzle db or the Workers pool; mirror the pattern already used in `@labs/db` tests). Assert: first `upsertClassByOrgId` inserts; second call with the same `orgId` updates `installationId` (no duplicate row); `listClassesByUser` returns only that user's rows.

```ts
import { expect, test } from "vitest";
import { makeTestDb } from "./helpers"; // create if not present: drizzle over in-memory sqlite + push schema
import { listClassesByUser, upsertClassByOrgId } from "../src/classes";

test("upsert is keyed on orgId (reinstall updates, no duplicate)", async () => {
  const db = await makeTestDb();
  const now = new Date(0);
  await upsertClassByOrgId(db, { id: "c1", orgId: 42, installationId: 100, connectedByUserId: "u1", now });
  await upsertClassByOrgId(db, { id: "c2", orgId: 42, installationId: 200, connectedByUserId: "u1", now });
  const rows = await listClassesByUser(db, "u1");
  expect(rows).toHaveLength(1);
  expect(rows[0].installationId).toBe(200);
});
```

> If a shared test-db helper doesn't exist yet, add `packages/db/test/helpers.ts` creating a drizzle instance over an in-memory sqlite and applying the migration SQL. This is the FIRST real `@labs/db` logic test — add `vitest` + the `test` script + `test/` include to `packages/db` here (deferred until now per the no-tests-for-generated-code policy).

- [ ] **Step 2: Run → fails**.

- [ ] **Step 3: Implement** — `packages/db/src/classes.ts`:

```ts
import { eq } from "drizzle-orm";
import type { getDb } from "./index";
import { classes } from "./schema";

type Db = ReturnType<typeof getDb>;

export async function upsertClassByOrgId(
  db: Db,
  args: { id: string; orgId: number; installationId: number; connectedByUserId: string; now: Date },
) {
  const [row] = await db
    .insert(classes)
    .values({
      id: args.id,
      orgId: args.orgId,
      installationId: args.installationId,
      connectedByUserId: args.connectedByUserId,
      status: "active",
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoUpdate({
      target: classes.orgId,
      set: { installationId: args.installationId, status: "active", updatedAt: args.now },
    })
    .returning();
  return row;
}

export async function listClassesByUser(db: Db, userId: string) {
  return db.select().from(classes).where(eq(classes.connectedByUserId, userId));
}

export async function getClassById(db: Db, id: string) {
  const [row] = await db.select().from(classes).where(eq(classes.id, id));
  return row;
}

export async function refreshInstallationId(db: Db, orgId: number, installationId: number, now: Date) {
  await db.update(classes).set({ installationId, updatedAt: now }).where(eq(classes.orgId, orgId));
}
```

- [ ] **Step 4: Run → passes**. **Step 5: Gate** biome+typecheck+test. **Step 6: Commit** `feat(db): classes query helpers`.

**Human gate:** 🟢.

---

### Task 5: `GET /api/github/setup` (install callback)

**Files:** Create `apps/api/src/routes/setup.ts`, `apps/api/test/setup.test.ts`; mount in `apps/api/src/routes.ts`.

**Interfaces produced:** route `GET /api/github/setup?installation_id&setup_action&state` → 302 to `/classes/{id}/confirm` (or `/` on skip). Attributes `connectedByUserId` from the session; resolves org via app-JWT `GET /app/installations/{id}`.

**Consumes:** `appJwtOctokit` (Task 2), `upsertClassByOrgId` (Task 4), `createAuth` session.

- [ ] **Step 1: Failing test** — mock `../src/github` (`appJwtOctokit` → `{ request: async () => ({ data: { account: { id: 42, login: "acme", type: "Organization" } } }) }`), mock session present, mock `getDb`/`upsertClassByOrgId`. Assert: with `installation_id=100`, the handler upserts a class (orgId 42) and returns 302 to `/classes/<id>/confirm`. Assert 302→login when no session. Assert reject (no row, 4xx or redirect with error) when `account.type !== "Organization"`.

- [ ] **Step 2: Run → fails**.

- [ ] **Step 3: Implement** — `apps/api/src/routes/setup.ts` (id via `crypto.randomUUID()`):

```ts
import { getDb, upsertClassByOrgId } from "@labs/db";
import { Hono } from "hono";
import { createAuth, type Env } from "../auth";
import { appJwtOctokit } from "../github";

export const setupRoutes = new Hono<Env>().get("/github/setup", async (c) => {
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.redirect("/"); // login gate on the SPA takes over
  const installationId = Number(c.req.query("installation_id"));
  if (!installationId) return c.redirect("/?error=no_installation");

  const { data } = await appJwtOctokit(c.env).request(
    "GET /app/installations/{installation_id}",
    { installation_id: installationId },
  );
  if (data.account?.type !== "Organization") {
    return c.redirect("/?error=not_an_org");
  }

  const cls = await upsertClassByOrgId(getDb(c.env.DB), {
    id: crypto.randomUUID(),
    orgId: data.account.id,
    installationId,
    connectedByUserId: session.user.id,
    now: new Date(),
  });
  return c.redirect(`/classes/${cls.id}/confirm`);
});
```

- [ ] **Step 4: Mount** — in `apps/api/src/routes.ts`, chain `.route("/api", setupRoutes)` so the path is `/api/github/setup`; keep `AppType = typeof routes`.

- [ ] **Step 5: Run → passes. Step 6: Gate. Step 7: Commit** `feat(api): GitHub App install setup callback`.

**Human gate:** 🔴 (real install exercised in Task 10).

---

### Task 6: `POST /api/classes/:id/confirm` (set base permission)

**Files:** Create `apps/api/src/routes/classes.ts`, `apps/api/test/classes-confirm.test.ts`; mount in `routes.ts`.

**Interfaces produced:** `POST /api/classes/:id/confirm` (`requireAuth`) → `{ ok: boolean; org: { login: string } }`. Sets `default_repository_permission: "none"` on the org and re-verifies.

**Consumes:** `requireAuth`/`AuthedEnv` (Task 3), `getClassById` (Task 4), `installationOctokit`/`appJwtOctokit` (Task 2).

- [ ] **Step 1: Failing test** — mock github + db: `getClassById` → `{ id:"c1", orgId:42, installationId:100 }`; app-JWT installation lookup → org login "acme"; installation client `PATCH /orgs/{org}` ok, then `GET /orgs/{org}` → `{ default_repository_permission: "none" }`. Assert 200 `{ ok:true, org:{login:"acme"} }`. Add a case where the re-`GET` returns `"read"` → `{ ok:false }`.

- [ ] **Step 2: Run → fails**.

- [ ] **Step 3: Implement** — `apps/api/src/routes/classes.ts`:

```ts
import { getClassById, getDb } from "@labs/db";
import { Hono } from "hono";
import { appJwtOctokit, installationOctokit } from "../github";
import { type AuthedEnv, requireAuth } from "../require-auth";

async function orgLogin(env: AuthedEnv["Bindings"], installationId: number) {
  const { data } = await appJwtOctokit(env).request(
    "GET /app/installations/{installation_id}",
    { installation_id: installationId },
  );
  return data.account?.login as string;
}

export const classesRoutes = new Hono<AuthedEnv>()
  .use(requireAuth)
  .post("/classes/:id/confirm", async (c) => {
    const cls = await getClassById(getDb(c.env.DB), c.req.param("id"));
    if (!cls) return c.json({ error: "not_found" }, 404);
    const login = await orgLogin(c.env, cls.installationId);
    const gh = await installationOctokit(c.env, cls.installationId);
    await gh.request("PATCH /orgs/{org}", { org: login, default_repository_permission: "none" });
    const { data } = await gh.request("GET /orgs/{org}", { org: login });
    return c.json({ ok: data.default_repository_permission === "none", org: { login } });
  });
```

- [ ] **Step 4: Mount** — `.route("/api", classesRoutes)` in `routes.ts`. **Step 5: passes. Step 6: gate. Step 7: commit** `feat(api): confirm class → set org base permission "No access"`.

**Human gate:** 🔴 (Task 10).

---

### Task 7: `GET /api/classes` (list + reconcile + live enrich)

**Files:** Modify `apps/api/src/routes/classes.ts` (add the GET), `apps/api/test/classes-list.test.ts`.

**Interfaces produced:** `GET /api/classes` (`requireAuth`) → `{ classes: Array<{ id: string; orgId: number; login: string; name: string | null; avatarUrl: string }> }`. Intersects `GET /user/installations` (user token) with our rows, refreshes stale `installationId`, enriches each with live org profile (installation token).

**Consumes:** `listClassesByUser`, `refreshInstallationId` (Task 4); user's GitHub token (read from the `account` row like `/api/me` does); `installationOctokit` (Task 2).

- [ ] **Step 1: Failing test** — mock: `listClassesByUser` → one row (orgId 42, installationId 100); user installations lookup → installation for orgId 42 with a *new* installationId 200; installation client `GET /orgs/{org}` → `{ login:"acme", name:"Acme", avatar_url:"http://a" }`. Assert response contains `{ orgId:42, login:"acme", name:"Acme", avatarUrl:"http://a" }` AND `refreshInstallationId` was called with 200.

- [ ] **Step 2: fails. Step 3: Implement** the GET on `classesRoutes`:

```ts
  .get("/classes", async (c) => {
    const db = getDb(c.env.DB);
    const rows = await listClassesByUser(db, c.get("user").id);
    // Reconcile installationId from the user's live installations.
    const token = await githubUserToken(db, c.get("user").id); // helper: read account.accessToken for providerId "github"
    const userGh = new Octokit({ auth: token });
    const { data: insts } = await userGh.request("GET /user/installations");
    const byOrg = new Map(insts.installations.map((i) => [i.account?.id, i.id]));
    const out = [];
    for (const cls of rows) {
      const liveInstall = byOrg.get(cls.orgId);
      if (!liveInstall) continue; // uninstalled — skip (archived lifecycle is a later slice)
      if (liveInstall !== cls.installationId) {
        await refreshInstallationId(db, cls.orgId, liveInstall, new Date());
      }
      const gh = await installationOctokit(c.env, liveInstall);
      const { data: org } = await gh.request("GET /orgs/{org}", { org: String(cls.orgId) });
      out.push({ id: cls.id, orgId: cls.orgId, login: org.login, name: org.name, avatarUrl: org.avatar_url });
    }
    return c.json({ classes: out });
  });
```

> Add a small `githubUserToken(db, userId)` helper (or reuse the account lookup from `me.ts` — extract it to `apps/api/src/github-user.ts` to avoid duplication). Import `Octokit` from `octokit` (already a transitive dep of `@octokit/app`; if not resolvable, `pnpm --filter @labs/api add octokit`). `GET /orgs/{org}` accepts the numeric id path — if the API requires the login, resolve it from the installation `account.login` instead (available in `insts.installations[].account.login`).

- [ ] **Step 4: passes. Step 5: gate. Step 6: commit** `feat(api): list connected classes (reconcile + live org profile)`.

**Human gate:** 🟢 (validated end-to-end in Task 10).

---

### Task 8: Frontend — home connect button + class list

**Files:** Modify `apps/www/app/pages/home-page.tsx`; create `apps/www/app/components/custom/class-card.tsx`; modify `apps/www/test/home.test.tsx`.

**Interfaces produced:** home shows a "Connect a GitHub organization" button (→ App install URL) + a live list of connected classes; `ClassCard` (org avatar + name).

**Consumes:** `hc<AppType>` via `~/lib/api` `useApi(api.api.classes)`.

- [ ] **Step 1: `ClassCard`** — `apps/www/app/components/custom/class-card.tsx`: a `Row` with `UserAvatar`-style org avatar + `Text` name/login. (Reuse `Row`, `Text`; a rounded `<img>` for the org avatar with initials fallback via the existing avatar component.)

- [ ] **Step 2: Failing test** — extend `home.test.tsx`: mock `useApi(api.api.classes)` → `{ data: { classes: [{ id:"c1", login:"acme", name:"Acme", avatarUrl:"" }] } }` and `useAuth` authed; assert "Acme" renders and a "Connect a GitHub organization" button exists.

- [ ] **Step 3: Implement** `home-page.tsx` body: keep the `BrandHeader` welcome; add

```tsx
const { data } = useApi(api.api.classes);
// button:
<Button size="lg" onClick={() => { window.location.href = `https://github.com/apps/${APP_SLUG}/installations/new`; }}>
  Connect a GitHub organization
</Button>
// list: (data?.classes ?? []).map((c) => <ClassCard key={c.id} {...c} />) with an empty-state <Text>.
```

> `APP_SLUG` is a public build-time constant (the App's slug) — add it to a small `~/lib/config.ts` (not a secret). Confirm the slug during the Task 10 walk.

- [ ] **Step 4: passes. Step 5: gate** (biome + `react-router typegen && tsc` + test + `react-router build`).

- [ ] **Step 6: 👁 Visual gate** — run `pnpm --filter @labs/www dev` (or the Worker), review the home with the connect button + (empty) class list on the real screen. **Step 7: commit** `feat(www): home connect-org button + class list`.

**Human gate:** 👁 + 🟢.

---

### Task 9: Frontend — confirm page

**Files:** Create `apps/www/app/pages/class-confirm-page.tsx`, `apps/www/app/routes/class-confirm.tsx`; modify `apps/www/app/routes.ts`; create `apps/www/test/class-confirm.test.tsx`.

**Interfaces produced:** route `/classes/:id/confirm` → confirm page: explains "No access", a button calling `POST /api/classes/:id/confirm`; on `{ok:true}` routes home, else shows the error.

- [ ] **Step 1: Register the route** — in `app/routes.ts` add `route("classes/:id/confirm", "routes/class-confirm.tsx")`.

- [ ] **Step 2: Failing test** — render the page with a mocked confirm call resolving `{ ok:true, org:{login:"acme"} }`; click the button; assert it navigates (mock `useNavigate`) / shows success. Add an `{ok:false}` branch asserting the error text renders.

- [ ] **Step 3: Implement** — page reads `:id` (`useParams`), renders `BrandHeader title="Connect {org}?"` + explanatory `Text`, and a `Button` that `POST`s via the hc client (`api.api.classes[":id"].confirm.$post({ param: { id } })`), then `useNavigate("/")` on success or setError.

- [ ] **Step 4: passes. Step 5: gate. Step 6: 👁 Visual gate** (review the confirm screen). **Step 7: commit** `feat(www): class confirm page`.

**Human gate:** 👁 + 🟢.

---

### Task 10: Live 🔴 walk (Feature 3 acceptance)

**Files:** none (config + manual).

- [ ] **Step 1** — apply the **Prerequisite** (App org permissions, installable, Setup URL, secrets in `.dev.vars`, note the slug → `~/lib/config.ts`).
- [ ] **Step 2** — `pnpm build` + `pnpm --filter @labs/api dev` (HTTPS:3000).
- [ ] **Step 3** — as a signed-in user, click **Connect a GitHub organization** → install the App on a **test org you own** → land on the confirm page → confirm.
- [ ] **Step 4: Verify** — the `classes` row exists (orgId, installationId, connectedByUserId); the org's base permission is now **No access** (GitHub org settings / `GET /orgs`); the class lists on home with live name + avatar.
- [ ] **Step 5** — re-install (or reinstall) → the row's `installationId` reconciles on the next list (no duplicate row).

**Human gate:** 🔴 **REQUIRED** — this is Feature 3 acceptance. Then update the parent plan's Progress Tracker (F3 done) + Session Log.

---

## Self-review (coverage)

Connect flow → Tasks 5+6+10. Schema → Task 1. App client/secrets → Task 2. Auth on protected endpoints → Task 3. Persistence/reconcile → Tasks 4+7. UI (connect + list + confirm) → Tasks 8+9. Deferred (webhook, joinToken, people, labs) → not built, per spec. `hc<AppType>` client + `requireAuth` land here as first consumers.

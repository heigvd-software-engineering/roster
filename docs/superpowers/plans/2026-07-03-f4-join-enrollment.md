# F4 — Class Join Link + Student Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A teacher copies a durable `/join/{token}` link from the class card; a student opens it, clicks Join, accepts GitHub's native org invitation, and is enrolled as an org Member.

**Architecture:** One new `classes.joinToken` column (capability token, separate from the class cuid). Student-facing `joinRoutes` (`GET`/`POST /api/join/:token`) resolve the class by token and read/write the caller's org membership with the App installation token — no `isOrgAdmin` check (students are the audience); an owner-demotion guard short-circuits admins. The hub's Copy button and a new 4-state `/join/:token` page complete the loop. Spec: `docs/superpowers/specs/2026-07-03-f4-join-enrollment-design.md`.

**Tech Stack:** Drizzle/D1, Hono (Workers), Octokit App installation tokens, React Router 8 SPA, shadcn/Base UI, Vitest.

## Global Constraints

- **Branch `milestone-3-enrollment`; commit per task; NO co-author trailer.**
- Biome style: double quotes, semicolons, 2-space indent, 80 cols. Gate = `pnpm run biome && pnpm -r typecheck && pnpm -r test` (run the biome SCRIPT, no extra args).
- Type safety: no hand-declared response shapes — Drizzle `$infer*`, Hono `hc<AppType>` inference.
- Human gate after every task; 👁 visual gate (dev server, real screen) for every viewable change; 🔴 live GitHub walk at the end.
- Delegate to GitHub: membership state is always read live; the DB stores only the token.
- Least privilege: org writes via the App **installation** token; the user token is used only to resolve the caller's own identity (login).

---

### Task 1: `packages/db` — `joinToken` column, mint-on-insert, `getClassByJoinToken`, migration

**Files:**
- Modify: `packages/db/src/schema.ts` (classes table)
- Create: `packages/db/src/join-token.ts`
- Modify: `packages/db/src/classes.ts` (mint in upsert + new helper)
- Modify: `packages/db/test/classes.test.ts` (new tests)
- Create (generated, then hand-adjusted): `packages/db/migrations/0002_*.sql`

**Interfaces:**
- Consumes: existing `upsertClassByOrgId`, `classes` table, real-D1 test pool.
- Produces: `classes.joinToken: string` on every row/insert type; `getClassByJoinToken(db, joinToken: string)` → `Class | undefined` (exported from `@labs/db` via the `./classes` barrel).

- [ ] **Step 1: Write the failing tests** — append to `packages/db/test/classes.test.ts`:

```ts
import { getClassByJoinToken } from "../src/classes";

test("upsert mints a join token on insert and keeps it on reinstall", async () => {
  const now = new Date(0);
  const first = await upsertClassByOrgId(db, {
    id: "c1",
    orgId: 42,
    installationId: 100,
    connectedByUserId: "u1",
    now,
  });
  expect(first?.joinToken).toMatch(/^[0-9a-f]{32}$/);

  const again = await upsertClassByOrgId(db, {
    id: "c2",
    orgId: 42,
    installationId: 200,
    connectedByUserId: "u1",
    now,
  });
  // Reinstall must NOT rotate the cohort's link.
  expect(again?.joinToken).toBe(first?.joinToken);
});

test("tokens are unique per class", async () => {
  const now = new Date(0);
  const a = await upsertClassByOrgId(db, {
    id: "c1",
    orgId: 42,
    installationId: 1,
    connectedByUserId: "u1",
    now,
  });
  const b = await upsertClassByOrgId(db, {
    id: "c2",
    orgId: 43,
    installationId: 2,
    connectedByUserId: "u1",
    now,
  });
  expect(a?.joinToken).not.toBe(b?.joinToken);
});

test("getClassByJoinToken finds the row by token, undefined on miss", async () => {
  const now = new Date(0);
  const created = await upsertClassByOrgId(db, {
    id: "c1",
    orgId: 42,
    installationId: 1,
    connectedByUserId: "u1",
    now,
  });
  if (!created) throw new Error("upsert returned no row");

  const hit = await getClassByJoinToken(db, created.joinToken);
  expect(hit?.id).toBe("c1");

  expect(await getClassByJoinToken(db, "nope")).toBeUndefined();
});
```

(Adjust the existing `import { listClassesByOrgIds, upsertClassByOrgId } from "../src/classes";` line to also import `getClassByJoinToken` — one import statement, Biome will sort it.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @labs/db test`
Expected: FAIL — `getClassByJoinToken` is not exported / `joinToken` undefined.

- [ ] **Step 3: Implement**

`packages/db/src/join-token.ts` (new):

```ts
/**
 * Mint a class join-link capability token: ~128 bits of Web Crypto
 * randomness as 32 hex chars. Separate from the class `id` (stable cuid) so
 * a leaked link can later be regenerated without touching identity.
 */
export function mintJoinToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
```

`packages/db/src/schema.ts` — add to the `classes` table (after `connectedByUserId`):

```ts
  // Join-link capability token (F4): possession of the link is the only
  // enrollment gate. NOT NULL at the app level; the SQLite column is
  // nullable (ADD COLUMN limitation) — every insert path mints one.
  joinToken: text("join_token").notNull().unique(),
```

`packages/db/src/classes.ts` — import and mint (only the `values` branch changes; the conflict branch must NOT touch the token):

```ts
import { mintJoinToken } from "./join-token";
```

In `upsertClassByOrgId`'s `.values({ ... })` add:

```ts
      joinToken: mintJoinToken(),
```

Append the helper:

```ts
export async function getClassByJoinToken(db: Db, joinToken: string) {
  const [row] = await db
    .select()
    .from(classes)
    .where(eq(classes.joinToken, joinToken));
  return row;
}
```

- [ ] **Step 4: Generate the migration, then hand-adjust it**

Run: `pnpm --filter @labs/db db:generate`

SQLite cannot `ADD COLUMN ... NOT NULL` on a non-empty table without a constant default, and the existing class row needs a token. Replace the generated file's statements (keep the generated filename and `meta/` snapshot exactly as drizzle-kit wrote them) with:

```sql
-- join_token is enforced NOT NULL at the app level (Drizzle schema); the
-- column stays nullable in SQLite because ADD COLUMN can't add NOT NULL
-- without a constant default, and existing rows are backfilled below.
ALTER TABLE `classes` ADD `join_token` text;--> statement-breakpoint
UPDATE `classes` SET `join_token` = lower(hex(randomblob(16)));--> statement-breakpoint
CREATE UNIQUE INDEX `classes_join_token_unique` ON `classes` (`join_token`);
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @labs/db test`
Expected: PASS (migration applied by the pool's `apply-migrations.ts`).

- [ ] **Step 6: Fix the api fallout in the same task** — `apps/api` inserts classes; typecheck must stay green repo-wide. `upsertClassByOrgId` mints internally, so `setup.ts` needs no change. Run: `pnpm -r typecheck`. If `apps/api/test/setup.test.ts` mocks `upsertClassByOrgId`, its mock return shape is unaffected (tests assert redirect only). Expected: PASS with no api edits.

- [ ] **Step 7: Automated gate**

Run: `pnpm run biome && pnpm -r typecheck && pnpm -r test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat(db): classes.joinToken — mint on connect, lookup by token"
```

**Human gate:** 🟢 confirm the migration file (nullable + backfill + unique index) and that reinstall preserves the token.

---

### Task 2: `apps/api` — org helpers: extract `orgLogin`, add `orgMembership` + `inviteOrgMember`

**Files:**
- Create: `apps/api/src/github/org.ts`
- Modify: `apps/api/src/routes/classes.ts` (delete its local `orgLogin`, import instead)
- Test: `apps/api/test/github-org.test.ts`

**Interfaces:**
- Consumes: `appJwtOctokit(env)`, `installationOctokit(env, installationId)` from `../github/clients`.
- Produces (all exported from `apps/api/src/github/org.ts`):
  - `orgLogin(env: AuthEnv, installationId: number): Promise<string>` (moved verbatim from `routes/classes.ts`)
  - `orgMembership(env: AuthEnv, installationId: number, org: string, username: string): Promise<{ state: "active" | "pending"; role: string } | null>` — `null` when not a member and not invited (GitHub 404)
  - `inviteOrgMember(env: AuthEnv, installationId: number, org: string, username: string): Promise<"active" | "pending">` — `PUT` membership with `role: "member"`

- [ ] **Step 1: Write the failing test** — `apps/api/test/github-org.test.ts`:

```ts
import { expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  membership: {
    status: 200 as number,
    data: { state: "active", role: "member" } as {
      state: string;
      role: string;
    },
  },
  putCalls: [] as unknown[],
}));

vi.mock("../src/github/clients", () => ({
  appJwtOctokit: () => ({
    request: async () => ({
      data: { account: { login: "acme" } },
    }),
  }),
  installationOctokit: async () => ({
    request: async (route: string, params: unknown) => {
      if (route === "GET /orgs/{org}/memberships/{username}") {
        if (state.membership.status === 404) {
          throw Object.assign(new Error("Not Found"), { status: 404 });
        }
        if (state.membership.status !== 200) {
          throw Object.assign(new Error("boom"), {
            status: state.membership.status,
          });
        }
        return { data: state.membership.data };
      }
      if (route === "PUT /orgs/{org}/memberships/{username}") {
        state.putCalls.push(params);
        return { data: { state: "pending", role: "member" } };
      }
      throw new Error(`unexpected request ${route}`);
    },
  }),
}));

const { inviteOrgMember, orgLogin, orgMembership } = await import(
  "../src/github/org"
);

const env = {} as Parameters<typeof orgLogin>[0];

test("orgLogin resolves the installation's org login", async () => {
  expect(await orgLogin(env, 1)).toBe("acme");
});

test("orgMembership maps an existing membership", async () => {
  state.membership = { status: 200, data: { state: "pending", role: "member" } };
  expect(await orgMembership(env, 1, "acme", "alice")).toEqual({
    state: "pending",
    role: "member",
  });
});

test("orgMembership returns null on GitHub 404 (not a member)", async () => {
  state.membership = { status: 404, data: { state: "", role: "" } };
  expect(await orgMembership(env, 1, "acme", "alice")).toBeNull();
});

test("orgMembership rethrows non-404 errors", async () => {
  state.membership = { status: 500, data: { state: "", role: "" } };
  await expect(orgMembership(env, 1, "acme", "alice")).rejects.toThrow("boom");
});

test("inviteOrgMember PUTs role member and returns the new state", async () => {
  state.putCalls = [];
  expect(await inviteOrgMember(env, 1, "acme", "alice")).toBe("pending");
  expect(state.putCalls).toEqual([
    { org: "acme", username: "alice", role: "member" },
  ]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @labs/api test test/github-org.test.ts`
Expected: FAIL — cannot find `../src/github/org`.

- [ ] **Step 3: Implement** — `apps/api/src/github/org.ts`:

```ts
import type { AuthEnv } from "../auth/config";
import { appJwtOctokit, installationOctokit } from "./clients";

/** Resolves the org login for an installation via the App JWT. The `account`
 *  union includes the (rarer) enterprise-account shape, which has no `login`
 *  field — narrow with `in` rather than assuming the org shape. */
export async function orgLogin(env: AuthEnv, installationId: number) {
  const { data } = await appJwtOctokit(env).request(
    "GET /app/installations/{installation_id}",
    { installation_id: installationId },
  );
  if (!data.account || !("login" in data.account)) {
    throw new Error("installation account has no login");
  }
  return data.account.login;
}

/**
 * The user's live org membership, read with the installation token:
 * `{ state, role }`, or null when they're neither a member nor invited
 * (GitHub 404). Other errors propagate.
 */
export async function orgMembership(
  env: AuthEnv,
  installationId: number,
  org: string,
  username: string,
): Promise<{ state: "active" | "pending"; role: string } | null> {
  const gh = await installationOctokit(env, installationId);
  try {
    const { data } = await gh.request(
      "GET /orgs/{org}/memberships/{username}",
      { org, username },
    );
    return { state: data.state, role: data.role };
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return null;
    }
    throw err;
  }
}

/** Invite the user as an org Member (pending until they accept natively). */
export async function inviteOrgMember(
  env: AuthEnv,
  installationId: number,
  org: string,
  username: string,
): Promise<"active" | "pending"> {
  const gh = await installationOctokit(env, installationId);
  const { data } = await gh.request("PUT /orgs/{org}/memberships/{username}", {
    org,
    username,
    role: "member",
  });
  return data.state;
}
```

Then in `apps/api/src/routes/classes.ts`: delete the local `orgLogin` function (lines 14–26) and its now-unused `appJwtOctokit` import; add `import { orgLogin } from "../github/org";` and change the call site to `orgLogin(c.env, cls.installationId)` (same signature — `AuthedEnv["Bindings"]` is `AuthEnv`).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @labs/api test`
Expected: PASS, including the untouched `classes-confirm`/`classes-list` suites. If `classes-confirm.test.ts` mocked the internal `orgLogin` indirectly via `appJwtOctokit`, add `"../src/github/org"` to its mocks the same way (`orgLogin: async () => "acme"`).

- [ ] **Step 5: Automated gate**

Run: `pnpm run biome && pnpm -r typecheck && pnpm -r test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): org membership helpers + shared orgLogin"
```

**Human gate:** 🟢 code-level review (pure refactor + two thin wrappers).

---

### Task 3: `apps/api` — `joinRoutes` (`GET`/`POST /api/join/:token`) + `joinToken` on `GET /api/classes`

**Files:**
- Create: `apps/api/src/routes/join.ts`
- Modify: `apps/api/src/index.ts` (mount)
- Modify: `apps/api/src/routes/classes.ts` (expose `joinToken` in the list)
- Test: `apps/api/test/join.test.ts`; modify `apps/api/test/classes-list.test.ts`

**Interfaces:**
- Consumes: `getClassByJoinToken` (Task 1); `orgLogin`, `orgMembership`, `inviteOrgMember` (Task 2); `requireAuth`/`AuthedEnv`; `githubUserToken`; `fetchGithubProfile`.
- Produces (inferred through `AppType`, used by Task 6's page):
  - `GET /api/join/:token` → 200 `{ class: { login: string; name: string | null; avatarUrl: string }, membership: "none" | "pending" | "active" }` · 404 `{ error: "invalid_link" }` · 403 `{ error: "github_not_linked" }`
  - `POST /api/join/:token` → 200 `{ membership: "pending" | "active" }` · same 404/403
  - `GET /api/classes` items gain `joinToken: string`.

- [ ] **Step 1: Write the failing tests** — `apps/api/test/join.test.ts`:

```ts
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  row: {
    id: "c1",
    orgId: 42,
    installationId: 100,
    joinToken: "tok123",
  } as {
    id: string;
    orgId: number;
    installationId: number;
    joinToken: string;
  } | null,
  membership: { state: "active", role: "member" } as {
    state: "active" | "pending";
    role: string;
  } | null,
  org: { login: "acme", name: "Acme", avatar_url: "http://a" },
  profile: { login: "alice", id: 7, name: "Alice", avatarUrl: "http://p" } as {
    login: string;
    id: number;
    name: string | null;
    avatarUrl: string;
  } | null,
  orgLoginFails: false,
  inviteCalls: [] as unknown[],
}));

vi.mock("../src/auth/config", () => ({
  createAuth: () => ({
    api: { getSession: async () => state.session },
  }),
}));

vi.mock("@labs/db", () => ({
  getDb: () => ({}),
  getClassByJoinToken: async (_db: unknown, token: string) =>
    state.row && token === state.row.joinToken ? state.row : undefined,
}));

vi.mock("../src/github/user-token", () => ({
  githubUserToken: async () => "tok",
}));

vi.mock("../src/github/profile", () => ({
  fetchGithubProfile: async () => state.profile,
}));

vi.mock("../src/github/org", () => ({
  orgLogin: async () => {
    if (state.orgLoginFails) throw new Error("dead installation");
    return "acme";
  },
  orgMembership: async () => state.membership,
  inviteOrgMember: async (...args: unknown[]) => {
    state.inviteCalls.push(args);
    return "pending" as const;
  },
}));

vi.mock("../src/github/clients", () => ({
  installationOctokit: async () => ({
    request: async (route: string) => {
      if (route === "GET /orgs/{org}") return { data: state.org };
      throw new Error(`unexpected request ${route}`);
    },
  }),
}));

const { joinRoutes } = await import("../src/routes/join");

const app = new Hono().route("/api", joinRoutes);
const env = { DB: {} };

beforeEach(() => {
  state.session = { user: { id: "u1" } };
  state.row = { id: "c1", orgId: 42, installationId: 100, joinToken: "tok123" };
  state.membership = { state: "active", role: "member" };
  state.profile = { login: "alice", id: 7, name: "Alice", avatarUrl: "http://p" };
  state.orgLoginFails = false;
  state.inviteCalls = [];
});

test("GET: unknown token → 404 invalid_link", async () => {
  const res = await app.request("/api/join/nope", {}, env);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "invalid_link" });
});

test("GET: requires auth", async () => {
  state.session = null;
  const res = await app.request("/api/join/tok123", {}, env);
  expect(res.status).toBe(401);
});

test("GET: unusable GitHub link → 403 github_not_linked", async () => {
  state.profile = null;
  const res = await app.request("/api/join/tok123", {}, env);
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "github_not_linked" });
});

test("GET: dead installation reads as invalid_link", async () => {
  state.orgLoginFails = true;
  const res = await app.request("/api/join/tok123", {}, env);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "invalid_link" });
});

test("GET: returns class identity + membership state", async () => {
  state.membership = null;
  const res = await app.request("/api/join/tok123", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    class: { login: "acme", name: "Acme", avatarUrl: "http://a" },
    membership: "none",
  });
});

test("GET: pending invite is reported", async () => {
  state.membership = { state: "pending", role: "member" };
  const res = await app.request("/api/join/tok123", {}, env);
  expect(await res.json()).toEqual({
    class: { login: "acme", name: "Acme", avatarUrl: "http://a" },
    membership: "pending",
  });
});

test("POST: none → invites as member, returns pending", async () => {
  state.membership = null;
  const res = await app.request("/api/join/tok123", { method: "POST" }, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ membership: "pending" });
  expect(state.inviteCalls).toHaveLength(1);
});

test("POST: already active → short-circuits, no PUT", async () => {
  state.membership = { state: "active", role: "member" };
  const res = await app.request("/api/join/tok123", { method: "POST" }, env);
  expect(await res.json()).toEqual({ membership: "active" });
  expect(state.inviteCalls).toHaveLength(0);
});

test("POST: org admin is never demoted — no PUT even while pending", async () => {
  state.membership = { state: "pending", role: "admin" };
  const res = await app.request("/api/join/tok123", { method: "POST" }, env);
  expect(await res.json()).toEqual({ membership: "pending" });
  expect(state.inviteCalls).toHaveLength(0);
});

test("POST: pending member → no duplicate PUT, still pending", async () => {
  state.membership = { state: "pending", role: "member" };
  const res = await app.request("/api/join/tok123", { method: "POST" }, env);
  expect(await res.json()).toEqual({ membership: "pending" });
  expect(state.inviteCalls).toHaveLength(0);
});

test("POST: unknown token → 404 invalid_link", async () => {
  const res = await app.request("/api/join/nope", { method: "POST" }, env);
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @labs/api test test/join.test.ts`
Expected: FAIL — cannot find `../src/routes/join`.

- [ ] **Step 3: Implement** — `apps/api/src/routes/join.ts`:

```ts
import { getClassByJoinToken, getDb } from "@labs/db";
import { Hono } from "hono";
import { type AuthedEnv, requireAuth } from "../auth/require-auth";
import { installationOctokit } from "../github/clients";
import { inviteOrgMember, orgLogin, orgMembership } from "../github/org";
import { fetchGithubProfile } from "../github/profile";
import { githubUserToken } from "../github/user-token";

/**
 * Student-facing join flow. The token IS the authorization — anyone signed in
 * with a usable GitHub link may look up the class behind a link they possess
 * and ask to be invited. Deliberately NO isOrgAdmin here; class ids never
 * appear in this flow. Failures that mean "this link goes nowhere" (unknown
 * token, dead installation) all read as 404 invalid_link so the response
 * doesn't reveal whether a class exists.
 */

type JoinContext = {
  installationId: number;
  login: string;
  username: string;
};

type Resolved =
  | { ok: true; ctx: JoinContext }
  | { ok: false; status: 403 | 404; error: "invalid_link" | "github_not_linked" };

async function resolveJoin(
  env: AuthedEnv["Bindings"],
  userId: string,
  token: string,
): Promise<Resolved> {
  const db = getDb(env.DB);
  const cls = await getClassByJoinToken(db, token);
  if (!cls) {
    return { ok: false, status: 404, error: "invalid_link" };
  }

  const userToken = await githubUserToken(db, userId);
  const profile = userToken ? await fetchGithubProfile(userToken) : null;
  if (!profile) {
    // Client-side the Auth guard prevents this; the API still refuses cleanly.
    return { ok: false, status: 403, error: "github_not_linked" };
  }

  try {
    const login = await orgLogin(env, cls.installationId);
    return {
      ok: true,
      ctx: {
        installationId: cls.installationId,
        login,
        username: profile.login,
      },
    };
  } catch {
    // App uninstalled / installation dead — the link goes nowhere.
    return { ok: false, status: 404, error: "invalid_link" };
  }
}

export const joinRoutes = new Hono<AuthedEnv>()
  .use("/join/*", requireAuth)
  .get("/join/:token", async (c) => {
    const r = await resolveJoin(c.env, c.get("user").id, c.req.param("token"));
    if (!r.ok) return c.json({ error: r.error }, r.status);
    const { installationId, login, username } = r.ctx;

    const gh = await installationOctokit(c.env, installationId);
    const { data: org } = await gh.request("GET /orgs/{org}", { org: login });
    const membership = await orgMembership(
      c.env,
      installationId,
      login,
      username,
    );
    return c.json({
      class: {
        login: org.login,
        name: org.name ?? null,
        avatarUrl: org.avatar_url,
      },
      membership: (membership?.state ?? "none") as
        | "none"
        | "pending"
        | "active",
    });
  })
  .post("/join/:token", async (c) => {
    const r = await resolveJoin(c.env, c.get("user").id, c.req.param("token"));
    if (!r.ok) return c.json({ error: r.error }, r.status);
    const { installationId, login, username } = r.ctx;

    const current = await orgMembership(c.env, installationId, login, username);
    // Existing membership (active, or any pending invite) is left untouched:
    // replaying is a no-op, and an org OWNER opening their own link must never
    // be demoted by a role:"member" PUT.
    if (current) {
      return c.json({ membership: current.state });
    }
    const membership = await inviteOrgMember(
      c.env,
      installationId,
      login,
      username,
    );
    return c.json({ membership });
  });
```

Mount in `apps/api/src/index.ts` — add the import and route (after `classesRoutes`):

```ts
import { joinRoutes } from "./routes/join";
```

```ts
  .route("/api", joinRoutes)
```

Expose the token to teachers — in `apps/api/src/routes/classes.ts`, the `GET /classes` handler: add `joinToken: string;` to the `out` array's element type and `joinToken: cls.joinToken,` to the `out.push({ ... })` object.

- [ ] **Step 4: Update the classes-list test** — in `apps/api/test/classes-list.test.ts`, add `joinToken: "tokC1"` to every row in `state.rows` (and the per-test `state.rows` overrides; use `"tokC2"` for `c2`), extend the rows' inline type with `joinToken: string`, and add `joinToken: "tokC1"` (resp. `"tokC2"`) to every expected class object in the assertions.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @labs/api test`
Expected: PASS (join suite + updated classes-list).

- [ ] **Step 6: Automated gate**

Run: `pnpm run biome && pnpm -r typecheck && pnpm -r test`
Expected: green. (`pnpm --filter @labs/www typecheck` re-infers `AppType` — the new field/routes flow into the SPA client without edits.)

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): join routes — token lookup, live membership, invite"
```

**Human gate:** 🟢 review the invite short-circuit rules (active / admin / pending) and the 404-shape decision.

---

### Task 4: `apps/www` — live "Copy join link" button on the class card 👁

**Files:**
- Modify: `apps/www/app/components/custom/classes/class-card.tsx`
- Test: `apps/www/test/class-card.test.tsx` (new)

**Interfaces:**
- Consumes: `joinToken` now present on `GET /api/classes` items — `classes-page.tsx` already spreads `{...cls}` into `ClassCard`, so the new prop arrives without a page edit.
- Produces: `ClassCardProps` gains `joinToken: string`.

- [ ] **Step 1: Write the failing test** — `apps/www/test/class-card.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClassCard } from "~/components/custom/classes/class-card";

function renderCard() {
  return render(
    <ClassCard
      login="acme"
      name="Acme"
      avatarUrl="http://a"
      joinToken="tok123"
      students={1}
      teachers={1}
      labs={[]}
    />,
  );
}

describe("ClassCard copy join link", () => {
  it("copies the join URL and confirms inline", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Copy join link" }));

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/join/tok123`,
    );
    expect(
      await screen.findByRole("button", { name: "Copied ✓" }),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @labs/www test test/class-card.test.tsx`
Expected: FAIL — unknown prop `joinToken` (typecheck) / button disabled, no copy.

- [ ] **Step 3: Implement** — in `class-card.tsx`:

Add to the props type: `joinToken: string;` and to the destructuring: `joinToken`.

Add imports and state (top of file / component):

```tsx
import { useEffect, useRef, useState } from "react";
```

```tsx
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyResetTimer.current), []);

  async function copyJoinLink() {
    await navigator.clipboard.writeText(
      `${window.location.origin}/join/${joinToken}`,
    );
    setCopied(true);
    clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopied(false), 2000);
  }
```

Replace the disabled Copy button with:

```tsx
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={copyJoinLink}
          >
            {copied ? "Copied ✓" : "Copy join link"}
          </Button>
```

(The "Open ›" and "+ Add a lab" buttons stay disabled dummies — F6+.) Update the card's doc comment: member counts / labs remain dummy; the join link is now real.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @labs/www test`
Expected: PASS, including the untouched `classes-page.test.tsx` — if its fixture classes now fail typecheck for the missing `joinToken`, add `joinToken: "tok123"` to those fixtures.

- [ ] **Step 5: Automated gate**

Run: `pnpm run biome && pnpm -r typecheck && pnpm -r test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/www
git commit -m "feat(www): live Copy-join-link on the class card"
```

**Human gate:** 👁 REQUIRED — `pnpm --filter @labs/www dev` (Worker running for `/api`), review the hub: click Copy, see "Copied ✓", paste the URL somewhere and eyeball it.

---

### Task 5: `apps/www` — onboarding preserves the deep link (`returnTo`)

**Files:**
- Modify: `apps/www/app/components/custom/shell/auth.tsx`
- Modify: `apps/www/app/lib/auth-context.tsx`
- Modify: `apps/www/app/pages/onboarding-github-page.tsx`
- Test: modify `apps/www/test/auth-guard.test.tsx`; create `apps/www/test/onboarding.test.tsx`

**Why:** today `Auth` redirects unlinked users to `/onboarding/github` and `linkGithub` hard-codes `callbackURL: "/"` — a student arriving at `/join/{token}` unlinked would lose the link. Thread the origin through.

**Interfaces:**
- Produces: `Auth` redirects to `/onboarding/github?returnTo=<encoded path>`; `AuthValue.linkGithub` becomes `(callbackURL?: string) => void` (default `"/"` — existing callers stay valid).

- [ ] **Step 1: Write the failing tests**

In `apps/www/test/auth-guard.test.tsx`, extend the `react-router` mock with a location (inside the returned object):

```ts
    useLocation: () => ({ pathname: "/join/tok123", search: "" }),
```

and change the onboarding-redirect assertion to:

```ts
    expect(navigateSpy).toHaveBeenCalledWith(
      "/onboarding/github?returnTo=%2Fjoin%2Ftok123",
    );
```

New `apps/www/test/onboarding.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OnboardingGitHubPage } from "~/pages/onboarding-github-page";

const linkGithub = vi.fn();
vi.mock("~/lib/auth-context", () => ({
  useAuth: () => ({ linkGithub }),
}));

const params = vi.hoisted(() => ({ returnTo: null as string | null }));
vi.mock("react-router", () => ({
  useSearchParams: () => [
    { get: (k: string) => (k === "returnTo" ? params.returnTo : null) },
  ],
}));

describe("OnboardingGitHubPage returnTo", () => {
  it("links back to the preserved path", () => {
    params.returnTo = "/join/tok123";
    render(<OnboardingGitHubPage />);
    fireEvent.click(screen.getByText("Connect GitHub"));
    expect(linkGithub).toHaveBeenCalledWith("/join/tok123");
  });

  it("falls back to / when returnTo is absent", () => {
    params.returnTo = null;
    render(<OnboardingGitHubPage />);
    fireEvent.click(screen.getByText("Connect GitHub"));
    expect(linkGithub).toHaveBeenCalledWith("/");
  });

  it("rejects non-path returnTo values (open-redirect guard)", () => {
    params.returnTo = "//evil.example";
    render(<OnboardingGitHubPage />);
    fireEvent.click(screen.getByText("Connect GitHub"));
    expect(linkGithub).toHaveBeenCalledWith("/");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @labs/www test`
Expected: FAIL — old redirect string; `linkGithub` called with no argument.

- [ ] **Step 3: Implement**

`auth.tsx` — add `useLocation` to the `react-router` import; inside the component:

```tsx
  const location = useLocation();
```

and replace the onboarding redirect with:

```tsx
  if (requireGithubLinked && !githubLinked) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/onboarding/github?returnTo=${returnTo}`} replace />;
  }
```

`auth-context.tsx` — type: `linkGithub: (callbackURL?: string) => void;` (keep the doc comment); implementation:

```tsx
      linkGithub: (callbackURL = "/") => {
        authLinkSocial({ provider: "github", callbackURL });
      },
```

`onboarding-github-page.tsx` — add `import { useSearchParams } from "react-router";`; inside the component:

```tsx
  const [params] = useSearchParams();
  const raw = params.get("returnTo") ?? "/";
  // Same-app absolute paths only — "//host" is scheme-relative (open redirect).
  const returnTo = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
```

and the button: `onClick={() => linkGithub(returnTo)}`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @labs/www test`
Expected: PASS.

- [ ] **Step 5: Automated gate**

Run: `pnpm run biome && pnpm -r typecheck && pnpm -r test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/www
git commit -m "feat(www): onboarding returnTo — deep links survive GitHub linking"
```

**Human gate:** 🟢 (exercised live in Task 7's walk: open a join link unlinked → onboarding → back on the join page).

---

### Task 6: `apps/www` — `/join/:token` route + 4-state join page 👁

**Files:**
- Modify: `apps/www/app/routes.ts`
- Create: `apps/www/app/routes/join.tsx`
- Create: `apps/www/app/pages/join-page.tsx`
- Test: `apps/www/test/join-page.test.tsx`

**Interfaces:**
- Consumes: `GET`/`POST /api/join/:token` (Task 3) through the typed `hc` client — `api.api.join[":token"].$get({ param: { token } })` / `.$post(...)`; the `Auth` guard (default `requireGithubLinked`) + Task 5's returnTo; `BrandHeader`, `Loading`, `Stack`, `Text`, `Button`, `UserAvatar`.
- Produces: route `join/:token`.

**Note:** `useApi` (SWR) only fits param-less endpoints; this page owns a small explicit state machine instead — it has bespoke transitions (join → invited → check → enrolled) that SWR wouldn't simplify.

- [ ] **Step 1: Write the failing test** — `apps/www/test/join-page.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JoinPage } from "~/pages/join-page";

const joinGet = vi.fn();
const joinPost = vi.fn();

vi.mock("react-router", () => ({
  useParams: () => ({ token: "tok123" }),
}));

vi.mock("~/lib/api", () => ({
  api: {
    api: {
      join: {
        ":token": {
          $get: (...args: unknown[]) => joinGet(...args),
          $post: (...args: unknown[]) => joinPost(...args),
        },
      },
    },
  },
}));

const ready = (membership: string) => ({
  status: 200,
  ok: true,
  json: () =>
    Promise.resolve({
      class: { login: "acme", name: "Acme", avatarUrl: "http://a" },
      membership,
    }),
});

beforeEach(() => {
  joinGet.mockReset();
  joinPost.mockReset();
});

describe("JoinPage", () => {
  it("shows the class preview and a Join button for a non-member", async () => {
    joinGet.mockResolvedValue(ready("none"));
    render(<JoinPage />);
    expect(await screen.findByText("Join Acme")).toBeInTheDocument();
    expect(screen.getByText("@acme")).toBeInTheDocument();
    expect(joinGet).toHaveBeenCalledWith({ param: { token: "tok123" } });
    expect(
      screen.getByRole("button", { name: "Join class" }),
    ).toBeInTheDocument();
  });

  it("flips to the invited state after joining", async () => {
    joinGet.mockResolvedValue(ready("none"));
    joinPost.mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ membership: "pending" }),
    });
    render(<JoinPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Join class" }));

    expect(
      await screen.findByRole("link", { name: "Open the invitation on GitHub" }),
    ).toHaveAttribute("href", "https://github.com/orgs/acme/invitation");
    expect(joinPost).toHaveBeenCalledWith({ param: { token: "tok123" } });
  });

  it("Check my enrollment re-reads state and flips to enrolled", async () => {
    joinGet.mockResolvedValueOnce(ready("pending"));
    joinGet.mockResolvedValueOnce(ready("active"));
    render(<JoinPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Check my enrollment" }),
    );
    expect(
      await screen.findByText("You're enrolled in Acme."),
    ).toBeInTheDocument();
  });

  it("already-members land on the enrolled state directly", async () => {
    joinGet.mockResolvedValue(ready("active"));
    render(<JoinPage />);
    expect(
      await screen.findByText("You're enrolled in Acme."),
    ).toBeInTheDocument();
  });

  it("unknown token shows the invalid-link state", async () => {
    joinGet.mockResolvedValue({ status: 404, ok: false });
    render(<JoinPage />);
    expect(
      await screen.findByText(
        "This join link isn't valid — ask your teacher for a fresh one.",
      ),
    ).toBeInTheDocument();
  });

  it("a failed load shows the error state with retry", async () => {
    joinGet.mockRejectedValueOnce(new Error("network"));
    joinGet.mockResolvedValueOnce(ready("none"));
    render(<JoinPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Join Acme")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @labs/www test test/join-page.test.tsx`
Expected: FAIL — cannot find `~/pages/join-page`.

- [ ] **Step 3: Implement**

`apps/www/app/routes.ts` — add:

```ts
  route("join/:token", "routes/join.tsx"),
```

`apps/www/app/routes/join.tsx`:

```tsx
import { Auth } from "~/components/custom/shell/auth";
import { JoinPage } from "~/pages/join-page";

/** /join/:token — the student's class join link. */
export default function Join() {
  return (
    <Auth>
      <JoinPage />
    </Auth>
  );
}
```

`apps/www/app/pages/join-page.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Loading } from "~/components/custom/loading";
import { BrandHeader } from "~/components/custom/typography/brand-header";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { api } from "~/lib/api";

type Membership = "none" | "pending" | "active";
type ClassIdentity = { login: string; name: string | null; avatarUrl: string };

type JoinState =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "error" }
  | { kind: "ready"; cls: ClassIdentity; membership: Membership };

/**
 * /join/:token — the student side of the class join link (spec: F4 design).
 * A small explicit state machine (useApi is param-less GET only, and the
 * transitions here are bespoke): loading → ready(none|pending|active) with
 * invalid (404) and error (retry) terminals. Joining creates a PENDING GitHub
 * org invite; acceptance is native on GitHub, so the page offers the
 * invitation link in a new tab plus a live "Check my enrollment" re-read.
 */
export function JoinPage() {
  const { token = "" } = useParams();
  const [state, setState] = useState<JoinState>({ kind: "loading" });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await api.api.join[":token"].$get({ param: { token } });
      if (res.status === 404) {
        setState({ kind: "invalid" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error" });
        return;
      }
      const body = await res.json();
      setState({ kind: "ready", cls: body.class, membership: body.membership });
    } catch {
      setState({ kind: "error" });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function join(cls: ClassIdentity) {
    setSubmitting(true);
    try {
      const res = await api.api.join[":token"].$post({ param: { token } });
      if (!res.ok) {
        setState(res.status === 404 ? { kind: "invalid" } : { kind: "error" });
        return;
      }
      const body = await res.json();
      setState({ kind: "ready", cls, membership: body.membership });
    } catch {
      setState({ kind: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  if (state.kind === "loading") {
    return <Loading loading className="flex-1" />;
  }

  if (state.kind === "invalid") {
    return (
      <Shell title="Invalid link">
        <Text variant="subtitle" className="max-w-md">
          This join link isn't valid — ask your teacher for a fresh one.
        </Text>
      </Shell>
    );
  }

  if (state.kind === "error") {
    return (
      <Shell title="Something went wrong">
        <Text variant="error">Couldn't load this join link.</Text>
        <Button size="lg" onClick={() => void load()}>
          Retry
        </Button>
      </Shell>
    );
  }

  const { cls, membership } = state;
  const className = cls.name ?? cls.login;

  return (
    <Shell title={membership === "active" ? "Enrolled" : `Join ${className}`}>
      <Row gap="sm">
        <UserAvatar name={className} src={cls.avatarUrl} size="lg" />
        <Stack gap="none">
          <Text variant="body1" className="font-semibold">
            {className}
          </Text>
          <Text variant="body2">@{cls.login}</Text>
        </Stack>
      </Row>

      {membership === "none" ? (
        <>
          <Text variant="subtitle" className="max-w-md">
            You've been invited to join this class. Joining makes you a member
            of its GitHub organization.
          </Text>
          <Button size="lg" disabled={submitting} onClick={() => join(cls)}>
            Join class
          </Button>
        </>
      ) : membership === "pending" ? (
        <>
          <Text variant="subtitle" className="max-w-md">
            Almost there — accept your invitation on GitHub, then come back and
            check your enrollment.
          </Text>
          <Row gap="sm" wrap>
            <Button
              size="lg"
              render={
                <a
                  href={`https://github.com/orgs/${cls.login}/invitation`}
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              Open the invitation on GitHub
            </Button>
            <Button size="lg" variant="outline" onClick={() => void load()}>
              Check my enrollment
            </Button>
          </Row>
        </>
      ) : (
        <Text variant="subtitle" className="max-w-md">
          You're enrolled in {className}.
        </Text>
      )}
    </Shell>
  );
}

/** The hero layout shared by all join-page states (login/confirm family). */
function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="lg" align="start" justify="center" className="flex-1">
      <BrandHeader title={title} />
      {children}
    </Stack>
  );
}
```

(Add `import type { ReactNode } from "react";` for the Shell props.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @labs/www test`
Expected: PASS (all suites).

- [ ] **Step 5: Automated gate**

Run: `pnpm run biome && pnpm -r typecheck && pnpm -r test`
Expected: green (`react-router typegen` picks up the new route).

- [ ] **Step 6: Commit**

```bash
git add apps/www
git commit -m "feat(www): /join/:token — 4-state student join page"
```

**Human gate:** 👁 REQUIRED — dev server up, walk all four states on the real screen (a real token from the hub for preview; a garbage token for invalid; the enrolled state as the org owner — opening your own class's link must show "You're enrolled", NOT demote you).

---

### Task 7: Full gate, docs, and the 🔴 live enrollment walk

**Files:**
- Modify: `docs/superpowers/plans/2026-06-30-labs-implementation.md` (tracker: F4 row, cursor, session log)
- Modify: `.superpowers/sdd/progress.md` (ledger: F4 section, resume order)

**Steps:**

- [ ] **Step 1: Full automated gate** — `pnpm run biome && pnpm -r typecheck && pnpm -r test`, plus `pnpm build` (www build + api `wrangler deploy --dry-run`). Expected: green.

- [ ] **Step 2: Apply the migration to the real D1s**

```bash
pnpm --filter @labs/api exec wrangler d1 migrations apply labs --local
pnpm --filter @labs/api exec wrangler d1 migrations apply labs --remote
```

(The existing class row gets a backfilled token; verify with a `SELECT id, join_token FROM classes` via `wrangler d1 execute labs --remote --command "..."`.)

- [ ] **Step 3: 🔴 Live walk (user present, both GitHub accounts)**

1. Teacher: hub → **Copy join link** on Test TWeb 2026 → "Copied ✓".
2. Teacher (same browser): open the copied link → **"You're enrolled"** (owner short-circuit — no demotion; verify you are still an org Owner on GitHub afterwards).
3. Student (second account, private window): open the link signed-out → login renders in place → edu-ID sign-in → (if GitHub unlinked) onboarding → **back on the join page** (returnTo).
4. Preview shows the org identity → **Join class** → invited state.
5. **Open the invitation on GitHub** (new tab) → accept natively.
6. Back on the join page → **Check my enrollment** → "You're enrolled in …".
7. Teacher: on GitHub, the student is an org **Member**; on the hub, nothing regressed.
8. Garbage token (`/join/zzz`) → invalid-link state.

- [ ] **Step 4: Update the tracker + ledger** — tick F4 in the features table (`[x] DONE + live 🔴 walk PASSED`), move the **▶ Active cursor** to F5b (people UI), append a Session Log row; mirror in the ledger's F4 section + "Next (resume order)".

- [ ] **Step 5: Commit docs**

```bash
git add docs .superpowers/sdd/progress.md
git commit -m "docs: F4 done — tracker + ledger updated"
```

**Human gate:** 🔴 REQUIRED — the live walk above IS the F4 acceptance.

---

## Self-review (done at plan time)

- **Spec coverage:** token semantics → T1; token-as-capability API + owner guard + idempotency → T2/T3; teacher exposure + Copy → T3/T4; deep-link-through-onboarding → T5; 4-state page + new-tab handoff + check-enrollment → T6; migration/backfill + live walk → T1/T7. Regeneration: out of scope (spec).
- **Placeholders:** none — every step has full code/commands.
- **Type consistency:** `joinToken: string` (db → api list → ClassCard prop); `membership: "none" | "pending" | "active"` (api → page); `linkGithub(callbackURL?: string)`; helper names `orgLogin`/`orgMembership`/`inviteOrgMember` used identically in T2 mocks and T3 imports.

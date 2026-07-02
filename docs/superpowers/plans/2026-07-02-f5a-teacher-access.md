# F5a — Multi-teacher access model · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Design spec: `docs/superpowers/specs/2026-07-02-f5a-teacher-access-design.md`. Parent plan/tracker: `docs/superpowers/plans/2026-06-30-labs-implementation.md`. **Commit per task; NO `Co-Authored-By` trailer.**

**Goal:** Any live GitHub **org Owner** sees and administers the org's class in labs — not just the teacher who connected it.

**Architecture:** Teacher = org role `admin`, verified live. The caller's GitHub id comes from the stored `account` row (no user-token dependence); the org's admin list is read with the **installation token** (`GET /orgs/{org}/members?role=admin`). `GET /api/classes` lists rows matching the caller's installations then filters by the admin check; class writes (confirm) replace the `connectedByUserId` comparison with the same check. `connectedByUserId` stays provenance-only.

**Tech Stack:** Hono on Workers, Drizzle/D1, `@octokit/app` + `octokit`, Vitest (mocked Octokit for routes; real D1 for db helpers), Biome.

## Global Constraints

- **Least privilege:** org reads use the **installation token**; the user token only for `GET /user/installations`.
- **No existence leaks:** unauthorized writes → **404** (never 403).
- **Types:** response shapes inferred via `hc<AppType>`; no hand-declared shapes. The `/api/classes` response shape must NOT change (hub UI untouched).
- **Error containment in the list route:** one failing org must not 500 the list (skip that class). Writes must NOT proceed on an unverified role (let the error propagate).
- **Biome:** double quotes, semicolons, 2-space, 80 cols. Tests: mocked Octokit for routes; real D1 for db helpers. Commit per task, no co-author trailer.

## File Structure

- `packages/db/src/classes.ts` — add `listClassesByOrgIds`.
- `packages/db/test/classes.test.ts` — extend (real D1).
- `apps/api/src/github-teacher.ts` — **new**: `callerGithubId`, `isOrgAdmin`.
- `apps/api/test/github-teacher.test.ts` — **new**.
- `apps/api/src/routes/classes.ts` — confirm + list rewritten onto the admin check.
- `apps/api/test/classes-confirm.test.ts`, `apps/api/test/classes-list.test.ts` — updated.

---

### Task 1: `listClassesByOrgIds` DB helper

**Files:**
- Modify: `packages/db/src/classes.ts`
- Test: `packages/db/test/classes.test.ts`

**Interfaces produced:** `listClassesByOrgIds(db, orgIds: number[]): Promise<Class[]>` — rows whose `orgId ∈ orgIds`; `[]` for empty input. Exported from `@labs/db` (`packages/db/src/index.ts` already re-exports `./classes` — verify, else add).

- [ ] **Step 1: Failing test** — append to `packages/db/test/classes.test.ts` (match the file's existing setup — real D1 via the Workers pool, `beforeEach` cleanup, seeded `user` row):

```ts
test("listClassesByOrgIds returns rows matching any given orgId", async () => {
  const now = new Date(0);
  await upsertClassByOrgId(db, {
    id: "c1", orgId: 42, installationId: 1, connectedByUserId: "u1", now,
  });
  await upsertClassByOrgId(db, {
    id: "c2", orgId: 43, installationId: 2, connectedByUserId: "u1", now,
  });

  const hit = await listClassesByOrgIds(db, [42, 99]);
  expect(hit.map((c) => c.orgId)).toEqual([42]);

  expect(await listClassesByOrgIds(db, [])).toEqual([]);
});
```

Import `listClassesByOrgIds` from `../src/classes`. Reuse the test file's existing `db`/seed helpers exactly as the neighboring tests do.

- [ ] **Step 2: Run → fails** — `pnpm --filter @labs/db test` → `listClassesByOrgIds` is not exported.

- [ ] **Step 3: Implement** — in `packages/db/src/classes.ts` (add `inArray` to the existing `drizzle-orm` import):

```ts
export async function listClassesByOrgIds(db: Db, orgIds: number[]) {
  if (orgIds.length === 0) {
    return [];
  }
  return db.select().from(classes).where(inArray(classes.orgId, orgIds));
}
```

- [ ] **Step 4: Run → passes** — `pnpm --filter @labs/db test`.
- [ ] **Step 5: Gate** — `pnpm run biome && pnpm -r typecheck && pnpm --filter @labs/db test`.
- [ ] **Step 6: Commit** — `git add packages/db && git commit -m "feat(db): listClassesByOrgIds helper"`

**Human gate:** 🟢.

---

### Task 2: `github-teacher.ts` — `callerGithubId` + `isOrgAdmin`

**Files:**
- Create: `apps/api/src/github-teacher.ts`
- Test: `apps/api/test/github-teacher.test.ts`

**Interfaces produced:**
- `callerGithubId(db, userId: string): Promise<number | null>` — the caller's GitHub user id from the stored `github` `account.accountId`; `null` if unlinked or unparsable.
- `isOrgAdmin(env: AuthEnv, installationId: number, orgLogin: string, githubUserId: number): Promise<boolean>` — true iff the id is in `GET /orgs/{org}/members?role=admin` (installation token). Errors propagate.

- [ ] **Step 1: Failing test** — `apps/api/test/github-teacher.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { callerGithubId, isOrgAdmin } from "../src/github-teacher";

vi.mock("../src/github", () => ({
  installationOctokit: vi.fn(async () => ({
    request: vi.fn(async () => ({
      data: [{ id: 111 }, { id: 222 }],
    })),
  })),
}));

function fakeDb(accountId: string | undefined) {
  return {
    query: {
      account: {
        findFirst: async () => (accountId ? { accountId } : undefined),
      },
    },
  } as never;
}

describe("callerGithubId", () => {
  it("parses the stored github account id", async () => {
    expect(await callerGithubId(fakeDb("12345"), "u1")).toBe(12345);
  });
  it("returns null when unlinked or unparsable", async () => {
    expect(await callerGithubId(fakeDb(undefined), "u1")).toBeNull();
    expect(await callerGithubId(fakeDb("not-a-number"), "u1")).toBeNull();
  });
});

describe("isOrgAdmin", () => {
  it("is true iff the caller id is among org admins", async () => {
    const env = {} as never;
    expect(await isOrgAdmin(env, 100, "acme", 111)).toBe(true);
    expect(await isOrgAdmin(env, 100, "acme", 999)).toBe(false);
  });
});
```

- [ ] **Step 2: Run → fails** — `pnpm --filter @labs/api test` → cannot find `../src/github-teacher`.

- [ ] **Step 3: Implement** — `apps/api/src/github-teacher.ts`:

```ts
import type { getDb } from "@labs/db";
import type { AuthEnv } from "./auth";
import { installationOctokit } from "./github";

type Db = ReturnType<typeof getDb>;

/**
 * Teacher = live GitHub org Owner (role `admin`). The caller's identity is the
 * stored `github` account id (set at link time) — no user-token call, so an
 * expired user OAuth token can't break authorization. The org's admin list is
 * read with the installation token (least privilege).
 */

/** The caller's GitHub user id, or null when unlinked/unparsable. */
export async function callerGithubId(
  db: Db,
  userId: string,
): Promise<number | null> {
  const account = await db.query.account.findFirst({
    where: (a, { and, eq }) =>
      and(eq(a.userId, userId), eq(a.providerId, "github")),
    columns: { accountId: true },
  });
  if (!account?.accountId) {
    return null;
  }
  const id = Number(account.accountId);
  return Number.isFinite(id) ? id : null;
}

/** True iff the GitHub user is an org Owner. Errors propagate to the caller. */
export async function isOrgAdmin(
  env: AuthEnv,
  installationId: number,
  orgLogin: string,
  githubUserId: number,
): Promise<boolean> {
  const gh = await installationOctokit(env, installationId);
  const { data } = await gh.request("GET /orgs/{org}/members", {
    org: orgLogin,
    role: "admin",
  });
  return data.some((member) => member.id === githubUserId);
}
```

- [ ] **Step 4: Run → passes.** **Step 5: Gate** (biome, api typecheck, api tests). **Step 6: Commit** — `git add apps/api && git commit -m "feat(api): github-teacher — live org-admin teacher check"`

**Human gate:** 🟢.

---

### Task 3: Confirm route — admin check replaces `connectedByUserId`

**Files:**
- Modify: `apps/api/src/routes/classes.ts` (the `POST /classes/:id/confirm` handler)
- Test: `apps/api/test/classes-confirm.test.ts`

**Consumes:** `callerGithubId`, `isOrgAdmin` (Task 2); existing `orgLogin` helper in the route file.

- [ ] **Step 1: Update tests** — in `apps/api/test/classes-confirm.test.ts`: add a module mock for `../src/github-teacher` with `vi.fn()`s:

```ts
vi.mock("../src/github-teacher", () => ({
  callerGithubId: vi.fn(async () => 111),
  isOrgAdmin: vi.fn(async () => true),
}));
```

Replace the "class connected by a different user returns 404" case with two role-based cases (the `connectedByUserId` value on the mocked class row is now irrelevant — keep it as any string):

```ts
it("confirms for a co-owner (admin) even if they didn't connect it", async () => {
  // default mocks: callerGithubId 111, isOrgAdmin true → 200 path
  // (assert ok:true and PATCH was called, as the existing happy path does)
});

it("returns 404 and makes no org writes for a non-admin", async () => {
  vi.mocked(isOrgAdmin).mockResolvedValueOnce(false);
  // request → expect 404, and the PATCH spy NOT called
});

it("returns 404 when the caller has no linked GitHub id", async () => {
  vi.mocked(callerGithubId).mockResolvedValueOnce(null);
  // request → expect 404, no PATCH
});
```

Import `callerGithubId`/`isOrgAdmin` from `../src/github-teacher` for `vi.mocked`. Flesh these out with the file's existing request/mocking style (same app setup, same PATCH spy).

- [ ] **Step 2: Run → fails** — the 404 cases fail (route still checks `connectedByUserId`).

- [ ] **Step 3: Implement** — in `apps/api/src/routes/classes.ts`, replace the confirm handler's ownership block:

```ts
  .post("/classes/:id/confirm", async (c) => {
    const db = getDb(c.env.DB);
    const cls = await getClassById(db, c.req.param("id"));
    if (!cls) return c.json({ error: "not_found" }, 404);

    const login = await orgLogin(c.env, cls.installationId);

    // Teacher check: live org Owner. 404 (not 403) — don't confirm existence
    // of a class the caller can't see. `connectedByUserId` is provenance only.
    const ghId = await callerGithubId(db, c.get("user").id);
    if (ghId === null || !(await isOrgAdmin(c.env, cls.installationId, login, ghId))) {
      return c.json({ error: "not_found" }, 404);
    }

    const gh = await installationOctokit(c.env, cls.installationId);
    // …existing PATCH + verify + response unchanged…
  })
```

Add the import: `import { callerGithubId, isOrgAdmin } from "../github-teacher";`.

- [ ] **Step 4: Run → passes** — all confirm cases green.
- [ ] **Step 5: Gate** (biome, api typecheck, full api tests). **Step 6: Commit** — `git add apps/api && git commit -m "feat(api): confirm authorizes by live org-admin role"`

**Human gate:** 🟢 (live co-owner walk in Task 5).

---

### Task 4: List route — org-intersection + admin filter

**Files:**
- Modify: `apps/api/src/routes/classes.ts` (the `GET /classes` handler)
- Test: `apps/api/test/classes-list.test.ts`

**Consumes:** `listClassesByOrgIds` (Task 1), `callerGithubId`/`isOrgAdmin` (Task 2). Response shape UNCHANGED.

- [ ] **Step 1: Update tests** — in `apps/api/test/classes-list.test.ts`, add the `../src/github-teacher` mock (default: `callerGithubId → 111`, `isOrgAdmin → true`) and swap the `@labs/db` mock's `listClassesByUser` for `listClassesByOrgIds` (returning the same row for orgId 42). Add cases:

```ts
it("returns a class connected by someone else when the caller is an org admin", async () => {
  // row connectedByUserId: "someone-else"; installations include orgId 42;
  // isOrgAdmin true → class IS in the response.
});

it("skips a class when the caller has installation access but is NOT an admin (F8 guard)", async () => {
  vi.mocked(isOrgAdmin).mockResolvedValueOnce(false);
  // → response classes: []
});

it("returns [] when the caller has no linked GitHub id", async () => {
  vi.mocked(callerGithubId).mockResolvedValueOnce(null);
  // → { classes: [] } and NO GitHub calls
});
```

Keep the existing reconcile/skip-uninstalled/error-containment cases passing (they now flow through the new order — adjust their mocks to `listClassesByOrgIds`).

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** — rewrite the `GET /classes` handler (new order: identity → installations → rows-by-orgIds → per-class admin+reconcile+enrich, error-contained):

```ts
  .get("/classes", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");

    const ghId = await callerGithubId(db, user.id);
    const token = await githubUserToken(db, user.id);
    if (ghId === null || !token) return c.json({ classes: [] });

    const userGh = new Octokit({ auth: token });
    const { data: insts } = await userGh.request("GET /user/installations");
    const byOrgId = new Map<number, { installationId: number; login: string }>();
    for (const inst of insts.installations) {
      if (inst.account && "login" in inst.account) {
        byOrgId.set(inst.account.id, {
          installationId: inst.id,
          login: inst.account.login,
        });
      }
    }

    const rows = await listClassesByOrgIds(db, [...byOrgId.keys()]);

    const out: Array<{
      id: string;
      orgId: number;
      login: string;
      name: string | null;
      avatarUrl: string;
    }> = [];
    for (const cls of rows) {
      const live = byOrgId.get(cls.orgId);
      if (!live) continue;
      try {
        // Teacher check: only live org Owners see the class (installation
        // access alone is NOT enough — students gain it in F8).
        if (!(await isOrgAdmin(c.env, live.installationId, live.login, ghId))) {
          continue;
        }
        if (live.installationId !== cls.installationId) {
          await refreshInstallationId(db, cls.orgId, live.installationId, new Date());
        }
        const gh = await installationOctokit(c.env, live.installationId);
        const { data: org } = await gh.request("GET /orgs/{org}", {
          org: live.login,
        });
        out.push({
          id: cls.id,
          orgId: cls.orgId,
          login: org.login,
          name: org.name ?? null,
          avatarUrl: org.avatar_url,
        });
      } catch {
        // One org's failure (rate limit, revoked install) must not 500 the
        // whole list — skip this class.
      }
    }
    return c.json({ classes: out });
  });
```

Update imports (`listClassesByOrgIds` instead of `listClassesByUser` if now unused in this file). NOTE: `listClassesByUser` stays exported from `@labs/db` (provenance queries) even if unimported here.

- [ ] **Step 4: Run → passes** — all list cases green.
- [ ] **Step 5: Gate** — `pnpm run biome && pnpm -r typecheck && pnpm -r test` (nothing may regress).
- [ ] **Step 6: Commit** — `git add apps/api && git commit -m "feat(api): classes list — visibility by live org-admin role"`

**Human gate:** 🟢 (live in Task 5).

---

### Task 5: Live 🔴 co-owner walk + tracker

**Files:** docs only.

- [ ] **Step 1** — Rebuild + run the Worker (`pnpm --filter @labs/www build` with the Worker stopped, then `pnpm --filter @labs/api dev`).
- [ ] **Step 2** — On GitHub, add the user's **second account** as an **Owner** of the test org (Test TWeb 2026).
- [ ] **Step 3** — Sign in to labs with a session for account #2 (edu-ID sign-in, link GitHub account #2 during onboarding) → **the class appears on /classes** without any connect action. Run **confirm** from that session → 200.
- [ ] **Step 4** — Demote account #2 to Member on GitHub → refresh → the class disappears for #2. (Restore as desired.)
- [ ] **Step 5** — Update the parent plan tracker (F5a done; F4 next) + Session Log; ledger.

**Human gate:** 🔴 REQUIRED — this is the F5a acceptance.

---

## Self-review (coverage)

Spec: visibility by installations∩rows + admin filter → Task 4; write authorization → Task 3; the check itself (stored id + installation-token admin list) → Task 2; `listClassesByOrgIds` → Task 1; unlinked→not-teacher, error containment, F8 guard → Tasks 3+4 tests; live co-owner acceptance → Task 5. Response shape unchanged (no www changes). Setup callback untouched per spec. No pagination handling (documented out of scope).

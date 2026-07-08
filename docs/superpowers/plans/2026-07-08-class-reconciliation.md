# Class Reconciliation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One per-class action that audits everything GitHub is authoritative for, proposes fixes, and applies only what the teacher accepts — while every `GET` stops mutating the database.

**Architecture:** A registry of `Reconciler` modules, each a file exporting `{ name, audit, apply }`. `GET /audit` runs them all against a lazy, memoized `ClassContext` and writes nothing. `POST /reconcile` executes the enumerated operations the teacher checked. Features land one reconciler at a time; each removes one silent repair from a read path.

**Tech Stack:** Hono + Cloudflare Workers + D1, Drizzle ORM, Vitest (`@cloudflare/vitest-pool-workers` for the API, jsdom for the SPA), React Router 7, Tailwind v4, Biome.

**Spec:** `docs/superpowers/specs/2026-07-08-reconcile-on-demand-design.md`

## Global Constraints

- **TDD, no exceptions.** Write the failing test, run it, watch it fail *for the right reason*, then implement. A test that has never failed proves nothing.
- **Verify before claiming.** Run the command, read the output. Never report a pass you did not observe.
- **`apply` never bulk-sweeps.** It executes the enumerated operations for the keys it was given. It must never call `syncRoster`, whose semantics are *"delete everyone absent from the live roster"* (`enrollment.ts:84-85`). This is the safety property of the whole design.
- **Every operation is idempotent.** Applying the same key twice is a no-op, not an error.
- **`runAudit` never rejects.** A reconciler that throws becomes one `info` finding.
- **`class_members` is a display cache.** No endpoint may authorize against it. Authorization always reads live GitHub state.
- **Never delete a GitHub repository.** Nothing in `apps/api/src` does today; keep it that way.
- API tests: `pnpm --filter @labs/api test` · SPA tests: `pnpm --filter @labs/www test`
- Typecheck: `pnpm --filter @labs/api exec tsc --noEmit` · `pnpm --filter @labs/www exec tsc --noEmit`
- Lint: `pnpm biome` · fix: `pnpm biome check --write .`
- Migrations: `pnpm --filter @labs/db db:generate`, then `pnpm --filter @labs/api exec wrangler d1 migrations apply labs --local`
- Every commit message ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## Features

| # | Feature | Owns | Depends on |
|---|---|---|---|
| **F1** | Read-path safety net | the `catch {}` bug; `callerGithub` | — |
| **F2** | Reconcile core | `types`, `context`, registry, `GET /audit`, `POST /reconcile`, the page, `reconciledAt`, the `identity` reconciler | F1 |
| **F3** | Installation pointer | `installation` reconciler; `setup.ts` session-less repair; hub stops writing `classes` | F2 |
| **F4** | Roster | `roster` reconciler; hub reads `class_members` | F3 |
| **F5** | Lab-title uniqueness | `labs: unique(classId, title)` | — |
| **F6** | Group recovery | `teamMissing` flag; `group-teams` + `work-repos` reconcilers | F2, F5 |
| **F7** | Base permission | `base-permission` reconciler | F2 |
| **F8** | Join confirmation | `POST /join/:token/confirm` | — |

```
F1 ──▶ F2 ──▶ F3 ──▶ F4      writes leave the hub, one cache at a time
        └───▶ F7
F5 ──▶ F6                     the constraint, then the reconciler that needs it
F8                            independent; ship anywhere
```

**F2 ships with one reconciler (`identity`)** — the cheapest and least destructive. It proves the core end to end: registry, context, audit, consent, apply. Every later feature adds a file and one line to `index.ts`.

**F5 must precede F6.** `work-repos:adopt` attaches a repo to a group by name. Without `unique(classId, title)`, two labs sharing a title compute the same repo name, and adoption could cross labs — one lab's student work under another lab's group.

**Migrations:** `0011` = `classes.reconciledAt` (F2). `0012` = `labs unique(classId, title)` (F5). If F5 lands first, swap the numbers and the filenames.

---

## F1 — Read-path safety net

`classes.ts:132-198` wraps the teacher check, three cache writes, and the DTO build in one `try { … } catch {}`. A failing `syncRoster` — a best-effort, self-healing, non-authoritative cache write — removes the teacher's class from their own hub. Live bug, independent of everything else.

The narrowing must be **structural**: wrap only the GitHub fetches. `classes-list.test.ts:39-45` mocks `orgInfo` to throw a plain `Error` with no `.status`, so any "does the error carry a status?" heuristic silently breaks the existing skip-on-GitHub-failure test.

### Task 1.1: Extract `callerGithub`

**Files:**
- Modify: `apps/api/src/lib/access.ts`, `apps/api/src/handlers/classes.ts:60-67`
- Create: `apps/api/test/caller.test.ts`

**Interfaces:**
- Produces: `callerGithub(db: Db, userId: string): Promise<{ ghId: number; githubId: string } | null>`

- [ ] **Step 1: Write the failing test**

```ts
import { env } from "cloudflare:test";
import { account, getDb, user } from "@labs/db";
import { beforeEach, expect, test } from "vitest";
import { callerGithub } from "../src/lib/access";

const db = getDb(env.DB);
const now = new Date();

beforeEach(async () => {
  await db.delete(account);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "U1", email: "u1@x.ch" });
});

const link = (accountId: string) =>
  db.insert(account).values({
    id: `a-${accountId}`, userId: "u1", providerId: "github",
    accountId, createdAt: now, updatedAt: now,
  });

test("returns both forms of the id", async () => {
  await link("61272178");
  expect(await callerGithub(db, "u1")).toEqual({ ghId: 61272178, githubId: "61272178" });
});

test("returns null when GitHub is not linked", async () => {
  expect(await callerGithub(db, "u1")).toBeNull();
});

test("returns null when accountId is not numeric", async () => {
  // accountId is a TEXT column; a non-numeric value is as good as absent.
  await link("not-a-number");
  expect(await callerGithub(db, "u1")).toBeNull();
});
```

- [ ] **Step 2: Run it, watch it fail**

```bash
pnpm --filter @labs/api exec vitest run test/caller.test.ts
```
Expected: `callerGithub is not exported`.

- [ ] **Step 3: Implement**

In `apps/api/src/lib/access.ts`:

```ts
/**
 * The caller's GitHub identity, both forms. `account.accountId` is TEXT: for the
 * `github` provider it holds a numeric id, and a non-numeric value is as good as
 * absent. Callers need the number (GitHub APIs) and the string
 * (`class_members.githubId` comparisons).
 */
export async function callerGithub(
  db: Db,
  userId: string,
): Promise<{ ghId: number; githubId: string } | null> {
  const row = await db.query.account.findFirst({
    where: (a, op) => op.and(op.eq(a.userId, userId), op.eq(a.providerId, "github")),
    columns: { accountId: true },
  });
  if (!row) return null;
  const ghId = Number(row.accountId);
  return Number.isFinite(ghId) ? { ghId, githubId: row.accountId } : null;
}
```

Add `type Db = ReturnType<typeof getDb>;` if absent.

- [ ] **Step 4: Run it, watch it pass**

```bash
pnpm --filter @labs/api exec vitest run test/caller.test.ts
```
Expected: `Tests  3 passed (3)`.

- [ ] **Step 5: Replace both call sites**

`resolveClassAsTeacher` (`access.ts:131-137`):
```ts
  const caller = await callerGithub(db, c.get("user").id);
  if (!caller) return null;
```
then `isOrgAdmin(..., caller.ghId)`.

`listClasses` (`classes.ts:60-69`): rename the existing `const caller = c.get("user")` to `callerUser`, then:
```ts
  const caller = await callerGithub(db, callerUser.id);
  const token = await githubAccessToken(c.env, callerUser.id);
  if (!caller || !token) {
    return c.json({ classes: [], enrolled: [], hasOlder: false });
  }
```
Replace later `ghId` → `caller.ghId`, and `ghAccount.accountId` (`:213`, `:290`) → `caller.githubId`.

- [ ] **Step 6: Verify and commit**

```bash
pnpm --filter @labs/api test && pnpm --filter @labs/api exec tsc --noEmit && pnpm biome
git add apps/api/src/lib/access.ts apps/api/src/handlers/classes.ts apps/api/test/caller.test.ts
git commit -m "$(cat <<'EOF'
refactor(api): extract callerGithub

The caller's GitHub identity was derived twice — handlers/classes.ts:60 and
lib/access.ts:131 — each re-deriving the Number.isFinite invariant that exists
because account.accountId is a TEXT column. One function, two call sites.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.2: Fence the per-class loop

**Files:**
- Modify: `apps/api/src/handlers/classes.ts:129-198`
- Test: `apps/api/test/classes-list.test.ts`

- [ ] **Step 1: Write the failing test**

Add a togglable `syncRoster` mock beside the others, `failSyncRoster: false` in `state`, reset in `beforeEach`:

```ts
const syncRosterMock = vi.hoisted(() =>
  vi.fn(async () => {
    if (state.failSyncRoster) throw new Error("simulated D1 failure");
  }),
);
vi.mock("../src/lib/enrollment", () => ({ syncRoster: syncRosterMock }));
```

```ts
test("a failing roster sync does not hide the teacher's class", async () => {
  // syncRoster writes a DISPLAY CACHE. Best-effort, self-healing. It must never
  // take down a live, authorized read.
  await seedClass();
  state.failSyncRoster = true;

  const res = await app.request("/api/classes", {}, env);

  expect(res.status).toBe(200);
  const body = (await res.json()) as { classes: unknown[] };
  expect(body.classes).toHaveLength(1);
});
```

- [ ] **Step 2: Run it, watch it fail**

```bash
pnpm --filter @labs/api exec vitest run test/classes-list.test.ts -t "failing roster sync"
```
Expected: `expected 0 to be 1` — the `catch {}` swallowed the throw and `continue`d.

- [ ] **Step 3: Implement**

Replace the `for (const cls of rows)` body:

```ts
  for (const cls of rows) {
    const live = byOrgId.get(cls.orgId);
    if (!live) continue; // App uninstalled from this org — skip.

    // ONLY the GitHub fetches are skippable. An org can rate-limit, revoke its
    // installation, or vanish; that is this class's problem. Everything below is
    // ours, and a failure there is a bug, not org state.
    let people: Awaited<ReturnType<typeof orgPeople>>;
    let org: Awaited<ReturnType<typeof orgInfo>>;
    try {
      [people, org] = await Promise.all([
        orgPeople(c.env, live.installationId, live.login),
        orgInfo(c.env, live.installationId, live.login),
      ]);
    } catch {
      continue;
    }

    // F5a: only live org Owners see the class. Never the cache.
    if (!people.teachers.some((t) => t.id === caller.ghId)) continue;

    // Best-effort cache refresh (data-model spec §2: drift self-heals, and never
    // affects access control). A failure must not remove a class the caller is
    // demonstrably a teacher of. F2-F4 move these writes behind Reconcile.
    await refreshCaches(db, cls, live, org, people).catch((err) => {
      console.warn("class cache refresh failed", { classId: cls.id, err });
    });

    const users = await linkedUsers(db,
      [...people.teachers, ...people.students].map((p) => String(p.id)));
    out.push({ /* …unchanged DTO… */ });
  }
```

Extract the three writes verbatim into `async function refreshCaches(db, cls, live, org, people)` above `listClasses`, with a docstring naming it as temporary.

- [ ] **Step 4: Run, watch pass**

```bash
pnpm --filter @labs/api test
```
Expected: the pre-existing "skips a class whose GitHub calls fail" test still passes — `orgInfo` throws a plain `Error`, now inside the narrowed `try`.

- [ ] **Step 5: Prove the red was real**

```bash
git stash push apps/api/src/handlers/classes.ts
pnpm --filter @labs/api exec vitest run test/classes-list.test.ts -t "failing roster sync"
git stash pop
```
Expected while stashed: FAIL. If it passes, the test is not testing the fix.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/handlers/classes.ts apps/api/test/classes-list.test.ts
git commit -m "$(cat <<'EOF'
fix(api): a failing cache write no longer hides a teacher's class

listClasses wrapped the teacher check, three cache writes, and the DTO build in
one bare `catch {}`. Its comment blames "rate limit, revoked install" — but the
try also covered syncRoster and two db.update calls. A D1 hiccup was
indistinguishable from a revoked installation: the class silently vanished from
the teacher's hub, with no log.

Narrowed structurally, not heuristically: classes-list.test.ts mocks orgInfo to
throw a plain Error with no .status, so an error-shape heuristic would have
silently broken the existing skip-on-GitHub-failure test. Only the GitHub fetches
sit in the skippable try. The cache writes get their own fail-open catch and a
log. Anything else propagates as a 500, which is what a bug should do.

orgPeople and orgInfo are independent and now run in parallel.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### F1 feature test

```bash
pnpm --filter @labs/api test && pnpm --filter @labs/www test
pnpm --filter @labs/api exec tsc --noEmit && pnpm biome
```

Manual: sign in as the teacher; the hub lists classes exactly as before. **Nothing user-visible changes.** This feature only removes a failure mode.

---

## F2 — Reconcile core

Ships the whole subsystem end to end with one reconciler. Everything after this is a file plus one line.

### Task 2.1: `classes.reconciledAt`

**Files:** `packages/db/src/app-schema.ts`, `packages/db/migrations/0011_class_reconciled_at.sql`

- [ ] **Step 1: Add the column**

```ts
  // NULL = never reconciled. Cannot be inferred from class_members row count:
  // the join POSTs insert rows into a class that has never been reconciled, and
  // a reconciled class with no students still has teacher rows.
  reconciledAt: integer("reconciled_at", { mode: "timestamp" }),
```

- [ ] **Step 2: Generate, rename, apply**

```bash
pnpm --filter @labs/db db:generate
# rename the generated file to 0011_class_reconciled_at.sql and update meta/_journal.json
pnpm --filter @labs/api exec wrangler d1 migrations apply labs --local
```
Expected SQL: `ALTER TABLE \`classes\` ADD \`reconciled_at\` integer;`

- [ ] **Step 3: Commit**

```bash
git add packages/db
git commit -m "$(cat <<'EOF'
feat(db): classes.reconciledAt

NULL means the class has never been reconciled. It cannot be inferred from
class_members row count: the join POSTs insert rows into a class that has never
been reconciled, and a reconciled class with no students still has teacher rows.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.2: Types and the memoized context

**Files:**
- Create: `apps/api/src/lib/reconcile/types.ts`, `apps/api/src/lib/reconcile/context.ts`
- Test: `apps/api/test/reconcile-context.test.ts`

**Interfaces:**
- Produces: `Finding`, `FindingKey`, `Reconciler`, `ClassContext`, `buildContext(env, db, cls, live)`

- [ ] **Step 1: Write the failing test**

```ts
test("each source is fetched at most once per audit", async () => {
  const ctx = buildContext(env, db, cls, { installationId: 200, login: "acme" });

  await Promise.all([ctx.people(), ctx.people(), ctx.people()]);

  // roster and base-permission both want the people. GitHub is hit once.
  expect(orgPeople).toHaveBeenCalledTimes(1);
});

test("a source that is never asked for is never fetched", async () => {
  const ctx = buildContext(env, db, cls, { installationId: 200, login: "acme" });
  await ctx.orgInfo();
  expect(orgPeople).not.toHaveBeenCalled();
});

test("a failing source rejects every caller, and is retried on a fresh context", async () => {
  state.orgPeopleThrows = true;
  const ctx = buildContext(env, db, cls, { installationId: 200, login: "acme" });
  await expect(ctx.people()).rejects.toThrow();
  await expect(ctx.people()).rejects.toThrow();
  expect(orgPeople).toHaveBeenCalledTimes(1);   // the rejection is memoized too
});
```

- [ ] **Step 2: Run it, watch it fail** (`Failed to resolve import "../src/lib/reconcile/context"`)

- [ ] **Step 3: Implement `types.ts`**

```ts
/** Stable and derived from CONTENT, not a counter. Two audits of the same drift
 *  produce the same key; a changed drift is a different finding. The segment
 *  before the first ":" is the reconciler name — `applyFindings` dispatches on it. */
export type FindingKey = string; // "roster:remove:githubId=9"

export type Severity = "broken" | "drift" | "info";

export type Finding = {
  key: FindingKey;
  reconciler: string;
  severity: Severity;
  /** One line, for the checkbox. */
  title: string;
  /** What we saw, precisely. */
  detail: string;
  /** What Apply will do. `null` = we can see it, we cannot fix it. */
  fix: string | null;
  /** Deletes rows or revokes access. Starts UNCHECKED in the UI. */
  destructive: boolean;
};

export type AppliedOp = { key: FindingKey; ok: true };
export type FailedOp = { key: FindingKey; ok: false; error: string };

export type Reconciler = {
  name: string;
  audit(ctx: ClassContext): Promise<Finding[]>;
  /** Only ever called with keys THIS reconciler produced. Each op is idempotent. */
  apply(ctx: ClassContext, keys: FindingKey[]): Promise<(AppliedOp | FailedOp)[]>;
};
```

- [ ] **Step 4: Implement `context.ts`**

```ts
/** Memoize a zero-arg async thunk — including its rejection, so a failing source
 *  is not retried once per reconciler within one audit. */
function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= fn());
}

/**
 * Everything a reconciler may read, fetched lazily and at most once per audit.
 * `installationId` is the LIVE value, derived before any reconciler runs —
 * otherwise every GitHub reconciler fails against a dead pointer, which is
 * exactly when the page is needed.
 */
export function buildContext(
  env: AuthEnv,
  db: Db,
  cls: Class,
  live: { installationId: number; login: string },
): ClassContext {
  const { installationId } = live;
  const org = live.login;
  return {
    db, env, cls, org, installationId,
    orgInfo: once(() => orgInfo(env, installationId, org)),
    people: once(() => orgPeople(env, installationId, org)),
    basePermission: once(() => basePermission(env, installationId, org)),
    groups: once(() => groupsOfClass(db, cls.id)),
    orgRepos: once(() => orgRepoActivity(env, installationId, org)),
    members: once(() =>
      db.select().from(classMembers).where(eq(classMembers.classId, cls.id))),
  };
}
```

Add the matching `ClassContext` type to `types.ts`. `groupsOfClass` is a small
DB helper: every group of every lab of this class.

- [ ] **Step 5: Run, watch pass, commit**

```bash
pnpm --filter @labs/api exec vitest run test/reconcile-context.test.ts
git add apps/api/src/lib/reconcile apps/api/test/reconcile-context.test.ts
git commit -m "$(cat <<'EOF'
feat(api): reconcile types + lazy memoized ClassContext

A reconciler declares nothing; it asks. Each source is fetched at most once per
audit — roster and base-permission both call ctx.people(), and orgPeople (three
paginated calls) runs once. A source nobody asks for is never fetched.

Rejections are memoized too: a rate-limited orgPeople fails every reconciler that
needs it, once, rather than N times.

installationId is the LIVE value, derived before any reconciler runs. A dead
pointer would otherwise fail every GitHub reconciler — exactly when the page is
needed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.3: The registry — `runAudit` and `applyFindings`

**Files:**
- Create: `apps/api/src/lib/reconcile/index.ts`, `apps/api/src/lib/reconcile/identity.ts`
- Test: `apps/api/test/reconcile-registry.test.ts`

**Interfaces:**
- Consumes: `Reconciler`, `ClassContext` (Task 2.2)
- Produces: `runAudit(ctx): Promise<Finding[]>` (never rejects), `applyFindings(ctx, keys): Promise<(AppliedOp | FailedOp)[]>`

- [ ] **Step 1: Write the failing tests**

```ts
test("runAudit never rejects; a throwing reconciler becomes an info finding", async () => {
  const boom: Reconciler = {
    name: "boom",
    audit: async () => { throw new Error("GitHub rate limit"); },
    apply: async () => [],
  };
  const findings = await runAudit(ctx, [boom, identity]);

  expect(findings).toContainEqual(expect.objectContaining({
    key: "boom:unavailable", reconciler: "boom", severity: "info",
    fix: null, destructive: false,
  }));
  // The rest of the audit still reported.
  expect(findings.some((f) => f.reconciler === "identity")).toBe(true);
});

test("runAudit writes nothing", async () => {
  const before = await db.select().from(classes);
  await runAudit(ctx, ALL);
  expect(await db.select().from(classes)).toEqual(before);
});

test("applyFindings dispatches each key to the reconciler that owns it", async () => {
  const seen: string[] = [];
  const r = (name: string): Reconciler => ({
    name,
    audit: async () => [],
    apply: async (_ctx, keys) => { seen.push(...keys); return keys.map((key) => ({ key, ok: true as const })); },
  });
  await applyFindings(ctx, ["a:x", "b:y", "a:z"], [r("a"), r("b")]);
  expect(seen.sort()).toEqual(["a:x", "a:z", "b:y"]);
});

test("applyFindings rejects a key no reconciler owns", async () => {
  const [result] = await applyFindings(ctx, ["ghost:x"], [identity]);
  expect(result).toEqual({ key: "ghost:x", ok: false, error: "unknown_reconciler" });
});

test("one failing op does not abort the others", async () => {
  const r: Reconciler = {
    name: "r", audit: async () => [],
    apply: async (_c, keys) => keys.map((key) =>
      key.endsWith("bad")
        ? { key, ok: false as const, error: "nope" }
        : { key, ok: true as const }),
  };
  const results = await applyFindings(ctx, ["r:bad", "r:good"], [r]);
  expect(results).toHaveLength(2);
  expect(results.filter((x) => x.ok)).toHaveLength(1);
});
```

- [ ] **Step 2: Run, watch fail** (`runAudit is not exported`)

- [ ] **Step 3: Implement `index.ts`**

```ts
/** THE registry. Adding a reconciliation factor is adding a file and one line. */
export const RECONCILERS: Reconciler[] = [identity];

const unavailable = (r: Reconciler, err: unknown): Finding => ({
  key: `${r.name}:unavailable`,
  reconciler: r.name,
  severity: "info",
  title: `${r.name} could not be checked`,
  detail: err instanceof Error ? err.message : String(err),
  fix: null,
  destructive: false,
});

/**
 * Runs every reconciler. NEVER rejects: a module that throws yields one `info`
 * finding, so one flaky check never blocks the fix the teacher came for — which
 * matters most when a dead installation makes every GitHub reconciler fail.
 * Writes nothing.
 */
export async function runAudit(
  ctx: ClassContext,
  reconcilers: Reconciler[] = RECONCILERS,
): Promise<Finding[]> {
  const results = await Promise.all(
    reconcilers.map((r) => r.audit(ctx).catch((err) => [unavailable(r, err)])),
  );
  return results.flat();
}

/** Dispatches each key to its owning reconciler (the segment before the first
 *  ":"). One failing op never aborts the others. */
export async function applyFindings(
  ctx: ClassContext,
  keys: FindingKey[],
  reconcilers: Reconciler[] = RECONCILERS,
): Promise<(AppliedOp | FailedOp)[]> {
  const byName = new Map(reconcilers.map((r) => [r.name, r]));
  const grouped = new Map<string, FindingKey[]>();
  const unknown: FailedOp[] = [];
  for (const key of keys) {
    const name = key.split(":", 1)[0] ?? "";
    if (!byName.has(name)) {
      unknown.push({ key, ok: false, error: "unknown_reconciler" });
      continue;
    }
    grouped.set(name, [...(grouped.get(name) ?? []), key]);
  }
  const applied = await Promise.all(
    [...grouped].map(([name, ks]) =>
      // biome-ignore lint/style/noNonNullAssertion: presence checked above
      byName.get(name)!.apply(ctx, ks).catch((err): FailedOp[] =>
        ks.map((key) => ({ key, ok: false, error: String(err) }))),
    ),
  );
  return [...unknown, ...applied.flat()];
}
```

- [ ] **Step 4: Implement `identity.ts`**

```ts
/** The org's login/name/avatar, cached on the class row so the STUDENT hub is a
 *  pure DB read. Orgs get renamed; avatars change. */
export const identity: Reconciler = {
  name: "identity",
  async audit(ctx) {
    const org = await ctx.orgInfo();
    const drifted =
      org.login !== ctx.cls.login ||
      org.name !== ctx.cls.name ||
      org.avatarUrl !== ctx.cls.avatarUrl;
    if (!drifted) return [];
    return [{
      key: "identity:refresh",
      reconciler: "identity",
      severity: "drift",
      title: "The organization's details changed on GitHub",
      detail: `${ctx.cls.login} → ${org.login}${
        org.name !== ctx.cls.name ? ` · “${ctx.cls.name}” → “${org.name}”` : ""}`,
      fix: "Refresh the class card",
      destructive: false,
    }];
  },
  async apply(ctx, keys) {
    if (!keys.includes("identity:refresh")) return [];
    const org = await ctx.orgInfo();
    await ctx.db.update(classes).set({
      login: org.login, name: org.name, avatarUrl: org.avatarUrl,
      updatedAt: new Date(),
    }).where(eq(classes.id, ctx.cls.id));
    // Idempotent: re-applying writes the same values.
    return [{ key: "identity:refresh", ok: true }];
  },
};
```

- [ ] **Step 5: Run, watch pass, commit**

```bash
pnpm --filter @labs/api test
git add apps/api/src/lib/reconcile apps/api/test/reconcile-registry.test.ts
git commit -m "$(cat <<'EOF'
feat(api): reconcile registry + the identity reconciler

runAudit never rejects. A reconciler that throws yields one `info` finding with
fix: null, so the rest of the audit renders and remains applicable — nothing
silently reads as "all clear", and one flaky module never blocks the fix the
teacher came for.

applyFindings dispatches each key to the reconciler named by its first segment,
and one failing op never aborts the others.

The registry is a list. Adding a reconciliation factor is adding a file and one
line. It starts with `identity` — the cheapest, least destructive check — which
proves the core end to end.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.4: The endpoints

**Files:**
- Create: `apps/api/src/handlers/reconcile.ts`
- Modify: `apps/api/src/routes/classes.ts`
- Test: `apps/api/test/reconcile.test.ts`

**Interfaces:**
- Consumes: `callerGithub` (1.1), `buildContext` (2.2), `runAudit`/`applyFindings` (2.3)
- Produces:
  - `GET /api/classes/:id/audit` → `200 { auditedAt, findings: Finding[] }`
  - `POST /api/classes/:id/reconcile` → `200 { applied, failed, reconciledAt }`

- [ ] **Step 1: Write the failing tests**

```ts
test("audit reports drift and writes nothing", async () => {
  await seedClass({ orgId: 42, installationId: 200, login: "stale", name: "Stale" });
  state.org = { login: "acme", name: "Acme", avatarUrl: "http://a" };

  const res = await app.request("/api/classes/c1/audit", {}, env);

  expect(res.status).toBe(200);
  const body = (await res.json()) as { findings: Array<{ key: string }> };
  expect(body.findings.map((f) => f.key)).toContain("identity:refresh");
  const [row] = await db.select().from(classes);
  expect(row).toMatchObject({ login: "stale", name: "Stale" });   // untouched
});

test("audit and reconcile authorize live, against the LIVE installation", async () => {
  // resolveClassAsTeacher authorizes via the STORED pointer. If we used it, a
  // stale one would make the page that fixes it refuse to load.
  await seedClass({ orgId: 42, installationId: 111 });   // live is 200
  const res = await app.request("/api/classes/c1/audit", {}, env);
  expect(res.status).toBe(200);
});

test("audit is teacher-only", async () => {
  await seedClass({ orgId: 42, installationId: 200 });
  state.isOrgAdmin = false;
  const res = await app.request("/api/classes/c1/audit", {}, env);
  expect(res.status).toBe(404);
});

test("audit reports no_installation when the App is gone from the org", async () => {
  await seedClass({ orgId: 42, installationId: 200 });
  state.installations = [];
  const res = await app.request("/api/classes/c1/audit", {}, env);
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "no_installation" });
});

test("reconcile applies only the accepted keys and stamps reconciledAt", async () => {
  await seedClass({ orgId: 42, installationId: 200, login: "stale" });
  state.org = { login: "acme", name: "Acme", avatarUrl: "http://a" };

  const res = await app.request("/api/classes/c1/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keys: ["identity:refresh"] }),
  }, env);

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    applied: [{ key: "identity:refresh", ok: true }], failed: [],
  });
  const [row] = await db.select().from(classes);
  expect(row?.login).toBe("acme");
  expect(row?.reconciledAt).not.toBeNull();
});

test("reconcile applies nothing when no keys are accepted", async () => {
  await seedClass({ orgId: 42, installationId: 200, login: "stale" });
  state.org = { login: "acme", name: "Acme", avatarUrl: "http://a" };

  await app.request("/api/classes/c1/reconcile", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ keys: [] }),
  }, env);

  const [row] = await db.select().from(classes);
  expect(row?.login).toBe("stale");   // the teacher declined
});

test("reconcile is idempotent", async () => {
  await seedClass({ orgId: 42, installationId: 200, login: "stale" });
  state.org = { login: "acme", name: "Acme", avatarUrl: "http://a" };
  const body = JSON.stringify({ keys: ["identity:refresh"] });
  const opts = { method: "POST", headers: { "content-type": "application/json" }, body };

  await app.request("/api/classes/c1/reconcile", opts, env);
  const second = await app.request("/api/classes/c1/reconcile", opts, env);

  expect(second.status).toBe(200);
  expect(await second.json()).toMatchObject({ failed: [] });
});
```

- [ ] **Step 2: Run, watch fail** (all 404 — routes do not exist)

- [ ] **Step 3: Implement**

```ts
/** Both endpoints resolve the class the same way: derive the LIVE installation id
 *  first, then authorize against it. `resolveClassAsTeacher` authorizes via the
 *  stored pointer — a stale one would make the page that fixes it refuse to load.
 *  `class_members` may never authorize. */
async function teacherContext(c: Context<AuthedEnv>) {
  const db = getDb(c.env.DB);
  const userId = c.get("user").id;
  const caller = await callerGithub(db, userId);
  const token = await githubAccessToken(c.env, userId);
  if (!caller || !token) return { error: "not_found" as const, status: 404 as const };

  const [cls] = await db.select().from(classes).where(eq(classes.id, c.req.param("id")));
  if (!cls) return { error: "not_found" as const, status: 404 as const };

  const live = (await userInstallationsByOrgId(token)).get(cls.orgId);
  if (!live) return { error: "no_installation" as const, status: 403 as const };

  if (!(await isOrgAdmin(c.env, live.installationId, live.login, caller.ghId))) {
    return { error: "not_found" as const, status: 404 as const };
  }
  return { ctx: buildContext(c.env, db, cls, live) };
}

/** Read-only. Runs every reconciler. Writes nothing. */
export const auditClass = authedFactory.createHandlers(async (c) => {
  const r = await teacherContext(c);
  if ("error" in r) return c.json({ error: r.error }, r.status);
  return c.json({
    auditedAt: new Date().toISOString(),
    findings: await runAudit(r.ctx),
  });
});

const bodySchema = z.object({ keys: z.array(z.string()).max(200) });

/** Applies exactly the operations the teacher accepted. Never a bulk sweep. */
export const reconcileClass = authedFactory.createHandlers(
  zValidator("json", bodySchema),
  async (c) => {
    const r = await teacherContext(c);
    if ("error" in r) return c.json({ error: r.error }, r.status);
    const { keys } = c.req.valid("json");

    const results = await applyFindings(r.ctx, keys);
    const reconciledAt = new Date();
    await r.ctx.db.update(classes)
      .set({ reconciledAt, updatedAt: reconciledAt })
      .where(eq(classes.id, r.ctx.cls.id));

    return c.json({
      applied: results.filter((x) => x.ok),
      failed: results.filter((x) => !x.ok),
      reconciledAt: reconciledAt.toISOString(),
    });
  },
);
```

Register:
```ts
  .get("/classes/:id/audit", ...auditClass)
  .post("/classes/:id/reconcile", ...reconcileClass)
```

Match the `zValidator` import to whatever `handlers/labs.ts` already uses.

- [ ] **Step 4: Run, watch pass, commit**

```bash
pnpm --filter @labs/api test && pnpm --filter @labs/api exec tsc --noEmit && pnpm biome
git add apps/api/src/handlers/reconcile.ts apps/api/src/routes/classes.ts apps/api/test/reconcile.test.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /classes/:id/audit and POST /classes/:id/reconcile

The audit reads and writes nothing; reconcile applies exactly the keys the
teacher accepted, and stamps reconciledAt.

Both derive the LIVE installation id before authorizing. resolveClassAsTeacher
authorizes via orgLogin(cls.installationId) — the stored pointer — so a stale one
would make the page that exists to fix it refuse to load.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.5: The reconcile page

**Files:**
- Create: `apps/www/app/pages/reconcile-page.tsx`, `apps/www/app/routes/reconcile.tsx`
- Modify: `apps/www/app/routes.ts`, `apps/www/app/components/custom/classes/hub/class-card.tsx`
- Test: `apps/www/test/reconcile-page.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it("checks safe findings and leaves destructive ones for the teacher to opt into", () => {
  mockAudit([
    finding({ key: "identity:refresh", destructive: false }),
    finding({ key: "roster:remove:githubId=9", destructive: true, severity: "drift" }),
  ]);
  render(<ReconcilePage />);

  expect(screen.getByRole("checkbox", { name: /organization's details/ })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /left the organization/ })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Apply 1 selected" })).toBeInTheDocument();
});

it("applies only the checked keys", () => {
  mockAudit([finding({ key: "identity:refresh" }), finding({ key: "identity:other" })]);
  render(<ReconcilePage />);

  fireEvent.click(screen.getByRole("checkbox", { name: /other/ }));   // uncheck
  fireEvent.click(screen.getByRole("button", { name: "Apply 1 selected" }));

  expect(postSpy).toHaveBeenCalledWith(
    expect.objectContaining({ json: { keys: ["identity:refresh"] } }),
  );
});

it("shows an unfixable finding without a checkbox", () => {
  mockAudit([finding({ key: "roster:unavailable", severity: "info", fix: null })]);
  render(<ReconcilePage />);

  expect(screen.getByText(/could not be checked/)).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Apply/ })).toBeDisabled();
});

it("says so when there is nothing to fix", () => {
  mockAudit([]);
  render(<ReconcilePage />);
  expect(screen.getByText("This class is in sync with GitHub.")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, watch fail**

- [ ] **Step 3: Implement**

`routes.ts`: `route("classes/:id/reconcile", "routes/reconcile.tsx")`, and
`routes/reconcile.tsx` wraps `<ReconcilePage />` in `<Auth>` like
`routes/class-confirm.tsx`.

The page: `useApi` the audit, group findings by `reconciler`, render each as a
`<label>` + `<input type="checkbox">` + title + detail + fix. Findings with
`fix === null` render as a warning line with **no** checkbox. Initial checked set
= `findings.filter((f) => f.fix && !f.destructive).map((f) => f.key)`.

Destructive rows wear the `broken` tone (the `destructive` token). The submit
button reads `Apply {n} selected` and is disabled when `n === 0`.

`ClassCard` gains a `⋯` menu with **Reconcile…** → `Link to={`/classes/${id}/reconcile`}`.
The ellipsis says it navigates rather than acts.

- [ ] **Step 4: Run, watch pass, commit**

```bash
pnpm --filter @labs/www test && pnpm --filter @labs/www exec tsc --noEmit && pnpm biome
git add apps/www
git commit -m "$(cat <<'EOF'
feat(www): the class reconciliation page

/classes/:id/reconcile — a real route, not a popover: six reconcilers of
per-finding checkboxes do not fit in one. Reached from the class card's
"Reconcile…" (ellipsis: it navigates, it does not act).

Non-destructive fixes are pre-checked. Destructive ones start UNCHECKED and wear
the destructive tone: the teacher opts INTO deletion, never out of it. A finding
with fix: null renders as a warning with no checkbox — we can see it, we cannot
fix it.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### F2 feature test

1. `pnpm --filter @labs/api dev` + `pnpm --filter @labs/www dev`, sign in as the teacher.
2. Rename the org on GitHub (`Test-TWeb-2026` → `Test-TWeb-2026-x`).
3. Hub → class card → `⋯` → **Reconcile…**
4. The page lists **"The organization's details changed on GitHub"**, pre-checked. Nothing else.
5. **Before applying**, confirm the audit wrote nothing:
   ```bash
   cd apps/api && pnpm exec wrangler d1 execute DB --local \
     --command "SELECT login, name, reconciled_at FROM classes;"
   ```
   Unchanged; `reconciled_at` still `NULL`.
6. Press **Apply 1 selected**. Re-query: `login` corrected, `reconciled_at` stamped.
7. Reload the page: **"This class is in sync with GitHub."**
8. Press Apply again with nothing selected — button disabled.
9. Rename the org back, audit, and this time **uncheck** the finding, then Apply. The button is disabled; nothing is written. Consent is required.

---

## F3 — Installation pointer

### Task 3.1: `setup.ts` repairs without a session

**Files:** `apps/api/src/handlers/setup.ts`, `apps/api/test/setup.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("repairs a stale installationId with NO session", async () => {
  await seedClass({ orgId: 42, installationId: 200 });
  state.session = null;
  state.githubToken = null;
  state.installAccount = { id: 42, login: "acme", isOrganization: true };

  const res = await app.request("/api/github/setup?installation_id=999", {}, env);

  expect(res.status).toBe(302);
  const [row] = await db.select().from(classes);
  expect(row?.installationId).toBe(999);
});

test("a session-less repair never touches status, joinToken or provenance", async () => {
  await seedClass({ orgId: 42, installationId: 200, joinToken: "keep-me", connectedByUserId: "u1" });
  state.session = null;
  state.installAccount = { id: 42, login: "acme", isOrganization: true };

  await app.request("/api/github/setup?installation_id=999", {}, env);

  const [row] = await db.select().from(classes);
  expect(row).toMatchObject({
    installationId: 999, joinToken: "keep-me", connectedByUserId: "u1", status: "active",
  });
});

test("a session-less callback cannot CREATE a class", async () => {
  state.session = null;
  state.installAccount = { id: 77, login: "other", isOrganization: true };

  await app.request("/api/github/setup?installation_id=999", {}, env);

  expect(await db.select().from(classes)).toHaveLength(0);
});
```

- [ ] **Step 2: Run, watch fail** (`installationId` still `200`)

- [ ] **Step 3: Implement**

Reorder `githubSetupCallback`: resolve `installationAccount` (App JWT) **first**,
look up the row by `orgId`, and if it exists do a narrow `UPDATE` of the pointer
only — no session required. Never `status`, never `joinToken`, never
`connectedByUserId`. Create keeps `!session`, `!token`, `!userHasInstallation`.

- [ ] **Step 4: Run, watch pass, commit**

```bash
git add apps/api/src/handlers/setup.ts apps/api/test/setup.test.ts
git commit -m "$(cat <<'EOF'
fix(api): repair a stale installationId without a session

githubSetupCallback bailed on four preconditions before its write. Three are
insert-strength checks applied to a repair. installationAccount() runs on the
App's own JWT, so GitHub — not the caller — names the org that owns the
installation: an attacker passing an arbitrary installation_id cannot choose the
WHERE, and an App has exactly one installation per org. The worst achievable
write is the correct value, or a no-op.

Repair runs before any session check, and writes the pointer ONLY: `status` is
excluded so a session-less call can never resurrect a deactivated class.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3.2: The `installation` reconciler

**Files:** `apps/api/src/lib/reconcile/installation.ts`, `index.ts`, `apps/api/test/reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("audit offers to repoint a class whose installation was reinstalled", async () => {
  await seedClass({ orgId: 42, installationId: 111 });   // live is 200

  const res = await app.request("/api/classes/c1/audit", {}, env);

  const body = (await res.json()) as { findings: Array<{ key: string; destructive: boolean }> };
  expect(body.findings).toContainEqual(
    expect.objectContaining({ key: "installation:repair", destructive: false }),
  );
});

test("reconcile repairs the pointer it needed in order to authorize", async () => {
  await seedClass({ orgId: 42, installationId: 111 });

  await app.request("/api/classes/c1/reconcile", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ keys: ["installation:repair"] }),
  }, env);

  const [row] = await db.select().from(classes);
  expect(row?.installationId).toBe(200);
});
```

- [ ] **Step 2: Run, watch fail**

- [ ] **Step 3: Implement `installation.ts`**

```ts
const KEY = "installation:repair";

/** A reinstall mints a new installation id. `setup.ts` records it, but only if
 *  the browser that performed the reinstall reached the Setup URL. Nothing else
 *  does — and a stale pointer breaks every other route for students, who cannot
 *  repair it (re-deriving it needs /user/installations, which only lists
 *  installations the caller administers). */
export const installation: Reconciler = {
  name: "installation",
  async audit(ctx) {
    // ctx.installationId is the LIVE value, derived before any reconciler ran.
    if (ctx.installationId === ctx.cls.installationId) return [];
    return [{
      key: KEY,
      reconciler: "installation",
      severity: "broken",
      title: "The GitHub App was reinstalled",
      detail: `stored ${ctx.cls.installationId} → live ${ctx.installationId}`,
      fix: "Repoint the class at the current installation",
      destructive: false,
    }];
  },
  async apply(ctx, keys) {
    if (!keys.includes(KEY)) return [];
    // Keyed on orgId, like setup.ts: it is the only handle a reinstall preserves.
    await ctx.db.update(classes)
      .set({ installationId: ctx.installationId, updatedAt: new Date() })
      .where(eq(classes.orgId, ctx.cls.orgId));
    return [{ key: KEY, ok: true }];   // idempotent: rewrites the same value
  },
};
```

Register it **first** in `RECONCILERS`, so a dead pointer is the first thing the
teacher sees — every other GitHub reconciler depends on it being right.

- [ ] **Step 4: Run, watch pass, commit**

```bash
pnpm --filter @labs/api test
git add apps/api/src/lib/reconcile apps/api/test/reconcile.test.ts
git commit -m "$(cat <<'EOF'
feat(api): the installation reconciler

A reinstall mints a new installation id. setup.ts records it, but only if the
browser that performed the reinstall reached the Setup URL. Nothing else does.

Students structurally cannot repair a stale pointer: re-deriving it needs
GET /user/installations, which only lists installations the caller administers.
So this, and setup.ts, are the only two writers of classes.installationId.

Registered first: a dead pointer is what every other GitHub reconciler depends on.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3.3: The hub stops writing the `classes` row

**Files:** `apps/api/src/handlers/classes.ts`, `apps/api/src/lib/github/user.ts:51-73`, `apps/api/test/classes-list.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("the hub does not repair a stale installationId", async () => {
  await seedClass({ orgId: 42, installationId: 111 });
  await app.request("/api/classes", {}, env);
  const [row] = await db.select().from(classes);
  expect(row?.installationId).toBe(111);
});

test("the hub does not refresh the org identity cache", async () => {
  await seedClass({ orgId: 42, installationId: 200, login: "stale", name: "Stale" });
  await app.request("/api/classes", {}, env);
  const [row] = await db.select().from(classes);
  expect(row).toMatchObject({ login: "stale", name: "Stale" });
});

test("the hub still renders a stale class", async () => {
  // login and avatarUrl free-ride off /user/installations, already fetched.
  // `name` is OPTIONAL on that payload, so it comes from the row.
  await seedClass({ orgId: 42, installationId: 200, login: "stale", name: "Stale" });
  const res = await app.request("/api/classes", {}, env);
  const body = (await res.json()) as { classes: Array<{ login: string; name: string | null }> };
  expect(body.classes[0]).toMatchObject({ login: "acme", name: "Stale" });
});
```

- [ ] **Step 2: Run, watch fail**

- [ ] **Step 3: Implement**

Widen `UserInstallation` — `inst.account.avatar_url` is a required `string` on
`GET /user/installations` (typechecked); `inst.account.name` is
`string | null | undefined` there, therefore **not** trustworthy:

```ts
type UserInstallation = { installationId: number; login: string; avatarUrl: string };
```

In `classes.ts`: drop both `db.update(classes)` blocks from `refreshCaches`
(it now writes only `class_members`), delete the per-class `orgInfo` call, and
take `login`/`avatarUrl` from `live`, `name` from `cls`. Add
`reconciledAt: cls.reconciledAt` to the DTO.

- [ ] **Step 4: Run, watch pass, commit.**

### F3 feature test

**A. Session-less reinstall.** Uninstall the App from `Test-TWeb-2026`. In an **incognito window**, reinstall it from the org's settings. Land on `/`. Query: `installation_id` is new; `join_token`, `connected_by_user_id`, `status` unchanged.

**B. The hub never writes the class row.**
```bash
cd apps/api && pnpm exec wrangler d1 execute DB --local \
  --command "UPDATE classes SET login='stale', name='Stale', installation_id=1;"
```
Reload the hub — **the card still renders correctly** (login and avatar come from `/user/installations`); the *name* shows `Stale`. Re-query: **all three unchanged.**

**C. Reconcile fixes it.** Open `/classes/:id/reconcile`. It lists *"Installation was reinstalled"* and *"The organization's details changed"*. Note the page **loaded at all** with `installation_id = 1` — because it derives the live id before authorizing. Apply both. Re-query: all three corrected.

---

## F4 — Roster

### Task 4.1: The `roster` reconciler

**Files:** `apps/api/src/lib/reconcile/roster.ts`, `index.ts`, `apps/api/test/reconcile-roster.test.ts`

**Interfaces:**
- Produces keys: `roster:add:githubId=N`, `roster:remove:githubId=N`, `roster:promote:githubId=N`, `roster:demote:githubId=N`, `roster:refresh:githubId=N`

- [ ] **Step 1: Write the failing tests**

```ts
test("finds a member who joined the org without using the link", async () => {
  // Every OTHER write point observes exactly one person: the caller. This is the
  // only whole-roster observer.
  state.people = { teachers: [], students: [{ id: 41, login: "walkin", avatarUrl: null }], pending: [] };

  const findings = await roster.audit(ctx);

  expect(findings).toContainEqual(expect.objectContaining({
    key: "roster:add:githubId=41", destructive: false,
  }));
});

test("marks a departure as destructive", async () => {
  await observeMember(db, "c1", { githubId: "9", login: "gone", avatarUrl: null }, "active");
  state.people = { teachers: [], students: [], pending: [] };

  const findings = await roster.audit(ctx);

  expect(findings).toContainEqual(expect.objectContaining({
    key: "roster:remove:githubId=9", destructive: true,
  }));
});

test("finds a promotion to org Owner", async () => {
  await observeMember(db, "c1", { githubId: "1", login: "prof", avatarUrl: null }, "active");
  state.people = { teachers: [{ id: 1, login: "prof", avatarUrl: null }], students: [], pending: [] };

  const findings = await roster.audit(ctx);
  expect(findings.map((f) => f.key)).toContain("roster:promote:githubId=1");
});

test("apply removes ONLY the accepted subject", async () => {
  // THE safety property. syncRoster deletes everyone absent from the live roster;
  // apply must never do that. A student the teacher did not name survives.
  await observeMember(db, "c1", { githubId: "9", login: "gone", avatarUrl: null }, "active");
  await observeMember(db, "c1", { githubId: "8", login: "alsogone", avatarUrl: null }, "active");
  state.people = { teachers: [], students: [], pending: [] };

  await roster.apply(ctx, ["roster:remove:githubId=9"]);

  const rows = await db.select().from(classMembers);
  expect(rows.map((r) => r.githubId)).toEqual(["8"]);
});

test("apply is idempotent for a subject already gone", async () => {
  const [r1] = await roster.apply(ctx, ["roster:remove:githubId=404"]);
  expect(r1).toEqual({ key: "roster:remove:githubId=404", ok: true });
});

test("audit writes nothing", async () => {
  await observeMember(db, "c1", { githubId: "9", login: "gone", avatarUrl: null }, "active");
  state.people = { teachers: [], students: [], pending: [] };
  await roster.audit(ctx);
  expect(await db.select().from(classMembers)).toHaveLength(1);
});
```

- [ ] **Step 2: Run, watch fail**

- [ ] **Step 3: Implement**

`audit` diffs `ctx.people()` against `ctx.members()`. **`apply` calls
`observeMember` / `forgetMember` per key — never `syncRoster`.**

```ts
/** "roster:remove:githubId=9" → "9". Findings are content-addressed, so the key
 *  IS the subject: nothing else needs to travel from audit to apply. */
const subjectOf = (key: FindingKey) => key.split("githubId=")[1] ?? "";

const f = (
  githubId: string, op: string, severity: Severity,
  destructive: boolean, detail: string, fix: string,
): Finding => ({
  key: `roster:${op}:githubId=${githubId}`,
  reconciler: "roster",
  severity,
  title: TITLES[op] ?? op,
  detail,
  fix,
  destructive,
});

const TITLES: Record<string, string> = {
  add: "A member is missing from the class roster",
  remove: "A member left the organization",
  promote: "A member became an organization Owner",
  demote: "An Owner is no longer an Owner",
  refresh: "A member's GitHub details changed",
};

/** GitHub's roster, flattened to the state we cache. */
const liveStates = (people: OrgPeople) =>
  new Map<string, { state: MemberState; p: OrgPerson }>([
    ...people.students.map((p) => [String(p.id), { state: "active" as const, p }] as const),
    ...people.pending.map((p) => [String(p.id), { state: "pending" as const, p }] as const),
    // Owners last: an Owner who is also a member must read as `teacher`.
    ...people.teachers.map((p) => [String(p.id), { state: "teacher" as const, p }] as const),
  ]);

export const roster: Reconciler = {
  name: "roster",
  async audit(ctx) {
    const live = liveStates(await ctx.people());
    const cached = new Map((await ctx.members()).map((m) => [m.githubId, m]));
    const findings: Finding[] = [];

    for (const [githubId, { state, p }] of live) {
      const was = cached.get(githubId);
      if (!was) {
        findings.push(f(githubId, "add", "drift", false,
          `@${p.login} is in the organization but not on the class roster`,
          "Add them to the class roster"));
      } else if (was.state !== state) {
        const op = state === "teacher" ? "promote" : was.state === "teacher" ? "demote" : "add";
        findings.push(f(githubId, op, "drift", false,
          `@${p.login} is “${state}” on GitHub, “${was.state}” here`,
          `Record them as ${state}`));
      } else if (was.login !== p.login || was.avatarUrl !== p.avatarUrl) {
        findings.push(f(githubId, "refresh", "info", false,
          `@${was.login} is now @${p.login}`, "Refresh their details"));
      }
    }
    for (const [githubId, was] of cached) {
      if (live.has(githubId)) continue;
      findings.push(f(githubId, "remove", "drift", /* destructive */ true,
        `@${was.login} is on the class roster but not in the organization`,
        "Remove them from the class roster"));
    }
    return findings;
  },

  async apply(ctx, keys) {
    // The live roster, for the subjects we are ADDING or PROMOTING. We must not
    // trust the client's description of them — only its choice of subject.
    const people = await ctx.people();
    const byId = new Map(
      [...people.teachers, ...people.students, ...people.pending]
        .map((p) => [String(p.id), p] as const),
    );
    const results: (AppliedOp | FailedOp)[] = [];

    for (const key of keys) {
      const githubId = subjectOf(key);
      try {
        if (key.startsWith("roster:remove:")) {
          // ONE row. Never syncRoster, which deletes everyone absent from the
          // live roster — a stale proposal would then wipe students it never
          // named. Deleting a row that is already gone is a success.
          await forgetMember(ctx.db, ctx.cls.id, githubId);
        } else {
          const p = byId.get(githubId);
          if (!p) throw new Error("subject_no_longer_on_roster");
          const state = people.teachers.some((t) => String(t.id) === githubId)
            ? "teacher"
            : people.pending.some((t) => String(t.id) === githubId)
              ? "pending"
              : "active";
          await observeMember(
            ctx.db, ctx.cls.id,
            { githubId, login: p.login, avatarUrl: p.avatarUrl },
            state,
          );
        }
        results.push({ key, ok: true });
      } catch (err) {
        results.push({ key, ok: false, error: String(err) });
      }
    }
    return results;
  },
};
```

`observeMember` is an upsert and `forgetMember` a delete-if-exists, so every op is
idempotent for free. `add`, `promote`, `demote` and `refresh` all collapse to the
same upsert — the finding's *title* differs, the operation does not.

`syncRoster` is now unused by the write path. Leave it; Task 4.2 deletes its last
caller.

- [ ] **Step 4: Run, watch pass, commit**

```bash
git commit -m "$(cat <<'EOF'
feat(api): the roster reconciler

The only whole-roster observer. Every other write point — observeMember,
forgetMember, the join POSTs — sees exactly one person: the caller. So this is the
only thing that can find a member who joined the org out of band, promote a new
org Owner, refresh a changed login, or notice a departure.

apply executes the enumerated operations for the keys the teacher accepted, one
subject at a time. It does NOT call syncRoster, whose semantics are "delete
everyone absent from the live roster" (enrollment.ts:84-85). A test pins this: a
student the teacher did not name survives an apply that removes one who was.

Consequently a stale proposal can only ever do too little, never too much. Every
op is idempotent — removing a subject that is already gone is a success.

Departures are `destructive: true` and start unchecked in the UI.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.2: The hub reads `class_members`

**Files:** `apps/api/src/handlers/classes.ts`, `apps/api/test/classes-list.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("the hub writes nothing at all", async () => {
  await seedClass({ orgId: 42, installationId: 111, login: "stale" });
  await app.request("/api/classes", {}, env);
  expect(await db.select().from(classMembers)).toHaveLength(0);
});

test("the hub reads people from class_members, not GitHub", async () => {
  await seedClass({ orgId: 42, installationId: 200 });
  await observeMember(db, "c1", { githubId: "7", login: "alice", avatarUrl: "http://a" }, "active");

  const res = await app.request("/api/classes", {}, env);

  const body = (await res.json()) as { classes: Array<{ students: unknown[] }> };
  expect(body.classes[0]?.students).toEqual([{ id: 7, login: "alice", avatarUrl: "http://a" }]);
  expect(orgPeople).not.toHaveBeenCalled();   // three paginated calls, avoided
});

test("the teacher check stays live", async () => {
  // class_members may NEVER authorize. A cached `teacher` row is not a role.
  await seedClass({ orgId: 42, installationId: 200 });
  await observeMember(db, "c1", { githubId: "111", login: "prof", avatarUrl: null }, "teacher");
  state.membershipRole = "member";

  const res = await app.request("/api/classes", {}, env);
  const body = (await res.json()) as { classes: unknown[] };
  expect(body.classes).toHaveLength(0);
});
```

- [ ] **Step 2: Run, watch fail**

- [ ] **Step 3: Implement**

Delete `refreshCaches` and its call — the hub now writes nothing. Fetch the
caller's login **once** for the whole request (`fetchGithubProfile(token)`).
Replace the per-class `orgPeople` with one `orgMembership(...)` and
`role === "admin"`. Read the people from `class_members` in one query for all
candidate classes, mapping each row to the client's existing `OrgPerson` shape:

```ts
const person = (m: typeof classMembers.$inferSelect) => ({
  id: Number(m.githubId), login: m.login ?? "unknown", avatarUrl: m.avatarUrl,
});
```

> `/user/installations` returns installations the caller can **access**, not ones
> they own — a student with push on a work repo can appear there. The live
> `orgMembership` check is mandatory, and the third test pins it.

- [ ] **Step 4: Run, watch pass, commit.**

### F4 feature test

1. Reset: `DELETE FROM class_members; UPDATE classes SET reconciled_at = NULL;`
2. Hub card reads **"Never reconciled"** — *not* `0 students`.
3. `/classes/:id/reconcile`: *"N students joined the organization"*, all pre-checked. Apply. Card shows real counts.
4. **The safety property.** Remove two students on GitHub. Audit → two `remove` findings, **both unchecked**. Check **one**. Apply. Query `class_members`: **exactly one row gone.** The other survives, and re-appears as a finding on the next audit.
5. Add a student to the org **directly on github.com**. Reload the hub — absent. Audit → `add`, apply → present.
6. Make a student an org **Owner**. Audit → `promote`. Apply → they move to the teachers chip.
7. **GitHub failure does not wipe the cache.** Kill your network, open the page. The roster row reads *"roster could not be checked"* with **no checkbox**, and the other reconcilers still report. Query `class_members`: intact.

---

## F5 — Lab-title uniqueness

### Task 5.1: Check production before touching the schema

- [ ] **Step 1: Run the duplicate check against BOTH databases**

```bash
cd apps/api
pnpm exec wrangler d1 execute DB --local  --command "SELECT class_id, title, COUNT(*) AS n FROM labs GROUP BY class_id, title HAVING n > 1;"
pnpm exec wrangler d1 execute DB --remote --command "SELECT class_id, title, COUNT(*) AS n FROM labs GROUP BY class_id, title HAVING n > 1;"
```

Expected: `"results": []` for both. **If production returns rows, STOP** — the
unique index fails on apply. Rename the duplicates by hand first.

### Task 5.2: The constraint

**Files:** `packages/db/src/app-schema.ts`, `packages/db/migrations/0012_lab_title_unique.sql`, `apps/api/src/handlers/labs.ts`, `apps/api/test/labs.test.ts`, `apps/www/app/components/custom/classes/labs/lab-dialog.tsx`, `apps/www/test/lab-dialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
test("two labs in one class cannot share a title", async () => {
  expect((await createLab({ title: "Lab 1" })).status).toBe(200);
  const second = await createLab({ title: "Lab 1" });
  expect(second.status).toBe(409);
  expect(await second.json()).toEqual({ error: "title_taken" });
});

test("renaming a lab onto another lab's title is refused", async () => {
  const a = await createLab({ title: "Lab 1" });
  await createLab({ title: "Lab 2" });
  const { id } = (await a.json()) as { id: string };
  const res = await updateLab(id, { title: "Lab 2" });
  expect(res.status).toBe(409);
});

test("a lab keeps its own title on update", async () => {
  const a = await createLab({ title: "Lab 1" });
  const { id } = (await a.json()) as { id: string };
  expect((await updateLab(id, { title: "Lab 1", deadline: "2099-01-01T00:00:00.000Z" })).status).toBe(200);
});
```

- [ ] **Step 2: Run, watch fail** (`expected 200 to be 409`)

- [ ] **Step 3: Schema + migration**

```ts
export const labs = sqliteTable("labs", { /* …unchanged… */ },
  // The group slug — and so the WORK REPO NAME — is
  // slugify(lab.title)-slugify(group.name). Without this, two labs in one class
  // share a repo namespace, and `work-repos:adopt` could attach one lab's
  // student work to another lab's group.
  (t) => [unique().on(t.classId, t.title)],
);
```

```bash
pnpm --filter @labs/db db:generate     # expect: CREATE UNIQUE INDEX, one statement
pnpm --filter @labs/api exec wrangler d1 migrations apply labs --local
```

- [ ] **Step 4: Guard the handlers**

`createLab`, before the insert:
```ts
  const [clash] = await access.db.select({ id: labs.id }).from(labs)
    .where(and(eq(labs.classId, access.cls.id), eq(labs.title, input.title)));
  if (clash) return c.json({ error: "title_taken" }, 409);
```
`updateLab`: the same, plus `ne(labs.id, lab.id)`. Import `ne` from `drizzle-orm`.
The index is the backstop; these give a clean 409 instead of a 500.

- [ ] **Step 5: SPA copy**

`lab-dialog.tsx`: `case "title_taken": return "A lab with that title already exists in this class.";`
plus a matching test in `lab-dialog.test.tsx`.

- [ ] **Step 6: Verify all, commit.**

### F5 feature test

New lab `Lab 1` → created. New lab `Lab 1` again → *"A lab with that title already exists in this class."* Edit `Lab 1`, change only the deadline → saves. Create `Lab 2`, rename to `Lab 1` → refused.

---

## F6 — Group recovery

### Task 6.1: `teamMissing` instead of deleting

**Files:** `apps/api/src/lib/groups.ts:261-273`, `apps/api/test/lab-groups.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("a group whose GitHub team is gone is marked, not deleted", async () => {
  await seedLab();
  await seedGroup({ id: "g1", slug: "lab-l1-alpha", ghRepoFullName: "acme/lab-l1-alpha", ghRepoId: 500 });
  delete state.rosters["lab-l1-alpha"];

  const res = await listGroups("l1");

  const body = (await res.json()) as { groups: Array<Record<string, unknown>> };
  expect(body.groups).toMatchObject([{ id: "g1", teamMissing: true, members: [] }]);
  expect(await db.select().from(groups)).toHaveLength(1);   // row survives
});

test("a healthy group is not marked", async () => {
  await seedLab();
  await seedGroup({ id: "g1", slug: "lab-l1-alpha" });
  state.rosters["lab-l1-alpha"] = [{ id: 7, login: "alice", avatarUrl: null }];
  const res = await listGroups("l1");
  const body = (await res.json()) as { groups: Array<{ teamMissing: boolean }> };
  expect(body.groups[0]?.teamMissing).toBe(false);
});
```

- [ ] **Step 2: Run, watch fail** (the group array is empty; the row is gone)

- [ ] **Step 3: Implement** — `groupsWithRosters` maps instead of deleting:
`members: members ?? []`, `teamMissing: members === null`. Rewrite (do not delete)
any existing test that asserted the orphan row was removed.

- [ ] **Step 4: Run, watch pass, commit**

```bash
git commit -m "$(cat <<'EOF'
fix(api): a GET no longer deletes group rows

groupsWithRosters dropped the group row whenever its GitHub team 404'd. A teacher
loading their lab page destroyed rows — and orphaned the work repo, contradicting
the invariant deleteGroup exists to protect ("refuse rather than orphan it",
handlers/groups.ts:79-81) and that the UI enforces
(teacher-lab-groups.tsx:487-491). Two paths, opposite rules; the silent one won on
page load.

The group is now returned with teamMissing: true. That state matters: repo access
is granted TO the team (grantTeamRepo), so when the team dies the students lose
push on their own work repo. Deleting the row hid the breakage.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 6.2: `group-teams` and `work-repos` reconcilers

**Files:** `apps/api/src/lib/reconcile/group-teams.ts`, `work-repos.ts`, `index.ts`, `apps/api/test/reconcile-groups.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("offers to recreate a missing team, and re-grants the repo", async () => {
  await seedGroup({ id: "g1", slug: "lab-l1-alpha", ghTeamSlug: "lab-l1-alpha",
                    ghRepoFullName: "acme/lab-l1-alpha", ghRepoId: 500 });
  delete state.rosters["lab-l1-alpha"];

  const findings = await groupTeams.audit(ctx);
  expect(findings).toContainEqual(expect.objectContaining({
    key: "group-teams:recreate:groupId=g1", severity: "broken", destructive: false,
  }));

  await groupTeams.apply(ctx, ["group-teams:recreate:groupId=g1"]);
  expect(grantTeamRepoMock).toHaveBeenCalledWith(
    expect.anything(), expect.anything(), "acme", "lab-l1-alpha", "acme/lab-l1-alpha");
});

test("recreating a team that already exists is a no-op success", async () => {
  await seedGroup({ id: "g1", slug: "lab-l1-alpha", ghTeamSlug: "lab-l1-alpha" });
  state.rosters["lab-l1-alpha"] = [];
  const [r] = await groupTeams.apply(ctx, ["group-teams:recreate:groupId=g1"]);
  expect(r).toEqual({ key: "group-teams:recreate:groupId=g1", ok: true });
});

test("offers to adopt a repo that exists but was never recorded", async () => {
  await seedGroup({ id: "g1", slug: "lab-l1-alpha", ghRepoFullName: null });
  state.orgRepos = new Map([["acme/lab-l1-alpha", { pushedAt: null, createdAt: null }]]);

  const findings = await workRepos.audit(ctx);
  expect(findings).toContainEqual(expect.objectContaining({
    key: "work-repos:adopt:groupId=g1", severity: "broken", destructive: false,
  }));

  await workRepos.apply(ctx, ["work-repos:adopt:groupId=g1"]);
  const [row] = await db.select().from(groups);
  expect(row?.ghRepoFullName).toBe("acme/lab-l1-alpha");
});

test("work-repos never proposes to adopt a lab's own template", async () => {
  // Adoption ends in grantTeamRepo. A group slug colliding with the template's
  // name would hand the students push on the starter code.
  await seedLab({ templateRepoFullName: "acme/lab-l1-alpha" });
  await seedGroup({ id: "g1", slug: "lab-l1-alpha", ghRepoFullName: null });
  state.orgRepos = new Map([["acme/lab-l1-alpha", { pushedAt: null, createdAt: null }]]);

  expect(await workRepos.audit(ctx)).toEqual([]);
});
```

- [ ] **Step 2: Run, watch fail**

- [ ] **Step 3: Implement `group-teams.ts`**

`audit`: for each `ctx.groups()`, `ctx.env`-fetch its roster; `null` ⇒ the team
404s ⇒ a `broken` finding. `apply`:

```ts
      // Idempotent: a team that already exists 422s, which means "already done".
      let team: { id: number; slug: string };
      try {
        team = await createTeam(ctx.env, ctx.installationId, ctx.org, group.slug);
      } catch (err) {
        if ((err as { status?: number }).status !== 422) throw err;
        results.push({ key, ok: true });
        continue;
      }
      // Repo access was granted TO the old team and died with it.
      if (group.ghRepoFullName) {
        await grantTeamRepo(ctx.env, ctx.installationId, ctx.org, team.slug, group.ghRepoFullName);
      }
      await ctx.db.update(groups)
        .set({ ghTeamId: team.id, ghTeamSlug: team.slug, updatedAt: new Date() })
        .where(eq(groups.id, group.id));
```

The roster died with the team — it only ever lived in GitHub — so the group comes
back **empty** and the teacher re-adds from the pool.

- [ ] **Step 4: Implement `work-repos.ts`**

```ts
  async audit(ctx) {
    const repos = await ctx.orgRepos();
    const findings: Finding[] = [];
    for (const group of await ctx.groups()) {
      if (group.ghRepoFullName) continue;              // already recorded
      const fullName = `${ctx.org}/${group.slug}`;
      if (!repos.has(fullName)) continue;              // nothing to adopt
      // NEVER the lab's own template. Adoption ends in grantTeamRepo, so a group
      // slug colliding with the template's name would hand the students push on
      // the starter code. (F5's unique(classId,title) makes the collision rare;
      // this makes it impossible.)
      if (isSameRepo(group.labTemplateRepoFullName, fullName)) continue;
      findings.push({
        key: `work-repos:adopt:groupId=${group.id}`,
        reconciler: "work-repos", severity: "broken",
        title: "A work repository exists but is not linked",
        detail: `${fullName} was created but never recorded on ${group.name}`,
        fix: "Link it to the group and re-grant the team",
        destructive: false,
      });
    }
    return findings;
  },
```

`apply` reuses `getOrgRepo` + `grantTeamRepo` + the row write — the same
find-or-create path `createWorkRepo` already has. `ctx.groups()` must select the
lab's `templateRepoFullName` alongside the group row for the guard above.

> `groups.ghRepoId` is globally `.unique()` (`app-schema.ts:93`) and adoption
> writes it. Adoption is only safe while no *other* group row holds that repo id —
> true for the unrecorded case, and guaranteed for everything else by F5.

- [ ] **Step 5: Run, watch pass, commit**

```bash
pnpm --filter @labs/api test
git add apps/api/src/lib/reconcile apps/api/test/reconcile-groups.test.ts
git commit -m "$(cat <<'EOF'
feat(api): the group-teams and work-repos reconcilers

group-teams: a group whose GitHub team was deleted is stuck — it cannot be deleted
(has_repo), cannot be worked in (repo access was granted TO the team, so the
students lost push), and nothing recreated a team. Recreating it under the stored
slug and re-running grantTeamRepo restores push; the roster died with the team, so
the group returns empty. A 422 means the team is already back: idempotent.

work-repos: a repo exists at the group's slug but ghRepoFullName is NULL — a
partial createWorkRepo. Adopt it. Never the lab's own template: adoption ends in
grantTeamRepo, and a group slug colliding with the template's name would hand the
students push on the starter code.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 6.3: The `team missing` marker

**Files:** `apps/www/.../use-lab-groups.ts`, `teacher/roster.tsx`, `teacher-lab-groups.tsx`, `apps/www/test/teacher-lab-page.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("marks a group whose GitHub team is gone", () => {
  mockApi({ classes: [teachingClass], enrolled: [] }, {
    ...groupsData,
    groups: [grp({ members: [], teamMissing: true, repoFullName: "acme/lab1-team-alpha" })],
  });
  render(<TeacherLabPage />);

  expect(screen.getByText("team missing")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Manage Team Alpha" }));
  // Fixing it lives on the reconcile page, not here.
  expect(screen.getByRole("link", { name: /Reconcile/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete group" })).toBeDisabled();
});
```

Add `teamMissing: false` to the `grp()` fixture.

- [ ] **Step 2: Run, watch fail** (`Unable to find an element with the text: team missing`)

- [ ] **Step 3: Implement**

`use-lab-groups.ts` — widen the union and rank it **first**; a group whose roster
is unknowable has no meaningful size or activity:

```ts
export type GroupLabStatus =
  | "team_missing"
  | "under_min" | "no_repo" | "no_pushes" | "on_track" | "on_time" | "late" | "ready";

  const statusFor = (group: GroupItem): GroupLabStatus => {
    if (group.teamMissing) return "team_missing";
    if (!group.repoFullName) { /* …unchanged… */ }
```

`teacher/roster.tsx` — both maps are `Record<GroupLabStatus, …>`, so `tsc` refuses
to compile until each gains an entry:

```ts
const TONE = {
  good: "bg-role-enrolled/10 text-role-enrolled",
  warn: "bg-warning/12 text-warning",
  bad: "bg-brand/10 text-brand",
  muted: "bg-foreground/6 text-muted-foreground",
  // Broken infrastructure, not late work. Scanning the spine column, a teacher
  // must tell "this group is behind" from "this group is broken" without reading.
  broken: "bg-destructive/10 text-destructive",
} as const;

export const STATUS_SPINE: Record<GroupLabStatus, string> = {
  /* …existing… */ team_missing: "border-l-destructive",
};

const CHIP: Record<GroupLabStatus, { label: string; tone: PillTone }> = {
  /* …existing… */ team_missing: { label: "team missing", tone: "broken" },
};
```

`teacher-lab-groups.tsx` — `team_missing` is **not** in `GOOD_STATUSES`, so it
counts as "needs attention". Render the Members cell as `—` (an `AvatarCluster` of
zero reads as "empty group", a different thing), and put the recovery where it
lives:

```tsx
        {group.teamMissing ? (
          <Text variant="caption">
            Its GitHub team is gone — students cannot push.{" "}
            <Link to={`/classes/${classId}/reconcile`}>Reconcile the class</Link>
          </Text>
        ) : null}
```

- [ ] **Step 4: Run, watch pass, commit**

```bash
pnpm --filter @labs/www test && pnpm --filter @labs/www exec tsc --noEmit && pnpm biome
git add apps/www
git commit -m "$(cat <<'EOF'
feat(www): mark a group whose GitHub team is gone

GroupLabStatus gains team_missing, ranked first in statusFor — a group whose
roster is unknowable has no meaningful size or activity. STATUS_SPINE and CHIP are
both Record<GroupLabStatus, ...>, so the type checker forced the marker into
existence.

A fifth Pill tone, `broken`, on the destructive token: distinct from `bad` (brand
red = late work). Scanning the spine column, a teacher must tell "behind" from
"broken" without reading — they are different actions.

The fix lives on the reconcile page. Delete stays disabled while a repo exists.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### F6 feature test

1. Lab page → a group with a work repo. On **github.com**, delete that group's team.
2. Reload the lab page. Red spine, **`team missing`** chip, Members cell `—`. **The row still exists.**
3. `gh repo view Test-TWeb-2026/<slug>` — the repo survived.
4. Confirm a student in that group can no longer push. *This is the breakage the marker names.*
5. `/classes/:id/reconcile` → *"Team Alpha no longer exists on GitHub"*, pre-checked. Apply.
6. The team is back on GitHub, with push on the repo (`Settings → Collaborators and teams`). The group is empty; add a student from the pool; they can push again.
7. **Unrecorded repo:** `UPDATE groups SET gh_repo_full_name = NULL WHERE id = '<g>';` Audit → *"Repository … is not recorded"*. Apply → re-linked, no repo created.

---

## F7 — Base permission

### Task 7.1: The `base-permission` reconciler

`confirmClass` (`classes.ts:30-31`) sets the org's base repository permission to
`none` and verifies it **once, at class creation** — it is the only caller of
`setBasePermissionNone`/`basePermission` (verified). Nothing re-checks it. A
teacher can flip it back on GitHub and every student silently gains read access
to every repository in the org, including other groups' work repos.

**Files:** `apps/api/src/lib/reconcile/base-permission.ts`, `index.ts`, `apps/api/test/reconcile-permission.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("flags a base permission that is not none", async () => {
  state.basePermission = "read";

  const findings = await basePermissionReconciler.audit(ctx);

  expect(findings).toContainEqual(expect.objectContaining({
    key: "base-permission:reset", severity: "broken", destructive: true,
    fix: expect.stringContaining("none"),
  }));
});

test("says nothing when the permission is already none", async () => {
  state.basePermission = "none";
  expect(await basePermissionReconciler.audit(ctx)).toEqual([]);
});

test("apply sets it back, and is idempotent", async () => {
  state.basePermission = "read";
  await basePermissionReconciler.apply(ctx, ["base-permission:reset"]);
  expect(setBasePermissionNoneMock).toHaveBeenCalledOnce();

  state.basePermission = "none";
  const [r] = await basePermissionReconciler.apply(ctx, ["base-permission:reset"]);
  expect(r).toEqual({ key: "base-permission:reset", ok: true });
});
```

- [ ] **Step 2: Run, watch fail**

- [ ] **Step 3: Implement `base-permission.ts`**

```ts
const KEY = "base-permission:reset";

/** confirmClass sets this to "none" once, at class creation, and never re-checks
 *  it. A teacher can flip it back on GitHub and every member silently gains read
 *  access to every repository in the org — including other groups' work repos. */
export const basePermission: Reconciler = {
  name: "base-permission",
  async audit(ctx) {
    const perm = await ctx.basePermission();
    if (perm === "none") return [];
    return [{
      key: KEY,
      reconciler: "base-permission",
      severity: "broken",
      title: "Every member can read every repository",
      detail: `The organization's base repository permission is “${perm}”, not “none”.`,
      fix: "Set the base permission back to none",
      // Applying REVOKES access. Marked destructive so it starts unchecked — but
      // the copy above says which way the hazard actually runs.
      destructive: true,
    }];
  },
  async apply(ctx, keys) {
    if (!keys.includes(KEY)) return [];
    // Idempotent: setting "none" when it is already "none" is a no-op on GitHub.
    await setBasePermissionNone(ctx.env, ctx.installationId, ctx.org);
    return [{ key: KEY, ok: true }];
  },
};
```

Register in `RECONCILERS`. Export it as `basePermission`; the test imports it as
`basePermissionReconciler` to avoid colliding with the `org.ts` function of the
same name.

- [ ] **Step 4: Run, watch pass, commit**

```bash
git commit -m "$(cat <<'EOF'
feat(api): the base-permission reconciler

confirmClass sets the org's base repository permission to "none" and verifies it
once, at class creation (classes.ts:30-31 — its only caller). Nothing ever
re-checks it. A teacher can flip it back on GitHub and every student silently
gains read access to every repository in the org, including other groups' work
repos.

This is the reconciler that proves the abstraction earns its keep: the invariant
existed and was unverified, and there was no surface to hang the check on until
now. Adding it is one file and one line.

Marked destructive because applying REVOKES access — the copy says which way the
hazard actually runs.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### F7 feature test

On github.com: `Test-TWeb-2026 → Settings → Member privileges → Base permissions` → set to **Read**. Open `/classes/:id/reconcile`. Under **SECURITY**: *"Base repository permission is "read", not "none" — every member can read every repository"*, **unchecked**, in the destructive tone. Check it, Apply, and confirm on GitHub that base permission is back to **No permission**.

---

## F8 — Join confirmation

### Task 8.1: `POST /join/:token/confirm`

**Files:** `apps/api/src/handlers/join.ts`, `apps/api/src/routes/join.ts`, `apps/api/test/join.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("the join preview writes nothing", async () => {
  await seedClass();
  state.membership = { state: "active", role: "member" };
  const res = await app.request("/api/join/tok", {}, env);
  expect(res.status).toBe(200);
  expect(await db.select().from(classMembers)).toHaveLength(0);
});

test("confirm records the acceptance", async () => {
  await seedClass();
  await observeMember(db, "c1", { githubId: "7", login: "alice", avatarUrl: null }, "pending");
  state.membership = { state: "active", role: "member" };

  await app.request("/api/join/tok/confirm", { method: "POST" }, env);

  const [row] = await db.select().from(classMembers);
  expect(row?.state).toBe("active");
});

test("confirm forgets a member GitHub no longer knows", async () => {
  await seedClass();
  await observeMember(db, "c1", { githubId: "7", login: "alice", avatarUrl: null }, "active");
  state.membership = null;
  await app.request("/api/join/tok/confirm", { method: "POST" }, env);
  expect(await db.select().from(classMembers)).toHaveLength(0);
});
```

- [ ] **Step 2: Run, watch fail** (`expected 1 to be 0`; the others 404)

- [ ] **Step 3: Implement**

Delete the `observeMembership(...)` call **and** the `db.update(classes)` identity
refresh from `previewJoin`, leaving it a pure read. (The identity refresh is
deleted, not moved: the join page already fetches `orgInfo` live for its own
render, and the `identity` reconciler owns that write now.) Then:

```ts
/**
 * Records what the preview observed. The preview is a GET and writes nothing; the
 * student's page POSTs here once it reports they are already a member. Re-reads
 * live membership rather than trusting the client.
 */
export const confirmJoin = authedFactory.createHandlers(async (c) => {
  const token = c.req.param("token");
  if (!token) return c.json({ error: "invalid_link" }, 404);
  const r = await resolveJoin(c.env, c.get("user").id, token);
  if (!r.ok) return c.json({ error: r.error }, r.status);
  const { cls, login, username } = r.ctx;

  const membership = await orgMembership(c.env, cls.installationId, login, username);
  // Reuses the existing helper, so the `teacher` and forgetMember branches — a
  // member GitHub no longer knows — come along for free.
  await observeMembership(getDb(c.env.DB), cls, r.ctx, membership);

  return c.json({
    membership: membership?.state ?? null,
    role: membership?.role ?? null,
  });
});
```

Register `.post("/join/:token/confirm", ...confirmJoin)`. Existing `join.test.ts`
tests that asserted the *preview* upserts must be **moved** to `confirm`, not
deleted.

- [ ] **Step 4: Run, watch pass, commit**

```bash
pnpm --filter @labs/api test
git add apps/api/src/handlers/join.ts apps/api/src/routes/join.ts apps/api/test/join.test.ts
git commit -m "$(cat <<'EOF'
fix(api): the join preview stops writing

GET /join/:token upserted class_members and refreshed the org identity cache. Both
are writes on a GET, and the upsert was the only thing that recorded a student's
acceptance of the invite (there are no webhooks).

POST /join/:token/confirm now records it, re-reading live membership rather than
trusting the client. It reuses observeMembership, so the teacher and forgetMember
branches come along for free. The identity refresh is deleted rather than moved:
the join page already fetches orgInfo live for its own render, and the `identity`
reconciler owns that write now.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 8.2: "Finish joining"

**Files:** `apps/www/app/pages/join-page.tsx`, `apps/www/test/join-page.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("records the acceptance when the student finishes joining", () => {
  mockPreview({ membership: "active", role: "member" });
  render(<JoinPage />);

  expect(screen.getByText(/You've accepted the invite/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Finish joining" }));
  expect(confirmSpy).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, watch fail** (`Unable to find … name "Finish joining"`)

- [ ] **Step 3: Implement**

In `join-page.tsx`, when the preview reports the caller is already a member and is
not a teacher:

```tsx
  const [finishing, setFinishing] = useState(false);
  async function finish() {
    setFinishing(true);
    try {
      await api.api.join[":token"].confirm.$post({ param: { token } });
      navigate(`/classes/${cls.id}`);
    } finally {
      setFinishing(false);
    }
  }

  {membership === "active" && role !== "admin" ? (
    <>
      <Text variant="subtitle">You've accepted the invite on GitHub.</Text>
      <Button size="lg" disabled={finishing} onClick={finish}>
        {finishing ? "Finishing…" : "Finish joining"}
      </Button>
    </>
  ) : null}
```

Explicit rather than auto-fired on load: a mutation triggered by navigation is the
pattern this design removes, and an effect that fails on page load leaves the row
`pending` with nothing on screen to retry.

- [ ] **Step 4: Run, watch pass, commit**

```bash
pnpm --filter @labs/www test && pnpm biome
git add apps/www
git commit -m "$(cat <<'EOF'
feat(www): "Finish joining" records the acceptance

The join page's GET is now a pure preview. When it reports the student has already
accepted the GitHub invite, they press Finish joining, which POSTs
/join/:token/confirm. Explicit rather than auto-fired: a failure is visible and
retryable, where an effect on page load fails silently.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### F8 feature test

Two accounts (`Ovich` = teacher, `OvichHeigVD` = student).

1. Student opens the link, presses **Join**. Query `class_members`: one `pending` row.
2. Accept the org invite on **github.com**.
3. Reload the join link. It reads *"You've accepted the invite on GitHub."*
4. **Before clicking**, re-query: still `pending`. *The GET wrote nothing.*
5. Press **Finish joining**. Re-query: `active`. The student's hub shows the class.

---

## Self-review

**Spec coverage.** §1 audit → F1-F8. §2.1 findings → 2.2. §2.2 apply-never-sweeps → 4.1 (test: *"apply removes ONLY the accepted subject"*). §2.3 lazy context → 2.2. §2.4 registry → 2.3. §2.5 failing-reconciler-is-a-finding → 2.3. §3.1 installation → 3.2. §3.2 identity → 2.3. §3.3 roster → 4.1. §3.4 group-teams → 6.2. §3.5 work-repos → 6.2. §3.6 base-permission → 7.1. §4 endpoints → 2.4; `setup.ts` → 3.1; join → 8.1; `teamMissing` → 6.1. §5 reads → 3.3, 4.2. §6 schema → 2.1 (`reconciledAt`), 5.2 (`unique(classId,title)`). §7 page → 2.5. §9 testing → each task.

**Not covered, deliberately.** `enrolledTeachers`' inline join (`classes.ts:243-257`) duplicates `linkedUsers` — a duplication, not a defect. The `listClasses` decomposition: after F4 the loop is one GitHub call and no writes, so re-assess whether it still earns a split.

**Deviation from the spec.** §6 numbers `0011` = `reconciledAt`, `0012` = `labs unique(classId,title)`, matching F2-before-F5. If F5 ships first, swap both the numbers and the filenames.

**Type consistency.** `callerGithub` → `{ ghId, githubId }` (1.1), consumed in 1.2, 2.4, 4.2. `Finding`/`FindingKey`/`Reconciler`/`ClassContext` defined in 2.2, consumed by every reconciler and by 2.3, 2.4, 2.5. `buildContext(env, db, cls, live)` (2.2) called only in 2.4's `teacherContext`. `runAudit(ctx, reconcilers?)` / `applyFindings(ctx, keys, reconcilers?)` (2.3) — the optional second argument is what lets 2.3's tests inject fakes. `AppliedOp | FailedOp` returned by every `apply`. `teamMissing: boolean` produced in 6.1, consumed in 6.3. `UserInstallation.avatarUrl` added in 3.3, consumed there and in 4.2. `reconciledAt` added in 2.1, written in 2.4, read in 3.3, rendered in 2.5.

**Ordering hazard.** F6 Task 6.2 (`work-repos:adopt`) attaches a repo to a group by computed name. It **must not** ship before F5, or two labs sharing a title let adoption cross labs. The dependency is stated in the Features table and repeated here because it is the one ordering mistake that silently corrupts student work.

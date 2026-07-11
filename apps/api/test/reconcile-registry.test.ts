import { env } from "cloudflare:test";
import { classes, getDb, user } from "@labs/db";
import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import type { AuthEnv } from "../src/lib/auth/config";
import type { Reconciler } from "../src/lib/reconcile/types";

const state = vi.hoisted(() => ({
  org: { login: "acme", name: "Acme", avatarUrl: "http://a" },
}));

vi.mock("../src/lib/github/org", () => ({
  orgInfo: vi.fn(async () => state.org),
  orgPeople: vi.fn(async () => ({ teachers: [], students: [], pending: [] })),
  basePermission: vi.fn(async () => "none"),
}));

vi.mock("../src/lib/github/repo", () => ({
  orgRepoActivity: vi.fn(async () => new Map()),
}));

const { buildContext } = await import("../src/lib/reconcile/context");
const {
  runAudit,
  applyFindings,
  RECONCILERS: ALL,
} = await import("../src/lib/reconcile/index");
const { identity } = await import("../src/lib/reconcile/identity");

const db = getDb(env.DB);
const now = new Date(0);

// GitHub calls are mocked below, so only DB is ever actually read; the rest
// is dummy to satisfy the AuthEnv shape (same pattern as reconcile-context.test.ts).
const authEnv = {
  ...env,
  BETTER_AUTH_URL: "http://localhost:8787",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
  EDUID_ISSUER: "https://login.eduid.example",
  EDUID_CLIENT_ID: "eduid",
  EDUID_CLIENT_SECRET: "eduid-secret",
  GITHUB_CLIENT_ID: "Iv23test",
  GITHUB_CLIENT_SECRET: "gh-secret",
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: "unused",
  GITHUB_APP_SLUG: "labs",
} as AuthEnv;

async function seedClass(id: string, installationId: number) {
  await db.insert(classes).values({
    id,
    orgId: installationId,
    installationId,
    connectedByUserId: "u1",
    joinToken: `tok-${id}`,
    status: "active",
    login: "acme",
    name: "Acme",
    avatarUrl: "http://a",
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(classes).where(eq(classes.id, id));
  if (!row) throw new Error("seedClass: insert did not return a row");
  return row;
}

beforeEach(async () => {
  state.org = { login: "acme", name: "Acme", avatarUrl: "http://a" };
  await db.delete(classes);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "Prof", email: "prof@x.ch" });
});

test("runAudit never rejects; a throwing reconciler becomes an info finding", async () => {
  const cls = await seedClass("cls", 100);
  const ctx = buildContext(authEnv, db, cls, {
    installationId: 200,
    login: "acme",
  });
  const boom: Reconciler = {
    name: "boom",
    audit: async () => {
      throw new Error("GitHub rate limit");
    },
    apply: async () => [],
  };
  const findings = await runAudit(ctx, [boom, identity]);

  expect(findings).toContainEqual(
    expect.objectContaining({
      key: "boom:unavailable",
      reconciler: "boom",
      severity: "info",
      fix: null,
    }),
  );
  // The rest of the audit still reported (identity ran and found no drift,
  // since state.org matches the seeded class — the point is it didn't throw).
  expect(findings.some((f) => f.reconciler === "boom")).toBe(true);
});

test("runAudit writes nothing", async () => {
  const cls = await seedClass("cls", 100);
  const ctx = buildContext(authEnv, db, cls, {
    installationId: 200,
    login: "acme",
  });
  const before = await db.select().from(classes);
  await runAudit(ctx, ALL);
  expect(await db.select().from(classes)).toEqual(before);
});

test("applyFindings dispatches each key to the reconciler that owns it", async () => {
  const cls = await seedClass("cls", 100);
  const ctx = buildContext(authEnv, db, cls, {
    installationId: 200,
    login: "acme",
  });
  const seen: string[] = [];
  const r = (name: string): Reconciler => ({
    name,
    audit: async () => [],
    apply: async (_ctx, keys) => {
      seen.push(...keys);
      return keys.map((key) => ({ key, ok: true as const }));
    },
  });
  await applyFindings(ctx, ["a:x", "b:y", "a:z"], [r("a"), r("b")]);
  expect(seen.sort()).toEqual(["a:x", "a:z", "b:y"]);
});

test("applyFindings rejects a key no reconciler owns", async () => {
  const cls = await seedClass("cls", 100);
  const ctx = buildContext(authEnv, db, cls, {
    installationId: 200,
    login: "acme",
  });
  const [result] = await applyFindings(ctx, ["ghost:x"], [identity]);
  expect(result).toEqual({
    key: "ghost:x",
    ok: false,
    error: "unknown_reconciler",
  });
});

test("one failing op does not abort the others", async () => {
  const cls = await seedClass("cls", 100);
  const ctx = buildContext(authEnv, db, cls, {
    installationId: 200,
    login: "acme",
  });
  const r: Reconciler = {
    name: "r",
    audit: async () => [],
    apply: async (_c, keys) =>
      keys.map((key) =>
        key.endsWith("bad")
          ? { key, ok: false as const, error: "nope" }
          : { key, ok: true as const },
      ),
  };
  const results = await applyFindings(ctx, ["r:bad", "r:good"], [r]);
  expect(results).toHaveLength(2);
  expect(results.filter((x) => x.ok)).toHaveLength(1);
});

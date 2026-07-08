import { env } from "cloudflare:test";
import { classes, classMembers, getDb, user } from "@labs/db";
import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import type { AuthEnv } from "../src/lib/auth/config";

const state = vi.hoisted(() => ({
  people: {
    teachers: [] as { id: number; login: string; avatarUrl: string | null }[],
    students: [] as { id: number; login: string; avatarUrl: string | null }[],
    pending: [] as { id: number; login: string; avatarUrl: string | null }[],
  },
}));

vi.mock("../src/lib/github/org", () => ({
  orgInfo: vi.fn(async () => ({
    login: "acme",
    name: "Acme",
    avatarUrl: "http://a",
  })),
  orgPeople: vi.fn(async () => state.people),
  basePermission: vi.fn(async () => "none"),
}));

vi.mock("../src/lib/github/repo", () => ({
  orgRepoActivity: vi.fn(async () => new Map()),
}));

const { buildContext } = await import("../src/lib/reconcile/context");
const { roster } = await import("../src/lib/reconcile/roster");

const db = getDb(env.DB);
const now = new Date(0);

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

async function ctx() {
  const [cls] = await db.select().from(classes).where(eq(classes.id, "cls"));
  if (!cls) throw new Error("no class");
  return buildContext(authEnv, db, cls, {
    installationId: 200,
    login: "acme",
  });
}

async function cache(
  rows: { githubId: string; login: string; state: string }[],
) {
  await db.insert(classMembers).values(
    rows.map((r) => ({
      id: `m-${r.githubId}`,
      classId: "cls",
      githubId: r.githubId,
      login: r.login,
      avatarUrl: null,
      state: r.state as "pending" | "active" | "teacher",
      createdAt: now,
      updatedAt: now,
    })),
  );
}

const cachedIds = async () =>
  (await db.select().from(classMembers)).map((m) => m.githubId).sort();

beforeEach(async () => {
  state.people = { teachers: [], students: [], pending: [] };
  await db.delete(classMembers);
  await db.delete(classes);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "Prof", email: "prof@x.ch" });
  await db.insert(classes).values({
    id: "cls",
    orgId: 42,
    installationId: 100,
    connectedByUserId: "u1",
    joinToken: "tok",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
});

test("audit: only the remove finding is destructive", async () => {
  state.people = {
    teachers: [],
    students: [{ id: 2, login: "student", avatarUrl: null }],
    pending: [],
  };
  await cache([{ githubId: "9", login: "gone", state: "active" }]);

  const findings = await roster.audit(await ctx());
  const byKey = new Map(findings.map((f) => [f.key, f]));

  expect(byKey.get("roster:add:githubId=2")?.destructive).toBe(false);
  expect(byKey.get("roster:remove:githubId=9")?.destructive).toBe(true);
});

test("audit: an Owner who is also a member reads as teacher, not active", async () => {
  // liveStates applies owners LAST, so the two GitHub lists can overlap.
  const prof = { id: 1, login: "prof", avatarUrl: null };
  state.people = { teachers: [prof], students: [prof], pending: [] };

  const findings = await roster.audit(await ctx());
  expect(findings.map((f) => f.fix)).toEqual(["Add them to the class roster"]);

  await roster.apply(await ctx(), ["roster:add:githubId=1"]);
  const [row] = await db.select().from(classMembers);
  expect(row?.state).toBe("teacher");
});

test("apply removes ONLY the named subject, never a bulk sweep", async () => {
  // THE safety property. GitHub's roster is empty, so a whole-roster sweep
  // ("delete everyone absent from the live roster") would wipe all three. The
  // teacher checked one box; apply must destroy exactly one row.
  await cache([
    { githubId: "7", login: "a", state: "active" },
    { githubId: "8", login: "b", state: "active" },
    { githubId: "9", login: "c", state: "active" },
  ]);

  const results = await roster.apply(await ctx(), ["roster:remove:githubId=8"]);

  expect(results).toEqual([{ key: "roster:remove:githubId=8", ok: true }]);
  expect(await cachedIds()).toEqual(["7", "9"]);
});

test("apply: removing a row that is already gone is a success (replay)", async () => {
  await cache([{ githubId: "9", login: "gone", state: "active" }]);
  const key = "roster:remove:githubId=9";

  expect(await roster.apply(await ctx(), [key])).toEqual([{ key, ok: true }]);
  expect(await roster.apply(await ctx(), [key])).toEqual([{ key, ok: true }]);
  expect(await cachedIds()).toEqual([]);
});

test("apply writes what GitHub says NOW, not what the proposal described", async () => {
  // The audit saw a pending invite. By the time the teacher clicks Apply the
  // student has accepted. We trust the teacher's choice of SUBJECT and re-read
  // the STATE — so the row lands as "active", not the stale "pending".
  state.people = {
    teachers: [],
    students: [{ id: 5, login: "renamed", avatarUrl: "http://new" }],
    pending: [],
  };
  await roster.apply(await ctx(), ["roster:add:githubId=5"]);

  const [row] = await db.select().from(classMembers);
  expect(row).toMatchObject({
    githubId: "5",
    state: "active",
    login: "renamed",
    avatarUrl: "http://new",
  });
});

test("apply: a subject GitHub no longer knows fails as ONE op, and the rest still run", async () => {
  state.people = {
    teachers: [],
    students: [{ id: 5, login: "here", avatarUrl: null }],
    pending: [],
  };
  await cache([{ githubId: "9", login: "gone", state: "active" }]);

  const results = await roster.apply(await ctx(), [
    "roster:add:githubId=404",
    "roster:add:githubId=5",
    "roster:remove:githubId=9",
  ]);

  expect(results).toEqual([
    {
      key: "roster:add:githubId=404",
      ok: false,
      error: "no longer on the organization's roster",
    },
    { key: "roster:add:githubId=5", ok: true },
    { key: "roster:remove:githubId=9", ok: true },
  ]);
  expect(await cachedIds()).toEqual(["5"]);
});

test("audit writes nothing", async () => {
  state.people = {
    teachers: [],
    students: [{ id: 2, login: "student", avatarUrl: null }],
    pending: [],
  };
  await cache([{ githubId: "9", login: "gone", state: "active" }]);

  await roster.audit(await ctx());
  expect(await cachedIds()).toEqual(["9"]);
});

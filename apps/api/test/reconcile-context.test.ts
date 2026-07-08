import { env } from "cloudflare:test";
import { classes, getDb, groups, labs, user } from "@labs/db";
import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import type { AuthEnv } from "../src/lib/auth/config";

const state = vi.hoisted(() => ({
  orgPeopleThrows: false,
  org: { login: "acme", name: "Acme", avatarUrl: "http://a" },
  people: {
    teachers: [{ id: 111, login: "prof", avatarUrl: "http://p" }],
    students: [{ id: 2, login: "student", avatarUrl: "http://s" }],
    pending: [{ id: 900, login: "invited", avatarUrl: null }],
  },
}));

vi.mock("../src/lib/github/org", () => ({
  orgInfo: vi.fn(async () => state.org),
  orgPeople: vi.fn(async () => {
    if (state.orgPeopleThrows) throw new Error("simulated GitHub failure");
    return state.people;
  }),
  basePermission: vi.fn(async () => "none"),
}));

vi.mock("../src/lib/github/repo", () => ({
  orgRepoActivity: vi.fn(async () => new Map()),
}));

const { buildContext } = await import("../src/lib/reconcile/context");
const { orgPeople } = await import("../src/lib/github/org");

const db = getDb(env.DB);
const now = new Date(0);

// GitHub calls are mocked below, so only DB is ever actually read; the rest
// is dummy to satisfy the AuthEnv shape (same pattern as github-token.test.ts).
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
    orgId: installationId, // any unique int works; not read by buildContext
    installationId,
    connectedByUserId: "u1",
    joinToken: `tok-${id}`,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(classes).where(eq(classes.id, id));
  if (!row) throw new Error("seedClass: insert did not return a row");
  return row;
}

beforeEach(async () => {
  state.orgPeopleThrows = false;
  state.org = { login: "acme", name: "Acme", avatarUrl: "http://a" };
  state.people = {
    teachers: [{ id: 111, login: "prof", avatarUrl: "http://p" }],
    students: [{ id: 2, login: "student", avatarUrl: "http://s" }],
    pending: [{ id: 900, login: "invited", avatarUrl: null }],
  };
  vi.mocked(orgPeople).mockClear();

  await db.delete(groups);
  await db.delete(labs);
  await db.delete(classes);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "Prof", email: "prof@x.ch" });
});

test("each source is fetched at most once per audit", async () => {
  const cls = await seedClass("cls", 100);
  const ctx = buildContext(authEnv, db, cls, {
    installationId: 200,
    login: "acme",
  });

  await Promise.all([ctx.people(), ctx.people(), ctx.people()]);

  // roster and base-permission both want the people. GitHub is hit once.
  expect(orgPeople).toHaveBeenCalledTimes(1);
});

test("a source that is never asked for is never fetched", async () => {
  const cls = await seedClass("cls", 100);
  const ctx = buildContext(authEnv, db, cls, {
    installationId: 200,
    login: "acme",
  });
  await ctx.orgInfo();
  expect(orgPeople).not.toHaveBeenCalled();
});

test("a failing source rejects every caller, and is retried on a fresh context", async () => {
  const cls = await seedClass("cls", 100);
  state.orgPeopleThrows = true;
  const ctx = buildContext(authEnv, db, cls, {
    installationId: 200,
    login: "acme",
  });
  await expect(ctx.people()).rejects.toThrow();
  await expect(ctx.people()).rejects.toThrow();
  expect(orgPeople).toHaveBeenCalledTimes(1); // the rejection is memoized too
});

test("groups: traverses groups -> labs -> classes, returning only this class's groups", async () => {
  const cls = await seedClass("cls", 100);
  const otherCls = await seedClass("other-cls", 101);

  await db.insert(labs).values([
    {
      id: "lab-mine",
      classId: cls.id,
      title: "Lab mine",
      deadline: now,
      createdByUserId: "u1",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "lab-other",
      classId: otherCls.id,
      title: "Lab other",
      deadline: now,
      createdByUserId: "u1",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(groups).values([
    {
      id: "group-mine",
      labId: "lab-mine",
      ghTeamId: 1,
      ghTeamSlug: "mine",
      slug: "mine",
      name: "Mine",
      creatorUserId: "u1",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "group-other",
      labId: "lab-other",
      ghTeamId: 2,
      ghTeamSlug: "other",
      slug: "other",
      name: "Other",
      creatorUserId: "u1",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const ctx = buildContext(authEnv, db, cls, {
    installationId: 200,
    login: "acme",
  });
  const result = await ctx.groups();
  expect(result.map((g) => g.id)).toEqual(["group-mine"]);
});

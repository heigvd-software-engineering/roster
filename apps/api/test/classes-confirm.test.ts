import { env } from "cloudflare:test";
import { account, classes, getDb, user } from "@roster/db";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  defaultRepositoryPermission: "none" as string,
  membersCanCreateRepos: false,
  admins: [{ id: 111 }] as Array<{ id: number }>,
  patchCalls: [] as unknown[],
}));

vi.mock("../src/lib/auth/config", () => ({
  createAuth: () => ({
    api: { getSession: async () => state.session },
  }),
}));

vi.mock("../src/lib/github/app", () => ({
  orgLogin: async () => "acme",
}));

vi.mock("../src/lib/github/org", () => ({
  isOrgAdmin: async (
    _env: unknown,
    _installationId: number,
    _org: string,
    githubUserId: number,
  ) => state.admins.some((a) => a.id === githubUserId),
  enforceOrgPolicy: async (
    _env: unknown,
    _installationId: number,
    org: string,
  ) => {
    state.patchCalls.push({
      org,
      default_repository_permission: "none",
      members_can_create_repositories: false,
    });
  },
  orgPolicy: async () => ({
    basePermission: state.defaultRepositoryPermission,
    membersCanCreateRepos: state.membersCanCreateRepos,
  }),
  orgInfo: async () => {
    throw new Error("unexpected orgInfo call");
  },
  orgPeople: async () => {
    throw new Error("unexpected orgPeople call");
  },
}));

const { classesRoutes } = await import("../src/routes/classes");

const app = new Hono().route("/api", classesRoutes);
const db = getDb(env.DB);

async function seedClass(connectedByUserId = "u1") {
  const now = new Date(0);
  await db.insert(classes).values({
    id: "c1",
    orgId: 42,
    installationId: 100,
    connectedByUserId,
    joinToken: "tok123tok123tok123tok123tok12345",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

beforeEach(async () => {
  state.session = { user: { id: "u1" } };
  state.defaultRepositoryPermission = "none";
  state.membersCanCreateRepos = false;
  state.admins = [{ id: 111 }];
  state.patchCalls = [];
  await db.delete(classes);
  await db.delete(account);
  await db.delete(user);
  await db.insert(user).values([
    { id: "u1", name: "U1", email: "u1@x.ch" },
    { id: "someone-else", name: "SE", email: "se@x.ch" },
  ]);
  // The caller's linked GitHub id (111), an org admin by default.
  await db.insert(account).values({
    id: "a1",
    userId: "u1",
    providerId: "github",
    accountId: "111",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
});

test("locks the org policy (base none + no member repo creation) and returns ok:true", async () => {
  await seedClass();
  const res = await app.request(
    "/api/classes/c1/confirm",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, org: { login: "acme" } });
  expect(state.patchCalls).toEqual([
    {
      org: "acme",
      default_repository_permission: "none",
      members_can_create_repositories: false,
    },
  ]);
});

test("returns ok:false when the re-GET doesn't confirm base none", async () => {
  await seedClass();
  state.defaultRepositoryPermission = "read";
  const res = await app.request(
    "/api/classes/c1/confirm",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: false, org: { login: "acme" } });
});

test("returns ok:false when members can still create repositories", async () => {
  await seedClass();
  state.membersCanCreateRepos = true;
  const res = await app.request(
    "/api/classes/c1/confirm",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: false, org: { login: "acme" } });
});

test("unknown class id returns 404", async () => {
  const res = await app.request(
    "/api/classes/c1/confirm",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(404);
});

test("confirms for a co-owner (admin) even if they didn't connect it", async () => {
  await seedClass("someone-else");
  const res = await app.request(
    "/api/classes/c1/confirm",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, org: { login: "acme" } });
  expect(state.patchCalls).toEqual([
    {
      org: "acme",
      default_repository_permission: "none",
      members_can_create_repositories: false,
    },
  ]);
});

test("returns 404 and makes no org writes for a non-admin", async () => {
  await seedClass();
  state.admins = [{ id: 999 }];
  const res = await app.request(
    "/api/classes/c1/confirm",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
  expect(state.patchCalls).toEqual([]);
});

test("returns 404 when the caller has no linked GitHub account", async () => {
  await seedClass();
  await db.delete(account);
  const res = await app.request(
    "/api/classes/c1/confirm",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
  expect(state.patchCalls).toEqual([]);
});

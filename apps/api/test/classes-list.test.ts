import { env } from "cloudflare:test";
import { account, classes, getDb, user } from "@labs/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  installations: [{ id: 200, account: { id: 42, login: "acme" } }] as Array<{
    id: number;
    account: { id: number; login: string };
  }>,
  org: { login: "acme", name: "Acme", avatarUrl: "http://a" },
  failInstallationIds: [] as number[],
  people: {
    teachers: [{ id: 111, login: "prof", avatarUrl: "http://p" }],
    students: [{ id: 2, login: "student", avatarUrl: "http://s" }],
    pending: [{ id: 900, login: "invited", avatarUrl: null }],
  } as {
    teachers: Array<{ id: number; login: string; avatarUrl: string | null }>;
    students: Array<{ id: number; login: string; avatarUrl: string | null }>;
    pending: Array<{ id: number; login: string; avatarUrl: string | null }>;
  },
}));

vi.mock("../src/lib/auth/config", () => ({
  createAuth: () => ({
    api: { getSession: async () => state.session },
  }),
}));

vi.mock("../src/lib/github/org", () => ({
  isOrgAdmin: async () => true,
  orgInfo: async (_env: unknown, installationId: number) => {
    if (state.failInstallationIds.includes(installationId)) {
      throw new Error("simulated GitHub failure");
    }
    return state.org;
  },
  orgPeople: vi.fn(async () => state.people),
}));

const userInstallationsByOrgIdMock = vi.hoisted(() =>
  vi.fn(async (_token: string) => {
    const byOrgId = new Map<
      number,
      { installationId: number; login: string }
    >();
    for (const inst of state.installations) {
      byOrgId.set(inst.account.id, {
        installationId: inst.id,
        login: inst.account.login,
      });
    }
    return byOrgId;
  }),
);

vi.mock("../src/lib/github/user", () => ({
  userInstallationsByOrgId: userInstallationsByOrgIdMock,
}));

const { classesRoutes } = await import("../src/routes/classes");
const { orgPeople } = await import("../src/lib/github/org");

const app = new Hono().route("/api", classesRoutes);
const db = getDb(env.DB);

const now = new Date(0);

async function seedClass(args?: {
  id?: string;
  orgId?: number;
  installationId?: number;
  connectedByUserId?: string;
  joinToken?: string;
}) {
  await db.insert(classes).values({
    id: args?.id ?? "c1",
    orgId: args?.orgId ?? 42,
    installationId: args?.installationId ?? 100,
    connectedByUserId: args?.connectedByUserId ?? "u1",
    joinToken: args?.joinToken ?? `tok-${args?.id ?? "c1"}`,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

beforeEach(async () => {
  state.session = { user: { id: "u1" } };
  state.installations = [{ id: 200, account: { id: 42, login: "acme" } }];
  state.org = { login: "acme", name: "Acme", avatarUrl: "http://a" };
  state.failInstallationIds = [];
  state.people = {
    teachers: [{ id: 111, login: "prof", avatarUrl: "http://p" }],
    students: [{ id: 2, login: "student", avatarUrl: "http://s" }],
    pending: [{ id: 900, login: "invited", avatarUrl: null }],
  };
  userInstallationsByOrgIdMock.mockClear();

  await db.delete(classes);
  await db.delete(account);
  await db.delete(user);
  // The caller: labs user u1 whose linked GitHub id is 111 (the org owner).
  await db.insert(user).values([
    {
      id: "u1",
      name: "Prof Switch",
      firstName: "Bob",
      lastName: "Prof",
      email: "prof@heig-vd.ch",
    },
    { id: "someone-else", name: "SE", email: "se@x.ch" },
  ]);
  await db.insert(account).values({
    id: "a1",
    userId: "u1",
    providerId: "github",
    accountId: "111",
    accessToken: "tok",
    createdAt: now,
    updatedAt: now,
  });
});

test("lists classes with people + linked users, reconciles stale installationId", async () => {
  await seedClass();
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    classes: Array<
      Record<string, unknown> & {
        users: Array<{ githubId: string; user: Record<string, unknown> }>;
      }
    >;
  };

  expect(body.classes).toHaveLength(1);
  expect(body.classes[0]).toMatchObject({
    id: "c1",
    orgId: 42,
    login: "acme",
    name: "Acme",
    avatarUrl: "http://a",
    joinToken: "tok-c1",
    teachers: state.people.teachers,
    students: state.people.students,
    pending: state.people.pending,
    labs: [],
  });
  // The linked-users query result rides along raw; only the teacher's
  // GitHub account (111) is linked to a labs user here.
  expect(body.classes[0]?.users).toHaveLength(1);
  expect(body.classes[0]?.users[0]).toMatchObject({
    githubId: "111",
    user: {
      id: "u1",
      firstName: "Bob",
      lastName: "Prof",
      name: "Prof Switch",
      email: "prof@heig-vd.ch",
    },
  });

  // Reconciled: stored installationId 100 → live 200.
  const [row] = await db.select().from(classes).where(eq(classes.id, "c1"));
  expect(row?.installationId).toBe(200);
});

test("skips classes whose org is no longer in the user's installations", async () => {
  await seedClass();
  state.installations = [];
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ classes: [] });
});

test("does not touch the row when installationId is unchanged", async () => {
  await seedClass({ installationId: 200 });
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  const [row] = await db.select().from(classes).where(eq(classes.id, "c1"));
  expect(row?.installationId).toBe(200);
  expect(row?.updatedAt).toEqual(now);
});

test("skips a class whose live-enrich call fails, without 500ing the rest", async () => {
  await seedClass({ id: "c1", orgId: 42, installationId: 100 });
  await seedClass({ id: "c2", orgId: 43, installationId: 101 });
  state.installations = [
    { id: 100, account: { id: 42, login: "acme" } },
    { id: 101, account: { id: 43, login: "beta" } },
  ];
  state.failInstallationIds = [100];
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { classes: Array<{ id: string }> };
  expect(body.classes.map((c) => c.id)).toEqual(["c2"]);
});

test("returns a class connected by someone else when the caller is an org owner", async () => {
  await seedClass({ connectedByUserId: "someone-else" });
  // default mocks: callerGithubId 111, orgPeople teachers include 111.
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { classes: Array<{ id: string }> };
  expect(body.classes.map((c) => c.id)).toEqual(["c1"]);
});

test("skips a class when the caller has installation access but is NOT an org owner (F8 guard)", async () => {
  await seedClass();
  vi.mocked(orgPeople).mockResolvedValueOnce({
    teachers: [{ id: 999, login: "someone-else", avatarUrl: null }],
    students: [],
    pending: [],
  });
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ classes: [] });
});

test("returns [] when the caller has no linked GitHub account", async () => {
  await seedClass();
  await db.delete(account);
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ classes: [] });
  expect(userInstallationsByOrgIdMock).not.toHaveBeenCalled();
});

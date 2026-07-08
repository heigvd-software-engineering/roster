import { env } from "cloudflare:test";
import { account, classes, classMembers, getDb, labs, user } from "@labs/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  githubToken: "tok" as string | null,
  installations: [{ id: 200, account: { id: 42, login: "acme" } }] as Array<{
    id: number;
    account: { id: number; login: string };
  }>,
  org: { login: "acme", name: "Acme", avatarUrl: "http://a" },
  failInstallationIds: [] as number[],
  failSyncRoster: false,
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

vi.mock("../src/lib/auth/github-token", () => ({
  githubAccessToken: async () => state.githubToken,
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

// Delegates to the REAL syncRoster (vi.importActual) unless failSyncRoster is
// set: "syncs the enrollment cache..." below asserts syncRoster's actual DB
// effect, so a bare no-op mock would silently break it. Only this one test
// toggles the failure to prove a D1 hiccup here can't hide the class.
const syncRosterMock = vi.hoisted(() =>
  vi.fn(
    async (
      ...args: Parameters<typeof import("../src/lib/enrollment").syncRoster>
    ) => {
      if (state.failSyncRoster) throw new Error("simulated D1 failure");
      const actual = await vi.importActual<
        typeof import("../src/lib/enrollment")
      >("../src/lib/enrollment");
      return actual.syncRoster(...args);
    },
  ),
);
vi.mock("../src/lib/enrollment", () => ({ syncRoster: syncRosterMock }));

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
  login?: string;
  name?: string;
  avatarUrl?: string;
  createdAt?: Date;
}) {
  await db.insert(classes).values({
    id: args?.id ?? "c1",
    orgId: args?.orgId ?? 42,
    installationId: args?.installationId ?? 100,
    connectedByUserId: args?.connectedByUserId ?? "u1",
    joinToken: args?.joinToken ?? `tok-${args?.id ?? "c1"}`,
    status: "active",
    login: args?.login ?? null,
    name: args?.name ?? null,
    avatarUrl: args?.avatarUrl ?? null,
    createdAt: args?.createdAt ?? now,
    updatedAt: now,
  });
}

beforeEach(async () => {
  state.session = { user: { id: "u1" } };
  state.githubToken = "tok";
  state.installations = [{ id: 200, account: { id: 42, login: "acme" } }];
  state.org = { login: "acme", name: "Acme", avatarUrl: "http://a" };
  state.failInstallationIds = [];
  state.failSyncRoster = false;
  state.people = {
    teachers: [{ id: 111, login: "prof", avatarUrl: "http://p" }],
    students: [{ id: 2, login: "student", avatarUrl: "http://s" }],
    pending: [{ id: 900, login: "invited", avatarUrl: null }],
  };
  userInstallationsByOrgIdMock.mockClear();
  syncRosterMock.mockClear();

  await db.delete(labs);
  await db.delete(classMembers);
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
  expect(await res.json()).toEqual({
    classes: [],
    enrolled: [],
    hasOlder: false,
  });
});

test("does not touch the row when installationId and org cache are current", async () => {
  await seedClass({
    installationId: 200,
    login: "acme",
    name: "Acme",
    avatarUrl: "http://a",
  });
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
  expect(await res.json()).toEqual({
    classes: [],
    enrolled: [],
    hasOlder: false,
  });
});

test("returns [] when the caller has no linked GitHub account", async () => {
  await seedClass();
  await db.delete(account);
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    classes: [],
    enrolled: [],
    hasOlder: false,
  });
  expect(userInstallationsByOrgIdMock).not.toHaveBeenCalled();
});

test("returns [] when the GitHub token is dead and unrefreshable", async () => {
  await seedClass();
  state.githubToken = null;
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    classes: [],
    enrolled: [],
    hasOlder: false,
  });
  expect(userInstallationsByOrgIdMock).not.toHaveBeenCalled();
});

test("orders a class's labs by deadline, latest first", async () => {
  await seedClass();
  await db.insert(labs).values([
    {
      id: "lab-early",
      classId: "c1",
      title: "Early deadline",
      deadline: new Date("2099-01-15T23:59:00Z"),
      createdByUserId: "u1",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "lab-late",
      classId: "c1",
      title: "Late deadline",
      deadline: new Date("2099-06-15T23:59:00Z"),
      createdByUserId: "u1",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "lab-mid",
      classId: "c1",
      title: "Mid deadline",
      deadline: new Date("2099-03-15T23:59:00Z"),
      createdByUserId: "u1",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  const res = await app.request("/api/classes", {}, env);
  const body = (await res.json()) as {
    classes: Array<{ labs: Array<{ id: string }> }>;
  };
  expect(body.classes[0]?.labs.map((l) => l.id)).toEqual([
    "lab-late",
    "lab-mid",
    "lab-early",
  ]);
});

test("orders classes by creation date, newest first", async () => {
  await seedClass({ id: "c-old", orgId: 42 });
  await db.insert(classes).values({
    id: "c-new",
    orgId: 43,
    installationId: 101,
    connectedByUserId: "u1",
    joinToken: "tok-c-new",
    status: "active",
    createdAt: new Date(1000),
    updatedAt: new Date(1000),
  });
  state.installations = [
    { id: 100, account: { id: 42, login: "acme" } },
    { id: 101, account: { id: 43, login: "beta" } },
  ];
  const res = await app.request("/api/classes", {}, env);
  const body = (await res.json()) as { classes: Array<{ id: string }> };
  expect(body.classes.map((c) => c.id)).toEqual(["c-new", "c-old"]);
});

// --- class_members enrollment display cache + the student class list ---

test("syncs the enrollment cache from the live roster (promote, add, drop)", async () => {
  await seedClass();
  await db.insert(classMembers).values([
    // Was invited, has since accepted (roster now lists them active).
    {
      id: "m-old",
      classId: "c1",
      githubId: "2",
      state: "pending",
      createdAt: now,
      updatedAt: now,
    },
    // No longer on the roster at all — must be dropped.
    {
      id: "m-gone",
      classId: "c1",
      githubId: "999",
      state: "active",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await app.request("/api/classes", {}, env);
  const rows = await db
    .select()
    .from(classMembers)
    .orderBy(classMembers.githubId);
  // Teachers ride the same cache (state "teacher") and everyone carries the
  // GitHub identity the sync observed (login/avatar for the student card).
  expect(rows).toMatchObject([
    { classId: "c1", githubId: "111", state: "teacher", login: "prof" },
    { classId: "c1", githubId: "2", state: "active", login: "student" },
    { classId: "c1", githubId: "900", state: "pending", login: "invited" },
  ]);
});

test("caches the org identity on the class row for DB-only student reads", async () => {
  await seedClass();
  await app.request("/api/classes", {}, env);
  const [row] = await db.select().from(classes).where(eq(classes.id, "c1"));
  expect(row).toMatchObject({
    login: "acme",
    name: "Acme",
    avatarUrl: "http://a",
  });
});

test("returns the caller's enrolled classes (with labs) from the cache alone", async () => {
  await seedClass(); // teaching c1 (org 42, in installations)
  // c2: a class the caller is enrolled in but does NOT teach — its org is
  // not among the caller's installations, so only the cache can surface it.
  await db.insert(classes).values({
    id: "c2",
    orgId: 43,
    installationId: 300,
    connectedByUserId: "someone-else",
    joinToken: "tok-c2",
    status: "active",
    login: "beta",
    name: "Beta",
    avatarUrl: "http://b",
    createdAt: new Date(500),
    updatedAt: new Date(500),
  });
  await db.insert(labs).values({
    id: "l1",
    classId: "c2",
    title: "Lab 1",
    deadline: new Date("2099-01-01T23:59:00Z"),
    createdByUserId: "someone-else",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(classMembers).values({
    id: "m1",
    classId: "c2",
    githubId: "111",
    state: "active",
    createdAt: now,
    updatedAt: now,
  });

  const res = await app.request("/api/classes", {}, env);
  const body = (await res.json()) as {
    classes: Array<{ id: string }>;
    enrolled: Array<Record<string, unknown>>;
  };
  expect(body.classes.map((c) => c.id)).toEqual(["c1"]);
  expect(body.enrolled).toMatchObject([
    {
      id: "c2",
      login: "beta",
      name: "Beta",
      avatarUrl: "http://b",
      state: "active",
      labs: [{ id: "l1", title: "Lab 1" }],
    },
  ]);
  // The join token must never leak to enrollees.
  expect(body.enrolled[0]).not.toHaveProperty("joinToken");
});

test("a class the caller teaches never doubles as an enrolled class", async () => {
  await seedClass();
  await db.insert(classMembers).values({
    id: "m1",
    classId: "c1",
    githubId: "111",
    state: "active",
    createdAt: now,
    updatedAt: now,
  });
  const res = await app.request("/api/classes", {}, env);
  const body = (await res.json()) as {
    classes: Array<{ id: string }>;
    enrolled: unknown[];
  };
  expect(body.classes.map((c) => c.id)).toEqual(["c1"]);
  expect(body.enrolled).toEqual([]);
});

test("?from windows the list — no GitHub work for out-of-window classes", async () => {
  state.installations = [
    { id: 200, account: { id: 42, login: "acme" } },
    { id: 201, account: { id: 43, login: "oldies" } },
  ];
  await seedClass({
    id: "c-new",
    orgId: 42,
    createdAt: new Date("2026-03-01"),
  });
  await seedClass({
    id: "c-old",
    orgId: 43,
    installationId: 201,
    createdAt: new Date("2025-03-01"),
  });
  vi.mocked(orgPeople).mockClear();

  const res = await app.request(
    "/api/classes?from=2026-02-01T00:00:00Z",
    {},
    env,
  );
  const body = (await res.json()) as {
    classes: Array<{ id: string }>;
    hasOlder: boolean;
  };
  expect(body.classes.map((c) => c.id)).toEqual(["c-new"]);
  expect(body.hasOlder).toBe(true);
  // The saving: the out-of-window class never triggered live GitHub work.
  expect(vi.mocked(orgPeople)).toHaveBeenCalledTimes(1);

  // Widened window: both classes, nothing older left.
  const all = await app.request(
    "/api/classes?from=2025-02-01T00:00:00Z",
    {},
    env,
  );
  const allBody = (await all.json()) as {
    classes: Array<{ id: string }>;
    hasOlder: boolean;
  };
  expect(allBody.classes.map((c) => c.id)).toEqual(["c-new", "c-old"]);
  expect(allBody.hasOlder).toBe(false);
});

test("hasOlder also sees older ENROLLED classes; bad from is a 400", async () => {
  await seedClass({ id: "c-new", createdAt: new Date("2026-03-01") });
  // An older class the caller is only enrolled in (org not installed).
  await seedClass({
    id: "c-enr",
    orgId: 99,
    createdAt: new Date("2024-10-01"),
  });
  await db.insert(classMembers).values({
    id: "m-enr",
    classId: "c-enr",
    githubId: "111",
    state: "active",
    createdAt: now,
    updatedAt: now,
  });

  const res = await app.request(
    "/api/classes?from=2026-02-01T00:00:00Z",
    {},
    env,
  );
  const body = (await res.json()) as { enrolled: unknown[]; hasOlder: boolean };
  expect(body.enrolled).toEqual([]);
  expect(body.hasOlder).toBe(true);

  expect(
    (await app.request("/api/classes?from=not-a-date", {}, env)).status,
  ).toBe(400);
});

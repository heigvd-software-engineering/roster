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
  // The caller's role per org login for the BULK memberships call. null =
  // derive "admin"/"active" for every installation (the common case).
  orgMemberships: null as Record<
    string,
    { role: string; state: string }
  > | null,
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
  orgInfo: async () => state.org,
  orgPeople: vi.fn(async () => state.people),
}));

const userInstallationsByOrgIdMock = vi.hoisted(() =>
  vi.fn(async (_token: string) => {
    const byOrgId = new Map<
      number,
      { installationId: number; login: string; avatarUrl: string }
    >();
    for (const inst of state.installations) {
      byOrgId.set(inst.account.id, {
        installationId: inst.id,
        login: inst.account.login,
        // GET /user/installations really does carry this; the hub renders it.
        avatarUrl: "http://a",
      });
    }
    return byOrgId;
  }),
);

// The hub's ONLY other GitHub call: the caller's role in every org at once.
// Keyed by LOWERCASED login, like the real helper.
const userOrgMembershipsMock = vi.hoisted(() =>
  vi.fn(async (_token: string) => {
    const byLogin = new Map<string, { role: string; state: string }>();
    if (state.orgMemberships) {
      for (const [login, m] of Object.entries(state.orgMemberships)) {
        byLogin.set(login.toLowerCase(), m);
      }
    } else {
      for (const inst of state.installations) {
        byLogin.set(inst.account.login.toLowerCase(), {
          role: "admin",
          state: "active",
        });
      }
    }
    return byLogin;
  }),
);

vi.mock("../src/lib/github/user", async (importOriginal) => {
  // Spread the real module so `GithubUnavailableError` stays the REAL class —
  // the on-error translator recognizes throws by instanceof.
  const actual =
    await importOriginal<typeof import("../src/lib/github/user")>();
  return {
    ...actual,
    userInstallationsByOrgId: userInstallationsByOrgIdMock,
    userOrgMemberships: userOrgMembershipsMock,
  };
});

const { classesRoutes } = await import("../src/routes/classes");
const { apiOnError } = await import("../src/on-error");
const { GithubUnavailableError } = await import("../src/lib/github/user");

const app = new Hono<import("../src/lib/auth/config").Env>()
  .route("/api", classesRoutes)
  .onError(apiOnError);
const db = getDb(env.DB);

const now = new Date(0);

/** A fake SWITCH id_token: only the payload matters (decodeJwtPayload). */
const idTokenWith = (emails: string[]) =>
  `h.${btoa(JSON.stringify({ swissEduIDLinkedAffiliationMail: emails }))}.s`;

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

/** The hub's people chips read the `class_members` DISPLAY cache. Reconcile is
 *  what keeps it true; the hub itself never writes it. */
async function seedMembers(
  classId = "c1",
  people = state.people,
): Promise<void> {
  const rows = [
    ...people.teachers.map((p) => ({ p, state: "teacher" as const })),
    ...people.students.map((p) => ({ p, state: "active" as const })),
    ...people.pending.map((p) => ({ p, state: "pending" as const })),
  ];
  if (rows.length === 0) return;
  await db.insert(classMembers).values(
    rows.map(({ p, state: memberState }) => ({
      id: `cm-${classId}-${p.id}`,
      classId,
      githubId: String(p.id),
      login: p.login,
      avatarUrl: p.avatarUrl,
      state: memberState,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

beforeEach(async () => {
  state.session = { user: { id: "u1" } };
  state.githubToken = "tok";
  state.installations = [{ id: 200, account: { id: 42, login: "acme" } }];
  state.org = { login: "acme", name: "Acme", avatarUrl: "http://a" };
  state.orgMemberships = null;
  state.people = {
    teachers: [{ id: 111, login: "prof", avatarUrl: "http://p" }],
    students: [{ id: 2, login: "student", avatarUrl: "http://s" }],
    pending: [{ id: 900, login: "invited", avatarUrl: null }],
  };
  userInstallationsByOrgIdMock.mockClear();
  userOrgMembershipsMock.mockClear();

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

test("lists classes with people + linked users, from live installation data", async () => {
  await seedClass({ name: "Acme" });
  await seedMembers();
  await db.insert(account).values({
    id: "a-switch",
    userId: "u1",
    providerId: "switch",
    accountId: "edu-1",
    idToken: idTokenWith(["b.prof@heig-vd.ch", "b.prof@unil.ch"]),
    createdAt: now,
    updatedAt: now,
  });
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
    // login + avatarUrl ride on the /user/installations payload, already fetched.
    login: "acme",
    avatarUrl: "http://a",
    // `name` is NOT on that payload — it comes from the cached row.
    name: "Acme",
    joinToken: "tok-c1",
    teachers: state.people.teachers,
    students: state.people.students,
    pending: state.people.pending,
    labs: [],
  });
  // Only the teacher's GitHub account (111) is linked to a labs user here.
  expect(body.classes[0]?.users).toHaveLength(1);
  // EXACT shape: the private email (and everything else) must not ride along.
  expect(body.classes[0]?.users[0]).toEqual({
    githubId: "111",
    user: {
      firstName: "Bob",
      lastName: "Prof",
      name: "Prof Switch",
      affiliations: ["b.prof@heig-vd.ch", "b.prof@unil.ch"],
    },
  });

  // NOT reconciled: the stored pointer stays 100 even though the live id is 200.
  // A GET returns what it sees; repairing it is the `installation` reconciler's
  // job, and the teacher's decision.
  const [row] = await db.select().from(classes).where(eq(classes.id, "c1"));
  expect(row?.installationId).toBe(100);
});

test("linked users without a SWITCH id_token get empty affiliations", async () => {
  await seedClass({ name: "Acme" });
  await seedMembers();
  const res = await app.request("/api/classes", {}, env);
  const body = (await res.json()) as {
    classes: Array<{ users: Array<{ user: Record<string, unknown> }> }>;
  };
  expect(body.classes[0]?.users[0]?.user).toEqual({
    firstName: "Bob",
    lastName: "Prof",
    name: "Prof Switch",
    affiliations: [],
  });
});

test("a GitHub outage on the bulk calls is a 503, not a 500 or an empty hub", async () => {
  await seedClass();
  userOrgMembershipsMock.mockRejectedValueOnce(
    new GithubUnavailableError("simulated outage"),
  );
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "github_unavailable" });
});

test("skips classes whose org is no longer in the user's installations", async () => {
  // Even a live Owner: without an installation the App cannot reach the org,
  // so the class is skipped (spec: absent from the installations map wins).
  await seedClass();
  state.installations = [];
  state.orgMemberships = { acme: { role: "admin", state: "active" } };
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

test("skips a class whose org is missing from the memberships answer", async () => {
  // An org can rate-limit or vanish between the two bulk calls — a class we
  // cannot decide about is skipped, never shown (and never a 500).
  await seedClass({ id: "c1", orgId: 42, installationId: 100 });
  await seedClass({ id: "c2", orgId: 43, installationId: 101 });
  state.installations = [
    { id: 100, account: { id: 42, login: "acme" } },
    { id: 101, account: { id: 43, login: "beta" } },
  ];
  state.orgMemberships = { beta: { role: "admin", state: "active" } };
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
  // /user/installations lists installations the caller can ACCESS, not ones they
  // own — a student with push on a work repo appears there. Only the live Owner
  // check grants the class, and a cached `teacher` row never could.
  await seedClass();
  await seedMembers();
  state.orgMemberships = { acme: { role: "member", state: "active" } };
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    classes: [],
    enrolled: [],
    hasOlder: false,
  });
});

test("skips a class when the caller's Owner invite is still pending", async () => {
  // `state: "pending"` is not an Owner yet — an invited Owner who hasn't
  // accepted must not see the class (fan-out spec).
  await seedClass();
  state.orgMemberships = { acme: { role: "admin", state: "pending" } };
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    classes: [],
    enrolled: [],
    hasOlder: false,
  });
});

test("the Owner check matches org logins case-insensitively", async () => {
  // GitHub logins are case-insensitive; the two bulk payloads may disagree on
  // casing and the intersection must still hold.
  await seedClass();
  state.installations = [{ id: 200, account: { id: 42, login: "AcMe" } }];
  state.orgMemberships = { ACME: { role: "admin", state: "active" } };
  const res = await app.request("/api/classes", {}, env);
  const body = (await res.json()) as { classes: Array<{ id: string }> };
  expect(body.classes.map((c) => c.id)).toEqual(["c1"]);
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

test("the hub never writes the classes row", async () => {
  // A GET returns what it sees. The installation pointer belongs to setup.ts and
  // the `installation` reconciler; the org identity cache to the `identity`
  // reconciler. Both are behind the teacher's explicit Reconcile action.
  await seedClass({ installationId: 999, login: "stale", name: "Stale" });

  await app.request("/api/classes", {}, env);

  const [row] = await db.select().from(classes).where(eq(classes.id, "c1"));
  expect(row).toMatchObject({
    installationId: 999,
    login: "stale",
    name: "Stale",
  });
});

test("a stale class still renders correctly", async () => {
  // The card is right even though the row is wrong: login/avatarUrl come from
  // /user/installations. Only `name` waits for a reconcile.
  await seedClass({ installationId: 999, login: "stale", name: "Stale" });

  const res = await app.request("/api/classes", {}, env);

  const body = (await res.json()) as {
    classes: Array<{ login: string; name: string | null; avatarUrl: string }>;
  };
  expect(body.classes[0]).toMatchObject({
    login: "acme",
    avatarUrl: "http://a",
    name: "Stale",
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
  userInstallationsByOrgIdMock.mockClear();
  userOrgMembershipsMock.mockClear();

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
  // The saving: GitHub work is TWO bulk calls regardless of how many classes
  // are in (or out of) the window — never per-class.
  expect(userInstallationsByOrgIdMock).toHaveBeenCalledTimes(1);
  expect(userOrgMembershipsMock).toHaveBeenCalledTimes(1);

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

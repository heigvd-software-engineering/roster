import { env } from "cloudflare:test";
import {
  account,
  classes,
  getDb,
  groups,
  labs,
  studentLabRepos,
  user,
} from "@labs/db";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  membership: { state: "active", role: "member" } as {
    state: "active" | "pending";
    role: string;
  } | null,
  // slug → roster; a missing slug = the team is gone on GitHub.
  rosters: {} as Record<
    string,
    Array<{ id: number; login: string; avatarUrl: string | null }>
  >,
  // repo fullName → org-listing activity (pushed_at / created_at).
  activity: {} as Record<
    string,
    { pushedAt: string | null; createdAt: string | null }
  >,
}));

vi.mock("../src/lib/auth/config", () => ({
  createAuth: () => ({
    api: { getSession: async () => state.session },
  }),
}));

vi.mock("../src/lib/auth/github-token", () => ({
  githubAccessToken: async () => "tok",
}));

vi.mock("../src/lib/github/user", () => ({
  fetchGithubProfile: async () => ({
    login: "alice",
    id: 7,
    name: "Alice",
    avatarUrl: "http://a",
  }),
}));

vi.mock("../src/lib/github/app", () => ({
  orgLogin: async () => "acme",
}));

vi.mock("../src/lib/github/org", () => ({
  orgMembership: async () => state.membership,
}));

const repoSeq = vi.hoisted(() => ({ next: 9000 }));
vi.mock("../src/lib/github/repo", () => ({
  createOrgRepo: async (
    _env: unknown,
    _inst: number,
    org: string,
    name: string,
  ) => ({ id: repoSeq.next++, fullName: `${org}/${name}` }),
  generateFromTemplate: async (
    _env: unknown,
    _inst: number,
    _template: string,
    org: string,
    name: string,
  ) => ({ id: repoSeq.next++, fullName: `${org}/${name}` }),
  grantTeamRepo: async () => {},
  orgRepoActivity: async () => new Map(Object.entries(state.activity)),
}));

vi.mock("../src/lib/github/team", () => ({
  teamMembers: async (
    _env: unknown,
    _inst: number,
    _org: string,
    slug: string,
  ) => state.rosters[slug] ?? null,
  createTeam: async (
    _env: unknown,
    _inst: number,
    _org: string,
    name: string,
  ) => ({
    id: Math.floor(Math.random() * 1e6),
    slug: name.toLowerCase(),
    name,
  }),
  addTeamMember: async (
    _env: unknown,
    _inst: number,
    _org: string,
    slug: string,
    username: string,
  ) => {
    state.rosters[slug] = [
      ...(state.rosters[slug] ?? []),
      username === "alice"
        ? alice
        : { id: 0, login: username, avatarUrl: null },
    ];
  },
}));

const { labGroupsRoutes } = await import("../src/routes/lab-groups");

const app = new Hono().route("/api", labGroupsRoutes);
const db = getDb(env.DB);
const now = new Date(0);

const alice = { id: 7, login: "alice", avatarUrl: "http://a" };
const bob = { id: 8, login: "bob", avatarUrl: null };
const carol = { id: 9, login: "carol", avatarUrl: null };

async function seedLab(args?: {
  id?: string;
  groupMode?: "individual" | "group";
  minMembers?: number | null;
  maxMembers?: number | null;
}) {
  await db.insert(labs).values({
    id: args?.id ?? "l1",
    classId: "c1",
    title: "Lab",
    deadline: new Date("2099-01-01"),
    groupMode: args?.groupMode ?? "group",
    minMembers: args?.minMembers ?? 1,
    maxMembers: args?.maxMembers ?? 3,
    createdByUserId: "u1",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedGroup(id: string) {
  await db.insert(groups).values({
    id,
    classId: "c1",
    ghTeamId: Math.floor(Math.random() * 1e6),
    ghTeamSlug: `${id}-slug`,
    name: `Group ${id}`,
    creatorUserId: "u1",
    createdAt: now,
    updatedAt: now,
  });
}

function attach(labId: string, groupId: string) {
  return app.request(
    `/api/classes/c1/labs/${labId}/groups/${groupId}`,
    { method: "PUT" },
    env,
  );
}

beforeEach(async () => {
  state.session = { user: { id: "u1" } };
  state.membership = { state: "active", role: "member" };
  state.rosters = {};
  state.activity = {};

  await db.delete(studentLabRepos);
  await db.delete(groups);
  await db.delete(labs);
  await db.delete(classes);
  await db.delete(account);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "U1", email: "u1@x.ch" });
  await db.insert(account).values({
    id: "a1",
    userId: "u1",
    providerId: "github",
    accountId: "7",
    accessToken: "tok",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(classes).values({
    id: "c1",
    orgId: 42,
    installationId: 100,
    connectedByUserId: "u1",
    joinToken: "tok-c1",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
});

test("a member attaches their group; the pairing is recorded once", async () => {
  await seedLab();
  await seedGroup("g1");
  state.rosters["g1-slug"] = [alice, bob];

  const res = await attach("l1", "g1");
  expect(res.status).toBe(200);
  expect(await db.select().from(studentLabRepos)).toMatchObject([
    { labId: "l1", groupId: "g1" },
  ]);

  // Idempotent replay.
  expect((await attach("l1", "g1")).status).toBe(200);
  expect(await db.select().from(studentLabRepos)).toHaveLength(1);
});

test("a student cannot attach a group they're not in", async () => {
  await seedLab();
  await seedGroup("g1");
  state.rosters["g1-slug"] = [bob];

  const res = await attach("l1", "g1");
  expect(res.status).toBe(404);
  expect(await db.select().from(studentLabRepos)).toHaveLength(0);
});

test("a teacher attaches any group", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab();
  await seedGroup("g1");
  state.rosters["g1-slug"] = [bob];

  expect((await attach("l1", "g1")).status).toBe(200);
});

test("attach enforces MAX only — under-min groups form in place", async () => {
  await seedLab({ minMembers: 2, maxMembers: 3 });
  await seedGroup("g1");

  // Below min: allowed — classmates join through the lab page; min bites
  // at F8's repo creation.
  state.rosters["g1-slug"] = [alice];
  expect((await attach("l1", "g1")).status).toBe(200);

  // Over max: refused.
  await seedGroup("g2");
  state.rosters["g2-slug"] = [
    carol,
    bob,
    alice,
    { id: 10, login: "dan", avatarUrl: null },
  ];
  const res = await attach("l1", "g2");
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "group_size" });
});

test("an individual lab takes exactly a group of one", async () => {
  await seedLab({
    id: "l2",
    groupMode: "individual",
    minMembers: null,
    maxMembers: null,
  });
  await seedGroup("g1");
  state.rosters["g1-slug"] = [alice, bob];

  const res = await attach("l2", "g1");
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "group_size" });

  state.rosters["g1-slug"] = [alice];
  expect((await attach("l2", "g1")).status).toBe(200);
});

test("a student never participates twice: overlapping group is refused", async () => {
  await seedLab();
  await seedGroup("g1");
  await seedGroup("g2");
  state.rosters["g1-slug"] = [alice, bob];
  state.rosters["g2-slug"] = [alice, carol]; // alice already in via g1

  expect((await attach("l1", "g1")).status).toBe(200);
  const res = await attach("l1", "g2");
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "member_already_participating" });

  // A DISJOINT group attaches fine (as the teacher — alice isn't in g3).
  state.membership = { state: "active", role: "admin" };
  await seedGroup("g3");
  state.rosters["g3-slug"] = [carol];
  expect((await attach("l1", "g3")).status).toBe(200);
});

test("lists ALL class groups with rosters + which participate here", async () => {
  await seedLab();
  await seedGroup("g1");
  await seedGroup("g2"); // exists in the class, NOT attached to l1
  state.rosters["g1-slug"] = [alice, bob];
  state.rosters["g2-slug"] = [carol];
  await attach("l1", "g1");

  const res = await app.request("/api/classes/c1/labs/l1/groups", {}, env);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    groups: Array<{ id: string; members: unknown[] }>;
    users: Array<{ githubId: string }>;
    attached: Array<{ groupId: string; repoFullName: string | null }>;
  };
  expect(body.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
  expect(body.groups[0]?.members).toEqual([alice, bob]);
  // Repo-less pairings carry null activity (no org listing is even made).
  expect(body.attached).toEqual([
    { groupId: "g1", repoFullName: null, pushedAt: null, repoCreatedAt: null },
  ]);
  // Linked SWITCH users ride along (alice's github id 7 → labs user u1).
  expect(body.users).toMatchObject([{ githubId: "7", user: { id: "u1" } }]);
});

test("a team deleted on GitHub reconciles: row + attachment dropped", async () => {
  await seedLab();
  await seedGroup("g1");
  state.rosters["g1-slug"] = [alice];
  await attach("l1", "g1");
  delete state.rosters["g1-slug"]; // team gone on GitHub

  const res = await app.request("/api/classes/c1/labs/l1/groups", {}, env);
  const body = (await res.json()) as {
    groups: unknown[];
    attached: unknown[];
  };
  expect(body.groups).toEqual([]);
  expect(body.attached).toEqual([]);
  expect(await db.select().from(groups)).toHaveLength(0);
  expect(await db.select().from(studentLabRepos)).toHaveLength(0);
});

test("detach: a member detaches their group; outsiders get 404", async () => {
  await seedLab();
  await seedGroup("g1");
  state.rosters["g1-slug"] = [alice];
  await attach("l1", "g1");

  // bob-only group now (alice left off-scenario): outsider student → 404.
  state.rosters["g1-slug"] = [bob];
  const denied = await app.request(
    "/api/classes/c1/labs/l1/groups/g1",
    { method: "DELETE" },
    env,
  );
  expect(denied.status).toBe(404);
  expect(await db.select().from(studentLabRepos)).toHaveLength(1);

  // Member again → detaches.
  state.rosters["g1-slug"] = [alice];
  const ok = await app.request(
    "/api/classes/c1/labs/l1/groups/g1",
    { method: "DELETE" },
    env,
  );
  expect(ok.status).toBe(200);
  expect(await db.select().from(studentLabRepos)).toHaveLength(0);
});

test("individual accept: one click creates the solo group and attaches it", async () => {
  await seedLab({
    id: "l2",
    groupMode: "individual",
    minMembers: null,
    maxMembers: null,
  });

  const res = await app.request(
    "/api/classes/c1/labs/l2/accept",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(200);

  const groupRows = await db.select().from(groups);
  expect(groupRows).toMatchObject([{ classId: "c1", name: "alice" }]);
  expect(await db.select().from(studentLabRepos)).toMatchObject([
    { labId: "l2", groupId: groupRows[0]?.id },
  ]);
  // The solo team got its one member.
  expect(state.rosters["alice"]).toMatchObject([{ login: "alice" }]);
});

test("individual accept: a second lab REUSES the solo group", async () => {
  await seedLab({
    id: "l2",
    groupMode: "individual",
    minMembers: null,
    maxMembers: null,
  });
  await seedLab({
    id: "l3",
    groupMode: "individual",
    minMembers: null,
    maxMembers: null,
  });

  await app.request("/api/classes/c1/labs/l2/accept", { method: "POST" }, env);
  const res = await app.request(
    "/api/classes/c1/labs/l3/accept",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(200);
  expect(await db.select().from(groups)).toHaveLength(1);
  expect(await db.select().from(studentLabRepos)).toHaveLength(2);
});

test("individual accept refuses group labs", async () => {
  await seedLab(); // group mode
  const res = await app.request(
    "/api/classes/c1/labs/l1/accept",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "group_lab" });
});

test("batch repos: creates the complete groups, reports the skipped", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab({ minMembers: 2, maxMembers: 3 });
  await seedGroup("g1"); // complete → repo created
  await seedGroup("g2"); // under min → skipped, forms in place
  state.rosters["g1-slug"] = [alice, bob];
  state.rosters["g2-slug"] = [carol];
  await attach("l1", "g1");
  await attach("l1", "g2");

  const res = await app.request(
    "/api/classes/c1/labs/l1/repos",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    created: 1,
    skipped: [{ groupId: "g2", reason: "group_incomplete" }],
  });
  const rows = await db.select().from(studentLabRepos);
  expect(rows.find((r) => r.groupId === "g1")?.ghRepoFullName).toBe(
    "acme/lab-g1-slug",
  );
  expect(rows.find((r) => r.groupId === "g2")?.ghRepoFullName).toBeNull();

  // Idempotent replay: nothing left to create (g2 still under min).
  const again = await app.request(
    "/api/classes/c1/labs/l1/repos",
    { method: "POST" },
    env,
  );
  expect(await again.json()).toEqual({
    created: 0,
    skipped: [{ groupId: "g2", reason: "group_incomplete" }],
  });
});

test("batch repos is the teacher's verb — members get 404", async () => {
  await seedLab();
  await seedGroup("g1");
  state.rosters["g1-slug"] = [alice];
  await attach("l1", "g1");

  const res = await app.request(
    "/api/classes/c1/labs/l1/repos",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(404);
});

test("the groups list carries work-repo activity from the org listing", async () => {
  await seedLab();
  await seedGroup("g1");
  state.rosters["g1-slug"] = [alice];
  await attach("l1", "g1");
  await app.request(
    "/api/classes/c1/labs/l1/groups/g1/repo",
    { method: "POST" },
    env,
  );
  state.activity["acme/lab-g1-slug"] = {
    pushedAt: "2099-02-01T00:00:00Z",
    createdAt: "2099-01-15T00:00:00Z",
  };

  const res = await app.request(
    "/api/classes/c1/labs/l1/groups",
    { method: "GET" },
    env,
  );
  const body = (await res.json()) as { attached: unknown[] };
  expect(body.attached).toEqual([
    {
      groupId: "g1",
      repoFullName: "acme/lab-g1-slug",
      pushedAt: "2099-02-01T00:00:00Z",
      repoCreatedAt: "2099-01-15T00:00:00Z",
    },
  ]);
});

test("a lab from another class is unreachable", async () => {
  await db.insert(classes).values({
    id: "c2",
    orgId: 43,
    installationId: 200,
    connectedByUserId: "u1",
    joinToken: "tok-c2",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(labs).values({
    id: "l9",
    classId: "c2",
    title: "Other",
    deadline: new Date("2099-01-01"),
    createdByUserId: "u1",
    createdAt: now,
    updatedAt: now,
  });
  await seedGroup("g1");
  state.rosters["g1-slug"] = [alice];

  expect((await attach("l9", "g1")).status).toBe(404);
});

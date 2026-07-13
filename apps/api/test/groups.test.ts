import { env } from "cloudflare:test";
import {
  account,
  classes,
  getDb,
  groupMembers,
  groups,
  labs,
  user,
} from "@labs/db";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  githubToken: "tok" as string | null,
  profile: { login: "alice", id: 7, name: "Alice", avatarUrl: "http://p" },
  membership: { state: "active", role: "member" } as {
    state: "active" | "pending";
    role: string;
  } | null,
  // slug → roster; a missing slug means the team is GONE on GitHub (404).
  rosters: {} as Record<
    string,
    Array<{ id: number; login: string; avatarUrl: string | null }>
  >,
  calls: [] as Array<{ op: string; args: unknown[] }>,
}));

vi.mock("../src/lib/auth/config", () => ({
  createAuth: () => ({ api: { getSession: async () => state.session } }),
}));
vi.mock("../src/lib/auth/github-token", () => ({
  githubAccessToken: async () => state.githubToken,
}));
vi.mock("../src/lib/github/user", () => ({
  fetchGithubProfile: async () => state.profile,
}));
vi.mock("../src/lib/github/app", () => ({ orgLogin: async () => "acme" }));
vi.mock("../src/lib/github/org", () => ({
  orgMembership: async () => state.membership,
}));

vi.mock("../src/lib/github/team", () => ({
  teamMembers: async (
    _env: unknown,
    _inst: number,
    _org: string,
    slug: string,
  ) => state.rosters[slug] ?? null,
  addTeamMember: async (
    _env: unknown,
    _inst: number,
    _org: string,
    slug: string,
    username: string,
  ) => {
    state.calls.push({ op: "addTeamMember", args: [slug, username] });
  },
  removeTeamMember: async (
    _env: unknown,
    _inst: number,
    _org: string,
    slug: string,
    username: string,
  ) => {
    state.calls.push({ op: "removeTeamMember", args: [slug, username] });
  },
  deleteTeam: async (
    _env: unknown,
    _inst: number,
    _org: string,
    slug: string,
  ) => {
    state.calls.push({ op: "deleteTeam", args: [slug] });
    if (!state.rosters[slug]) {
      throw Object.assign(new Error("gone"), { status: 404 });
    }
  },
}));

const { groupsRoutes } = await import("../src/routes/groups");

const app = new Hono().route("/api", groupsRoutes);
const db = getDb(env.DB);
const now = new Date(0);
const alice = { id: 7, login: "alice", avatarUrl: "http://p" };
const bob = { id: 8, login: "bob", avatarUrl: null };

async function seedLab(id: string) {
  await db.insert(labs).values({
    id,
    classId: "c1",
    title: `Lab ${id}`,
    deadline: new Date("2099-01-01"),
    createdByUserId: "u1",
    createdAt: now,
    updatedAt: now,
  });
}

/** The row, the GitHub team roster, and the `group_members` mirror. */
async function seedGroup(args: {
  id: string;
  labId: string;
  repo?: boolean;
  members?: { id: number; login: string; avatarUrl: string | null }[];
}) {
  await db.insert(groups).values({
    id: args.id,
    labId: args.labId,
    ghTeamId: Math.floor(Math.random() * 1e6),
    ghTeamSlug: `${args.id}-slug`,
    slug: `${args.labId}-${args.id}`,
    name: `Group ${args.id}`,
    ghRepoId: args.repo ? Math.floor(Math.random() * 1e6) : null,
    ghRepoFullName: args.repo ? `acme/${args.id}` : null,
    creatorUserId: "u1",
    createdAt: now,
    updatedAt: now,
  });
  const people = args.members ?? [];
  state.rosters[`${args.id}-slug`] = people;
  if (people.length > 0) {
    await db.insert(groupMembers).values(
      people.map((p) => ({
        id: `${args.id}-${p.id}`,
        groupId: args.id,
        githubId: String(p.id),
        login: p.login,
        avatarUrl: p.avatarUrl,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }
}

beforeEach(async () => {
  state.session = { user: { id: "u1" } };
  state.githubToken = "tok";
  state.profile = {
    login: "alice",
    id: 7,
    name: "Alice",
    avatarUrl: "http://p",
  };
  state.membership = { state: "active", role: "member" };
  state.rosters = {};
  state.calls = [];

  await db.delete(groupMembers);
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

function join(groupId = "g1", classId = "c1") {
  return app.request(
    `/api/classes/${classId}/groups/${groupId}/membership`,
    { method: "PUT" },
    env,
  );
}

// --- access ---

test("requires auth", async () => {
  state.session = null;
  expect((await join()).status).toBe(401);
});

test("non-members get 404 (class existence never confirmed)", async () => {
  state.membership = null;
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1" });
  expect((await join()).status).toBe(404);
});

// --- self membership ---

test("join adds the CALLER to the team", async () => {
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1" });
  state.rosters["g1-slug"] = [];
  const res = await join();
  expect(res.status).toBe(200);
  expect(state.calls).toEqual([
    { op: "addTeamMember", args: ["g1-slug", "alice"] },
  ]);
});

test("leave removes the CALLER from the team", async () => {
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1" });
  const res = await app.request(
    "/api/classes/c1/groups/g1/membership",
    { method: "DELETE" },
    env,
  );
  expect(res.status).toBe(200);
  expect(state.calls).toEqual([
    { op: "removeTeamMember", args: ["g1-slug", "alice"] },
  ]);
});

// --- the repo lock: membership freezes once the work repo exists ---

test("join is refused once the work repo exists (locked group)", async () => {
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1", repo: true, members: [bob] });

  const res = await join();
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "has_repo" });
  expect(state.calls).toEqual([]);
});

test("leave is refused once the work repo exists (locked group)", async () => {
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1", repo: true, members: [alice] });

  const res = await app.request(
    "/api/classes/c1/groups/g1/membership",
    { method: "DELETE" },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "has_repo" });
  expect(state.calls).toEqual([]);
});

test("a teacher still ADDS members to a locked group (escape hatch)", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1", repo: true, members: [bob] });

  const res = await app.request(
    "/api/classes/c1/groups/g1/members/carol",
    { method: "PUT" },
    env,
  );
  expect(res.status).toBe(200);
  expect(state.calls).toEqual([
    { op: "addTeamMember", args: ["g1-slug", "carol"] },
  ]);
});

test("a teacher still REMOVES members from a locked group (escape hatch)", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1", repo: true, members: [alice, bob] });

  const res = await app.request(
    "/api/classes/c1/groups/g1/members/bob",
    { method: "DELETE" },
    env,
  );
  expect(res.status).toBe(200);
  expect(state.calls).toEqual([
    { op: "removeTeamMember", args: ["g1-slug", "bob"] },
  ]);
});

// --- one-group-per-student-per-LAB (within one lab) ---

test("join is refused when it would double-book the SAME lab", async () => {
  await seedLab("l1");
  // alice already in g1 (same lab l1) → joining g2 double-books l1.
  await seedGroup({ id: "g1", labId: "l1", members: [alice] });
  await seedGroup({ id: "g2", labId: "l1", members: [] });

  const res = await join("g2");
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "member_already_participating" });
  expect(state.calls).toEqual([]);
});

test("joining a group in ANOTHER lab stays allowed (cross-lab is free)", async () => {
  await seedLab("l1");
  await seedLab("l2");
  await seedGroup({ id: "g1", labId: "l1" });
  await seedGroup({ id: "g3", labId: "l2" });
  // alice in g1 on l1; g3 is on l2 — different lab, no conflict.
  state.rosters["g1-slug"] = [alice];
  state.rosters["g3-slug"] = [];

  const res = await join("g3");
  expect(res.status).toBe(200);
  expect(state.calls).toEqual([
    { op: "addTeamMember", args: ["g3-slug", "alice"] },
  ]);
});

test("a teacher's add-member is refused for the same within-lab double-book", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1", members: [bob] });
  await seedGroup({ id: "g2", labId: "l1", members: [] });

  const res = await app.request(
    "/api/classes/c1/groups/g2/members/bob",
    { method: "PUT" },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "member_already_participating" });
  expect(state.calls).toEqual([]);
});

test("a group from ANOTHER class is unreachable (404)", async () => {
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
  await seedGroup({ id: "g9", labId: "l9" });
  expect((await join("g9")).status).toBe(404);
  expect(state.calls).toEqual([]);
});

// --- teacher member management ---

test("students cannot manage other members", async () => {
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1" });
  const res = await app.request(
    "/api/classes/c1/groups/g1/members/bob",
    { method: "PUT" },
    env,
  );
  expect(res.status).toBe(404);
  expect(state.calls).toEqual([]);
});

test("a teacher adds and removes ANY member", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1" });
  state.rosters["g1-slug"] = [];
  const add = await app.request(
    "/api/classes/c1/groups/g1/members/bob",
    { method: "PUT" },
    env,
  );
  expect(add.status).toBe(200);
  const remove = await app.request(
    "/api/classes/c1/groups/g1/members/bob",
    { method: "DELETE" },
    env,
  );
  expect(remove.status).toBe(200);
  expect(state.calls).toEqual([
    { op: "addTeamMember", args: ["g1-slug", "bob"] },
    { op: "removeTeamMember", args: ["g1-slug", "bob"] },
  ]);
});

// --- teacher delete ---

test("students cannot delete groups", async () => {
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1" });
  const res = await app.request(
    "/api/classes/c1/groups/g1",
    { method: "DELETE" },
    env,
  );
  expect(res.status).toBe(404);
  expect(await db.select().from(groups)).toHaveLength(1);
});

test("a teacher deletes the group: team + row", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1" });
  state.rosters["g1-slug"] = [];
  const res = await app.request(
    "/api/classes/c1/groups/g1",
    { method: "DELETE" },
    env,
  );
  expect(res.status).toBe(200);
  expect(state.calls).toEqual([{ op: "deleteTeam", args: ["g1-slug"] }]);
  expect(await db.select().from(groups)).toHaveLength(0);
});

test("a group whose work repo exists can't be deleted (deliverable)", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1", repo: true });
  const res = await app.request(
    "/api/classes/c1/groups/g1",
    { method: "DELETE" },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "has_repo" });
  expect(await db.select().from(groups)).toHaveLength(1);
});

test("deleting a group whose team is already gone still drops the row", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1" }); // g1-slug NOT in rosters → 404
  const res = await app.request(
    "/api/classes/c1/groups/g1",
    { method: "DELETE" },
    env,
  );
  expect(res.status).toBe(200);
  expect(await db.select().from(groups)).toHaveLength(0);
});

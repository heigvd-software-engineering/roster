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
  createTeamFails422: false,
  calls: [] as Array<{ op: string; args: unknown[] }>,
}));

vi.mock("../src/lib/auth/config", () => ({
  createAuth: () => ({
    api: { getSession: async () => state.session },
  }),
}));

vi.mock("../src/lib/auth/github-token", () => ({
  githubAccessToken: async () => state.githubToken,
}));

vi.mock("../src/lib/github/user", () => ({
  fetchGithubProfile: async () => state.profile,
}));

vi.mock("../src/lib/github/app", () => ({
  orgLogin: async () => "acme",
}));

vi.mock("../src/lib/github/org", () => ({
  orgMembership: async () => state.membership,
}));

vi.mock("../src/lib/github/team", () => ({
  createTeam: async (
    _env: unknown,
    _inst: number,
    _org: string,
    name: string,
  ) => {
    state.calls.push({ op: "createTeam", args: [name] });
    if (state.createTeamFails422) {
      throw Object.assign(new Error("name taken"), { status: 422 });
    }
    const slug = name.toLowerCase().replaceAll(/\s+/g, "-");
    return { id: 501, slug, name };
  },
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

async function seedGroup(args?: { id?: string; classId?: string }) {
  await db.insert(groups).values({
    id: args?.id ?? "g1",
    classId: args?.classId ?? "c1",
    ghTeamId: Math.floor(Math.random() * 1e6),
    ghTeamSlug: `${args?.id ?? "g1"}-slug`,
    name: `Group ${args?.id ?? "g1"}`,
    creatorUserId: "u1",
    createdAt: now,
    updatedAt: now,
  });
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
  state.createTeamFails422 = false;
  state.calls = [];

  await db.delete(studentLabRepos);
  await db.delete(labs);
  await db.delete(groups);
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

// --- access (groups are LISTED per-lab; the class routes are actions) ---

function create(name = "Alpha Team", classId = "c1") {
  return app.request(
    `/api/classes/${classId}/groups`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    },
    env,
  );
}

test("requires auth", async () => {
  state.session = null;
  expect((await create()).status).toBe(401);
});

test("non-members get 404 (class existence never confirmed)", async () => {
  state.membership = null;
  expect((await create()).status).toBe(404);
});

test("pending invitees can't touch groups yet", async () => {
  state.membership = { state: "pending", role: "member" };
  expect((await create()).status).toBe(404);
});

test("unknown class is 404", async () => {
  expect((await create("Alpha Team", "nope")).status).toBe(404);
});

// --- create ---

test("a student creates a group and auto-joins it", async () => {
  const res = await app.request(
    "/api/classes/c1/groups",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alpha Team" }),
    },
    env,
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    group: { id: expect.any(String), name: "Alpha Team", slug: "alpha-team" },
  });
  expect(state.calls).toEqual([
    { op: "createTeam", args: ["Alpha Team"] },
    { op: "addTeamMember", args: ["alpha-team", "alice"] },
  ]);
  const rows = await db.select().from(groups);
  expect(rows).toMatchObject([
    { classId: "c1", ghTeamId: 501, ghTeamSlug: "alpha-team" },
  ]);
});

test("a teacher creates a group without joining it", async () => {
  state.membership = { state: "active", role: "admin" };
  await app.request(
    "/api/classes/c1/groups",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alpha Team" }),
    },
    env,
  );
  expect(state.calls).toEqual([{ op: "createTeam", args: ["Alpha Team"] }]);
});

test("a taken team name reads as 409 name_taken", async () => {
  state.createTeamFails422 = true;
  const res = await app.request(
    "/api/classes/c1/groups",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alpha Team" }),
    },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "name_taken" });
  expect(await db.select().from(groups)).toHaveLength(0);
});

// --- self membership ---

// --- the one-group-per-student-per-LAB invariant, membership side ---

async function seedLabWithAttachments(
  labId: string,
  groupIds: string[],
): Promise<void> {
  await db.insert(labs).values({
    id: labId,
    classId: "c1",
    title: `Lab ${labId}`,
    deadline: new Date("2099-01-01"),
    createdByUserId: "u1",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(studentLabRepos).values(
    groupIds.map((groupId) => ({
      id: `${labId}-${groupId}`,
      labId,
      groupId,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

test("join is refused when it would double-book a lab", async () => {
  await seedGroup({ id: "g1" });
  await seedGroup({ id: "g2" });
  await seedLabWithAttachments("l1", ["g1", "g2"]);
  // alice already participates in l1 through g1.
  state.rosters["g1-slug"] = [{ id: 7, login: "alice", avatarUrl: "http://p" }];
  state.rosters["g2-slug"] = [];

  const res = await app.request(
    "/api/classes/c1/groups/g2/membership",
    { method: "PUT" },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "member_already_participating" });
  expect(state.calls).toEqual([]);
});

test("a teacher's add-member is refused for the same double-booking", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedGroup({ id: "g1" });
  await seedGroup({ id: "g2" });
  await seedLabWithAttachments("l1", ["g1", "g2"]);
  state.rosters["g1-slug"] = [{ id: 8, login: "bob", avatarUrl: null }];
  state.rosters["g2-slug"] = [];

  const res = await app.request(
    "/api/classes/c1/groups/g2/members/bob",
    { method: "PUT" },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "member_already_participating" });
  expect(state.calls).toEqual([]);
});

test("joining a group whose labs don't overlap stays allowed", async () => {
  await seedGroup({ id: "g1" });
  await seedGroup({ id: "g3" });
  await seedLabWithAttachments("l1", ["g1"]);
  await seedLabWithAttachments("l2", ["g3"]);
  // alice participates in l1 via g1; g3 only touches l2 — no conflict.
  state.rosters["g1-slug"] = [{ id: 7, login: "alice", avatarUrl: "http://p" }];
  state.rosters["g3-slug"] = [];

  const res = await app.request(
    "/api/classes/c1/groups/g3/membership",
    { method: "PUT" },
    env,
  );
  expect(res.status).toBe(200);
  expect(state.calls).toEqual([
    { op: "addTeamMember", args: ["g3-slug", "alice"] },
  ]);
});

test("join adds the CALLER to the team", async () => {
  await seedGroup();
  const res = await app.request(
    "/api/classes/c1/groups/g1/membership",
    { method: "PUT" },
    env,
  );
  expect(res.status).toBe(200);
  expect(state.calls).toEqual([
    { op: "addTeamMember", args: ["g1-slug", "alice"] },
  ]);
});

test("leave removes the CALLER from the team", async () => {
  await seedGroup();
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
  await seedGroup({ id: "g9", classId: "c2" });
  const res = await app.request(
    "/api/classes/c1/groups/g9/membership",
    { method: "PUT" },
    env,
  );
  expect(res.status).toBe(404);
  expect(state.calls).toEqual([]);
});

// --- teacher member management ---

test("students cannot manage other members", async () => {
  await seedGroup();
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
  await seedGroup();
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
  await seedGroup();
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
  await seedGroup();
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

test("deleting a group whose team is already gone still drops the row", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedGroup(); // g1-slug NOT in rosters → deleteTeam throws 404
  const res = await app.request(
    "/api/classes/c1/groups/g1",
    { method: "DELETE" },
    env,
  );
  expect(res.status).toBe(200);
  expect(await db.select().from(groups)).toHaveLength(0);
});

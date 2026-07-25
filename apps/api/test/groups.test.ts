import { env } from "cloudflare:test";
import {
  account,
  classes,
  getDb,
  groupMembers,
  groups,
  labs,
  user,
} from "@roster/db";
import { eq } from "drizzle-orm";
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
  // Race hooks: run INSIDE the mocked GitHub membership calls, to simulate
  // state that changes while the request is in flight (e.g. repo creation).
  onTeamAdd: null as (() => Promise<void>) | null,
  onTeamRemove: null as (() => Promise<void>) | null,
  // group.slug → is the repo still visible to the App installation? Missing
  // = 404 (deleted). Backs unlinkGroupRepo's live re-check.
  orgRepoVisible: {} as Record<string, boolean>,
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
vi.mock("../src/lib/github/repo", () => ({
  getOrgRepo: async (
    _env: unknown,
    _inst: number,
    org: string,
    name: string,
  ) => {
    if (!state.orgRepoVisible[name]) {
      throw Object.assign(new Error("Not Found"), { status: 404 });
    }
    return { id: 1, fullName: `${org}/${name}` };
  },
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
    await state.onTeamAdd?.();
  },
  removeTeamMember: async (
    _env: unknown,
    _inst: number,
    _org: string,
    slug: string,
    username: string,
  ) => {
    state.calls.push({ op: "removeTeamMember", args: [slug, username] });
    await state.onTeamRemove?.();
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
const carol = { id: 9, login: "carol", avatarUrl: null };

async function seedLab(
  id: string,
  over: Partial<typeof labs.$inferInsert> = {},
) {
  await db.insert(labs).values({
    id,
    classId: "c1",
    title: `Lab ${id}`,
    deadline: new Date("2099-01-01"),
    createdByUserId: "u1",
    createdAt: now,
    updatedAt: now,
    ...over,
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
  state.onTeamAdd = null;
  state.onTeamRemove = null;
  state.orgRepoVisible = {};

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
  // Room to spare: the REPO LOCK is what's under test here, and an
  // individual lab (max 1) would refuse on size before the lock is reached.
  await seedLab("l1", { groupMode: "group", maxMembers: 3 });
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

// --- the size cap: the API is the boundary, not the hidden Join button ---

test("join is refused when the group is already FULL", async () => {
  await seedLab("l1", { groupMode: "group", maxMembers: 2 });
  await seedGroup({ id: "g1", labId: "l1", members: [bob, carol] });

  const res = await join();
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "group_full" });
  expect(state.calls).toEqual([]);
});

test("an individual lab's solo group is full at one", async () => {
  await seedLab("l1"); // groupMode defaults to individual: min = max = 1
  await seedGroup({ id: "g1", labId: "l1", members: [bob] });

  const res = await join();
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "group_full" });
  expect(state.calls).toEqual([]);
});

test("a group-mode lab with no maxMembers is uncapped", async () => {
  await seedLab("l1", { groupMode: "group" });
  await seedGroup({ id: "g1", labId: "l1", members: [bob, carol] });

  const res = await join();
  expect(res.status).toBe(200);
  expect(state.calls).toEqual([
    { op: "addTeamMember", args: ["g1-slug", "alice"] },
  ]);
});

// The cap binds the TEACHER too — it is the LAB's rule, not a student-only
// speed bump. The lever for a bigger group is the lab's own maxMembers.
test("a teacher's add-member is refused when the group is FULL", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab("l1", { groupMode: "group", maxMembers: 2 });
  await seedGroup({ id: "g1", labId: "l1", members: [bob, carol] });

  const res = await app.request(
    "/api/classes/c1/groups/g1/members/dave",
    { method: "PUT" },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "group_full" });
  expect(state.calls).toEqual([]);
});

test("a teacher's add-member fills a group up to the max", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab("l1", { groupMode: "group", maxMembers: 2 });
  await seedGroup({ id: "g1", labId: "l1", members: [bob] });

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

// "Individual" is a lab-level statement (a group of one), so it binds the
// teacher's add too — pairing students up means switching the LAB to group.
test("a teacher cannot add a second member to an individual lab's group", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab("l1"); // individual: min = max = 1
  await seedGroup({ id: "g1", labId: "l1", members: [bob] });

  const res = await app.request(
    "/api/classes/c1/groups/g1/members/carol",
    { method: "PUT" },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "group_full" });
  expect(state.calls).toEqual([]);
});

// Lowering the lab's max never evicts anyone, so an ALREADY-oversized group
// exists — it must not be allowed to grow further from there.
test("a teacher's add-member is refused on a group already OVER the max", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab("l1", { groupMode: "group", maxMembers: 1 });
  await seedGroup({ id: "g1", labId: "l1", members: [bob, carol] });

  const res = await app.request(
    "/api/classes/c1/groups/g1/members/dave",
    { method: "PUT" },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "group_full" });
  expect(state.calls).toEqual([]);
});

// --- the lock races repo creation: re-check after the GitHub call ---

test("a join racing repo creation is rolled back", async () => {
  await seedLab("l1", { groupMode: "group", maxMembers: 3 });
  await seedGroup({ id: "g1", labId: "l1" });
  // The repo materializes while GitHub processes the add.
  state.onTeamAdd = async () => {
    await db
      .update(groups)
      .set({ ghRepoId: 777, ghRepoFullName: "acme/g1" })
      .where(eq(groups.id, "g1"));
  };

  const res = await join();
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "has_repo" });
  expect(state.calls).toEqual([
    { op: "addTeamMember", args: ["g1-slug", "alice"] },
    { op: "removeTeamMember", args: ["g1-slug", "alice"] },
  ]);
});

test("a leave racing repo creation is reinstated", async () => {
  await seedLab("l1", { groupMode: "group", maxMembers: 3 });
  await seedGroup({ id: "g1", labId: "l1", members: [alice, bob] });
  state.onTeamRemove = async () => {
    await db
      .update(groups)
      .set({ ghRepoId: 778, ghRepoFullName: "acme/g1" })
      .where(eq(groups.id, "g1"));
  };

  const res = await app.request(
    "/api/classes/c1/groups/g1/membership",
    { method: "DELETE" },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "has_repo" });
  expect(state.calls).toEqual([
    { op: "removeTeamMember", args: ["g1-slug", "alice"] },
    { op: "addTeamMember", args: ["g1-slug", "alice"] },
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

// --- unlink repo (a repo deleted directly on GitHub) ---

function unlinkRepo(groupId = "g1", classId = "c1") {
  return app.request(
    `/api/classes/${classId}/groups/${groupId}/repo`,
    { method: "DELETE" },
    env,
  );
}

test("unlink-repo is teacher-only", async () => {
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1", repo: true });
  expect((await unlinkRepo()).status).toBe(404);
});

test("unlink-repo 404s when the group has no repo linked", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1" });
  expect((await unlinkRepo()).status).toBe(404);
});

test("unlink-repo refuses when the repo still resolves on GitHub — re-verified live, not trusted from the client", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1", repo: true });
  state.orgRepoVisible["l1-g1"] = true; // group.slug, not ghRepoFullName
  const res = await unlinkRepo();
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "still_exists" });
  const [row] = await db.select().from(groups).where(eq(groups.id, "g1"));
  expect(row?.ghRepoFullName).toBe("acme/g1");
});

test("unlink-repo clears the link once GitHub confirms 404", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1", repo: true });
  // "l1-g1" absent from orgRepoVisible → getOrgRepo 404s.
  const res = await unlinkRepo();
  expect(res.status).toBe(200);
  const [row] = await db.select().from(groups).where(eq(groups.id, "g1"));
  expect(row?.ghRepoId).toBeNull();
  expect(row?.ghRepoFullName).toBeNull();
});

test("unlink-repo unlocks deletion: the group can then be deleted", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab("l1");
  await seedGroup({ id: "g1", labId: "l1", repo: true });
  state.rosters["g1-slug"] = [];
  expect((await unlinkRepo()).status).toBe(200);
  const del = await app.request(
    "/api/classes/c1/groups/g1",
    { method: "DELETE" },
    env,
  );
  expect(del.status).toBe(200);
  expect(await db.select().from(groups)).toHaveLength(0);
});

// --- the start gate (membership frozen before the lab opens) ---

test("join is refused before the lab starts", async () => {
  await seedLab("l1", { startAt: new Date("2098-01-01T08:00:00Z") });
  await seedGroup({ id: "g1", labId: "l1" });
  const res = await join();
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "not_started" });
});

test("leave is refused before the lab starts", async () => {
  await seedLab("l1", { startAt: new Date("2098-01-01T08:00:00Z") });
  await seedGroup({ id: "g1", labId: "l1", members: [alice] });
  const res = await app.request(
    "/api/classes/c1/groups/g1/membership",
    { method: "DELETE" },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "not_started" });
});

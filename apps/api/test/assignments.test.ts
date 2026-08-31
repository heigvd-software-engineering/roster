import { env } from "cloudflare:test";
import {
  account,
  assignments,
  classes,
  getDb,
  groupMembers,
  groups,
  user,
} from "@roster/db";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  admins: [{ id: 111 }] as Array<{ id: number }>,
  deletedTeams: [] as string[],
  // What GitHub answers a team delete with: 404 (already gone) and a 500
  // (unreachable) are the two the delete path has to tell apart.
  teamDeleteStatus: null as number | null,
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
}));

vi.mock("../src/lib/github/team", () => ({
  deleteTeam: async (
    _env: unknown,
    _installationId: number,
    _org: string,
    teamSlug: string,
  ) => {
    if (state.teamDeleteStatus !== null) {
      throw Object.assign(new Error("github said no"), {
        status: state.teamDeleteStatus,
      });
    }
    state.deletedTeams.push(teamSlug);
  },
}));

const { assignmentsRoutes } = await import("../src/routes/assignments");

const app = new Hono().route("/api", assignmentsRoutes);
const db = getDb(env.DB);
const now = new Date(0);

function post(body: unknown, classId = "c1") {
  return app.request(
    `/api/classes/${classId}/assignments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

const validAssignment = {
  title: "Lab 1 — TCP sockets",
  deadline: "2026-08-01T23:59:00.000Z",
  groupMode: "individual",
};

beforeEach(async () => {
  state.session = { user: { id: "u1" } };
  state.admins = [{ id: 111 }];
  state.deletedTeams = [];
  state.teamDeleteStatus = null;
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(assignments);
  await db.delete(classes);
  await db.delete(account);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "U1", email: "u1@x.ch" });
  await db.insert(account).values({
    id: "a1",
    userId: "u1",
    issuer: "local:oauth:github",
    providerId: "github",
    accountId: "111",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(classes).values({
    id: "c1",
    orgId: 42,
    installationId: 100,
    connectedByUserId: "u1",
    joinToken: "tok123tok123tok123tok123tok12345",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
});

test("creates an individual assignment and returns the row", async () => {
  const res = await post(validAssignment);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { assignment: Record<string, unknown> };
  expect(body.assignment).toMatchObject({
    classId: "c1",
    title: "Lab 1 — TCP sockets",
    groupMode: "individual",
    minMembers: null,
    maxMembers: null,
    createdByUserId: "u1",
  });

  const rows = await db.select().from(assignments);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.deadline).toEqual(new Date("2026-08-01T23:59:00.000Z"));
});

test("creates a group assignment with min/max members", async () => {
  const res = await post({
    ...validAssignment,
    groupMode: "group",
    minMembers: 2,
    maxMembers: 3,
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { assignment: Record<string, unknown> };
  expect(body.assignment).toMatchObject({
    groupMode: "group",
    minMembers: 2,
    maxMembers: 3,
  });
});

test("rejects invalid inputs with 400 and writes nothing", async () => {
  const cases: unknown[] = [
    { ...validAssignment, title: "  " },
    { ...validAssignment, deadline: "not-a-date" },
    { ...validAssignment, groupMode: "group" }, // group without min/max
    { ...validAssignment, groupMode: "group", minMembers: 3, maxMembers: 2 },
    { ...validAssignment, minMembers: 2 }, // individual with members
  ];
  for (const body of cases) {
    const res = await post(body);
    expect(res.status).toBe(400);
  }
  expect(await db.select().from(assignments)).toHaveLength(0);
});

test("unknown class returns 404", async () => {
  const res = await post(validAssignment, "nope");
  expect(res.status).toBe(404);
});

test("non-admin gets 404 and writes nothing", async () => {
  state.admins = [{ id: 999 }];
  const res = await post(validAssignment);
  expect(res.status).toBe(404);
  expect(await db.select().from(assignments)).toHaveLength(0);
});

test("unauthenticated gets 401", async () => {
  state.session = null;
  const res = await post(validAssignment);
  expect(res.status).toBe(401);
});

// --- the start gate's data model (spec 2026-07-23) ---

test("create persists an explicit start date", async () => {
  const res = await post({
    ...validAssignment,
    startAt: "2026-07-01T08:00:00.000Z",
  });
  expect(res.status).toBe(200);
  const [row] = await db.select().from(assignments);
  expect(row?.startAt?.toISOString()).toBe("2026-07-01T08:00:00.000Z");
});

test("create without a start leaves it null (starts immediately)", async () => {
  const res = await post(validAssignment);
  expect(res.status).toBe(200);
  const [row] = await db.select().from(assignments);
  expect(row?.startAt).toBeNull();
});

test("a start at or after the deadline is refused", async () => {
  const res = await post({
    ...validAssignment,
    startAt: validAssignment.deadline,
  });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "start_after_deadline" });
});

test("two assignments with overlapping start–deadline ranges both succeed", async () => {
  const a = await post({
    ...validAssignment,
    startAt: "2026-07-01T08:00:00.000Z",
  });
  const b = await post({
    ...validAssignment,
    title: "Assignment 2 — overlapping",
    startAt: "2026-07-15T08:00:00.000Z",
  });
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
});

test("update sets and then clears the start date", async () => {
  await post(validAssignment);
  const [created] = await db.select().from(assignments);
  const put = (body: unknown) =>
    app.request(
      `/api/classes/c1/assignments/${created?.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );
  const set = await put({
    ...validAssignment,
    startAt: "2026-07-01T08:00:00.000Z",
  });
  expect(set.status).toBe(200);
  let [row] = await db.select().from(assignments);
  expect(row?.startAt?.toISOString()).toBe("2026-07-01T08:00:00.000Z");
  const cleared = await put(validAssignment);
  expect(cleared.status).toBe(200);
  [row] = await db.select().from(assignments);
  expect(row?.startAt).toBeNull();
});

// --- delete ---

function del(assignmentId: string, classId = "c1") {
  return app.request(
    `/api/classes/${classId}/assignments/${assignmentId}`,
    { method: "DELETE" },
    env,
  );
}

/** An assignment with one group, that group's cached roster, and (optionally) a work
 *  repo already linked to it: the state every delete case starts from. */
async function seedAssignment({ withRepo = false } = {}) {
  await db.insert(assignments).values({
    id: "l1",
    classId: "c1",
    title: "Assignment 1",
    deadline: new Date("2026-08-01T23:59:00.000Z"),
    groupMode: "individual",
    createdByUserId: "u1",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(groups).values({
    id: "g1",
    assignmentId: "l1",
    ghTeamId: 900,
    ghTeamSlug: "assignment-1-team-alpha",
    slug: "assignment-1-team-alpha",
    name: "Team Alpha",
    ghRepoId: withRepo ? 555 : null,
    ghRepoFullName: withRepo ? "acme/assignment-1-team-alpha" : null,
    creatorUserId: "u1",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(groupMembers).values({
    id: "gm1",
    groupId: "g1",
    githubId: "222",
    login: "student",
    createdAt: now,
    updatedAt: now,
  });
}

test("deletes an assignment that has no groups", async () => {
  await post(validAssignment);
  const [created] = await db.select().from(assignments);
  const res = await del(created?.id ?? "");
  expect(res.status).toBe(200);
  expect(await db.select().from(assignments)).toHaveLength(0);
  expect(state.deletedTeams).toEqual([]);
});

test("delete takes the assignment's groups, their teams and cached rosters", async () => {
  await seedAssignment();
  const res = await del("l1");
  expect(res.status).toBe(200);
  expect(state.deletedTeams).toEqual(["assignment-1-team-alpha"]);
  expect(await db.select().from(assignments)).toHaveLength(0);
  expect(await db.select().from(groups)).toHaveLength(0);
  // FK ON DELETE cascade, not a delete of our own.
  expect(await db.select().from(groupMembers)).toHaveLength(0);
});

test("delete goes through even once a group has its work repo", async () => {
  // No `has_repo` guard here, unlike deleteGroup: the confirm dialog is the
  // gate. The repo itself survives in the org, orphaned.
  await seedAssignment({ withRepo: true });
  const res = await del("l1");
  expect(res.status).toBe(200);
  expect(await db.select().from(assignments)).toHaveLength(0);
  expect(await db.select().from(groups)).toHaveLength(0);
});

test("a team already gone on GitHub still drops the rows", async () => {
  await seedAssignment();
  state.teamDeleteStatus = 404;
  const res = await del("l1");
  expect(res.status).toBe(200);
  expect(await db.select().from(assignments)).toHaveLength(0);
  expect(await db.select().from(groups)).toHaveLength(0);
});

test("a team delete GitHub refuses leaves every row in place", async () => {
  await seedAssignment();
  state.teamDeleteStatus = 500;
  const res = await del("l1");
  expect(res.status).toBe(500);
  expect(await db.select().from(assignments)).toHaveLength(1);
  expect(await db.select().from(groups)).toHaveLength(1);
});

test("delete of an unknown assignment, or one in another class, returns 404", async () => {
  await seedAssignment();
  expect((await del("nope")).status).toBe(404);
  expect((await del("l1", "c2")).status).toBe(404);
  expect(await db.select().from(assignments)).toHaveLength(1);
});

test("non-admin cannot delete", async () => {
  await seedAssignment();
  state.admins = [{ id: 999 }];
  const res = await del("l1");
  expect(res.status).toBe(404);
  expect(await db.select().from(assignments)).toHaveLength(1);
  expect(state.deletedTeams).toEqual([]);
});

test("unauthenticated cannot delete", async () => {
  await seedAssignment();
  state.session = null;
  const res = await del("l1");
  expect(res.status).toBe(401);
  expect(await db.select().from(assignments)).toHaveLength(1);
});

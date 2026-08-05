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

const { labsRoutes } = await import("../src/routes/labs");

const app = new Hono().route("/api", labsRoutes);
const db = getDb(env.DB);
const now = new Date(0);

function post(body: unknown, classId = "c1") {
  return app.request(
    `/api/classes/${classId}/labs`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

const validLab = {
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
  await db.delete(labs);
  await db.delete(classes);
  await db.delete(account);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "U1", email: "u1@x.ch" });
  await db.insert(account).values({
    id: "a1",
    userId: "u1",
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

test("creates an individual lab and returns the row", async () => {
  const res = await post(validLab);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { lab: Record<string, unknown> };
  expect(body.lab).toMatchObject({
    classId: "c1",
    title: "Lab 1 — TCP sockets",
    groupMode: "individual",
    minMembers: null,
    maxMembers: null,
    createdByUserId: "u1",
  });

  const rows = await db.select().from(labs);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.deadline).toEqual(new Date("2026-08-01T23:59:00.000Z"));
});

test("creates a group lab with min/max members", async () => {
  const res = await post({
    ...validLab,
    groupMode: "group",
    minMembers: 2,
    maxMembers: 3,
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { lab: Record<string, unknown> };
  expect(body.lab).toMatchObject({
    groupMode: "group",
    minMembers: 2,
    maxMembers: 3,
  });
});

test("rejects invalid inputs with 400 and writes nothing", async () => {
  const cases: unknown[] = [
    { ...validLab, title: "  " },
    { ...validLab, deadline: "not-a-date" },
    { ...validLab, groupMode: "group" }, // group without min/max
    { ...validLab, groupMode: "group", minMembers: 3, maxMembers: 2 },
    { ...validLab, minMembers: 2 }, // individual with members
  ];
  for (const body of cases) {
    const res = await post(body);
    expect(res.status).toBe(400);
  }
  expect(await db.select().from(labs)).toHaveLength(0);
});

test("unknown class returns 404", async () => {
  const res = await post(validLab, "nope");
  expect(res.status).toBe(404);
});

test("non-admin gets 404 and writes nothing", async () => {
  state.admins = [{ id: 999 }];
  const res = await post(validLab);
  expect(res.status).toBe(404);
  expect(await db.select().from(labs)).toHaveLength(0);
});

test("unauthenticated gets 401", async () => {
  state.session = null;
  const res = await post(validLab);
  expect(res.status).toBe(401);
});

// --- the start gate's data model (spec 2026-07-23) ---

test("create persists an explicit start date", async () => {
  const res = await post({ ...validLab, startAt: "2026-07-01T08:00:00.000Z" });
  expect(res.status).toBe(200);
  const [row] = await db.select().from(labs);
  expect(row?.startAt?.toISOString()).toBe("2026-07-01T08:00:00.000Z");
});

test("create without a start leaves it null (starts immediately)", async () => {
  const res = await post(validLab);
  expect(res.status).toBe(200);
  const [row] = await db.select().from(labs);
  expect(row?.startAt).toBeNull();
});

test("a start at or after the deadline is refused", async () => {
  const res = await post({ ...validLab, startAt: validLab.deadline });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "start_after_deadline" });
});

test("two labs with overlapping start–deadline ranges both succeed", async () => {
  const a = await post({ ...validLab, startAt: "2026-07-01T08:00:00.000Z" });
  const b = await post({
    ...validLab,
    title: "Lab 2 — overlapping",
    startAt: "2026-07-15T08:00:00.000Z",
  });
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
});

test("update sets and then clears the start date", async () => {
  await post(validLab);
  const [created] = await db.select().from(labs);
  const put = (body: unknown) =>
    app.request(
      `/api/classes/c1/labs/${created?.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );
  const set = await put({ ...validLab, startAt: "2026-07-01T08:00:00.000Z" });
  expect(set.status).toBe(200);
  let [row] = await db.select().from(labs);
  expect(row?.startAt?.toISOString()).toBe("2026-07-01T08:00:00.000Z");
  const cleared = await put(validLab);
  expect(cleared.status).toBe(200);
  [row] = await db.select().from(labs);
  expect(row?.startAt).toBeNull();
});

// --- delete ---

function del(labId: string, classId = "c1") {
  return app.request(
    `/api/classes/${classId}/labs/${labId}`,
    { method: "DELETE" },
    env,
  );
}

/** A lab with one group, that group's cached roster, and (optionally) a work
 *  repo already linked to it: the state every delete case starts from. */
async function seedLab({ withRepo = false } = {}) {
  await db.insert(labs).values({
    id: "l1",
    classId: "c1",
    title: "Lab 1",
    deadline: new Date("2026-08-01T23:59:00.000Z"),
    groupMode: "individual",
    createdByUserId: "u1",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(groups).values({
    id: "g1",
    labId: "l1",
    ghTeamId: 900,
    ghTeamSlug: "lab-1-team-alpha",
    slug: "lab-1-team-alpha",
    name: "Team Alpha",
    ghRepoId: withRepo ? 555 : null,
    ghRepoFullName: withRepo ? "acme/lab-1-team-alpha" : null,
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

test("deletes a lab that has no groups", async () => {
  await post(validLab);
  const [created] = await db.select().from(labs);
  const res = await del(created?.id ?? "");
  expect(res.status).toBe(200);
  expect(await db.select().from(labs)).toHaveLength(0);
  expect(state.deletedTeams).toEqual([]);
});

test("delete takes the lab's groups, their teams and cached rosters", async () => {
  await seedLab();
  const res = await del("l1");
  expect(res.status).toBe(200);
  expect(state.deletedTeams).toEqual(["lab-1-team-alpha"]);
  expect(await db.select().from(labs)).toHaveLength(0);
  expect(await db.select().from(groups)).toHaveLength(0);
  // FK ON DELETE cascade, not a delete of our own.
  expect(await db.select().from(groupMembers)).toHaveLength(0);
});

test("delete goes through even once a group has its work repo", async () => {
  // No `has_repo` guard here, unlike deleteGroup: the confirm dialog is the
  // gate. The repo itself survives in the org, orphaned.
  await seedLab({ withRepo: true });
  const res = await del("l1");
  expect(res.status).toBe(200);
  expect(await db.select().from(labs)).toHaveLength(0);
  expect(await db.select().from(groups)).toHaveLength(0);
});

test("a team already gone on GitHub still drops the rows", async () => {
  await seedLab();
  state.teamDeleteStatus = 404;
  const res = await del("l1");
  expect(res.status).toBe(200);
  expect(await db.select().from(labs)).toHaveLength(0);
  expect(await db.select().from(groups)).toHaveLength(0);
});

test("a team delete GitHub refuses leaves every row in place", async () => {
  await seedLab();
  state.teamDeleteStatus = 500;
  const res = await del("l1");
  expect(res.status).toBe(500);
  expect(await db.select().from(labs)).toHaveLength(1);
  expect(await db.select().from(groups)).toHaveLength(1);
});

test("delete of an unknown lab, or one in another class, returns 404", async () => {
  await seedLab();
  expect((await del("nope")).status).toBe(404);
  expect((await del("l1", "c2")).status).toBe(404);
  expect(await db.select().from(labs)).toHaveLength(1);
});

test("non-admin cannot delete", async () => {
  await seedLab();
  state.admins = [{ id: 999 }];
  const res = await del("l1");
  expect(res.status).toBe(404);
  expect(await db.select().from(labs)).toHaveLength(1);
  expect(state.deletedTeams).toEqual([]);
});

test("unauthenticated cannot delete", async () => {
  await seedLab();
  state.session = null;
  const res = await del("l1");
  expect(res.status).toBe(401);
  expect(await db.select().from(labs)).toHaveLength(1);
});

import { env } from "cloudflare:test";
import { account, classes, classMembers, getDb, user } from "@roster/db";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

// What POST /classes/:id/teachers WRITES. The endpoint's own response is a bare
// {state}, so the interesting outcome is the `class_members` row: which of the
// two id spaces it lands in, and whether an invited TEACHER can be told apart
// from an invited student.

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  /** The looked-up invitee. */
  ghUser: { id: 222, login: "newprof", avatarUrl: "http://n" } as {
    id: number;
    login: string;
    avatarUrl: string | null;
  } | null,
  /** The invitee's LIVE org membership — null means "not in the org". */
  membership: null as { state: "active" | "pending"; role: string } | null,
  /** The invitation id GitHub hands back. */
  invitationId: 900,
  promoted: [] as string[],
  invited: [] as number[],
}));

vi.mock("../src/lib/auth/config", () => ({
  createAuth: () => ({ api: { getSession: async () => state.session } }),
}));

vi.mock("../src/lib/github/app", () => ({ orgLogin: async () => "acme" }));

vi.mock("../src/lib/github/org", () => ({
  isOrgAdmin: async () => true,
  orgMembership: async () => state.membership,
  lookupUser: async () => state.ghUser,
  promoteToOrgAdmin: async (
    _e: unknown,
    _i: number,
    _o: string,
    login: string,
  ) => {
    state.promoted.push(login);
  },
  inviteOrgAdmin: async (
    _e: unknown,
    _i: number,
    _o: string,
    inviteeId: number,
  ) => {
    state.invited.push(inviteeId);
    return state.invitationId;
  },
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
const now = new Date(0);

const invite = (username = "newprof") =>
  app.request(
    "/api/classes/c1/teachers",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username }),
    },
    env,
  );

beforeEach(async () => {
  state.session = { user: { id: "u1" } };
  state.ghUser = { id: 222, login: "newprof", avatarUrl: "http://n" };
  state.membership = null;
  state.invitationId = 900;
  state.promoted = [];
  state.invited = [];

  await db.delete(classMembers);
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

test("inviting a NON-member records both ids and marks them an invited teacher", async () => {
  const res = await invite();

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ state: "pending" });
  expect(state.invited).toEqual([222]);

  const rows = await db.select().from(classMembers);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    // The invitation id: how the LIVE roster reports this person, so the
    // reconciler sees no drift.
    invitationId: "900",
    // The user id: we chose the invitee, so we know it — and this is what lets
    // them find their own row by id when they accept.
    githubId: "222",
    // Not plain `pending`: that would list them among the students.
    state: "pending_teacher",
    login: "newprof",
    // Kept from the lookup we already did. GitHub's invitations API has no
    // avatar, but we picked this invitee — so they get a face while pending,
    // and the heal has something to carry forward instead of a null.
    avatarUrl: "http://n",
  });
});

test("inviting an ACTIVE member promotes in place — no invitation is created", async () => {
  state.membership = { state: "active", role: "member" };

  const res = await invite();

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ state: "teacher" });
  expect(state.promoted).toEqual(["newprof"]);
  expect(state.invited).toEqual([]);

  const rows = await db.select().from(classMembers);
  expect(rows[0]).toMatchObject({
    githubId: "222",
    state: "teacher",
    // A promotion never involved an invitation.
    invitationId: null,
  });
});

test("a stale row under the invitee's user id is replaced, not duplicated", async () => {
  // They are NOT in the org, so any row still keyed by their user id is stale —
  // and would collide with the unique (classId, githubId) on insert.
  await db.insert(classMembers).values({
    id: "cm-stale",
    classId: "c1",
    githubId: "222",
    login: "newprof",
    avatarUrl: null,
    state: "active",
    createdAt: now,
    updatedAt: now,
  });

  const res = await invite();

  expect(res.status).toBe(200);
  const rows = await db.select().from(classMembers);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    githubId: "222",
    invitationId: "900",
    state: "pending_teacher",
  });
});

test("an open invitation blocks a second one", async () => {
  state.membership = { state: "pending", role: "admin" };

  const res = await invite();

  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "already_invited" });
  expect(state.invited).toEqual([]);
});

test("an existing Owner is refused", async () => {
  state.membership = { state: "active", role: "admin" };

  const res = await invite();

  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "already_teacher" });
  expect(state.promoted).toEqual([]);
});

test("an unknown GitHub username is a 404 and writes nothing", async () => {
  state.ghUser = null;

  const res = await invite("ghost");

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "no_such_user" });
  expect(await db.select().from(classMembers)).toEqual([]);
});

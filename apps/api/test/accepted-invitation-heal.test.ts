import { env } from "cloudflare:test";
import { account, classes, classMembers, getDb, user } from "@roster/db";
import { beforeEach, expect, test, vi } from "vitest";
import type { AuthEnv } from "../src/lib/auth/config";

// What `customSession` runs on every session read: resolve the caller's own
// accepted teacher invitation. Two properties matter as much as the heal
// itself: it must not touch anyone else's rows, and it must not reach for
// GitHub when the user has nothing outstanding.

const state = vi.hoisted(() => ({
  /** The caller's live org roles, keyed by lowercased org login. */
  orgMemberships: {} as Record<string, { role: string; state: string }>,
  token: "tok" as string | null,
  tokenCalls: 0,
  membershipCalls: 0,
}));

vi.mock("../src/lib/auth/github-token", () => ({
  githubAccessToken: async () => {
    state.tokenCalls++;
    return state.token;
  },
}));

vi.mock("../src/lib/github/user", () => ({
  userOrgMemberships: async () => {
    state.membershipCalls++;
    const byLogin = new Map(Object.entries(state.orgMemberships));
    return { byLogin, login: "prof" };
  },
}));

const { healAcceptedInvitations } = await import(
  "../src/lib/auth/accepted-invitation-heal"
);

const db = getDb(env.DB);
const now = new Date(0);
const authEnv = { ...env } as AuthEnv;

async function seedClass(id: string, login: string) {
  await db.insert(classes).values({
    id,
    orgId: id === "c1" ? 42 : 43,
    installationId: 100,
    connectedByUserId: "u1",
    joinToken: `tok-${id}`,
    status: "active",
    login,
    createdAt: now,
    updatedAt: now,
  });
}

async function member(row: {
  id: string;
  classId: string;
  githubId?: string | null;
  invitationId?: string | null;
  login: string;
  state: "pending" | "pending_teacher" | "active" | "teacher";
}) {
  await db.insert(classMembers).values({
    id: row.id,
    classId: row.classId,
    githubId: row.githubId ?? null,
    invitationId: row.invitationId ?? null,
    login: row.login,
    avatarUrl: null,
    state: row.state,
    createdAt: now,
    updatedAt: now,
  });
}

const rows = async () =>
  (await db.select().from(classMembers))
    .map((r) => [r.login, r.state, r.githubId, r.invitationId])
    .sort();

beforeEach(async () => {
  state.orgMemberships = { acme: { role: "admin", state: "active" } };
  state.token = "tok";
  state.tokenCalls = 0;
  state.membershipCalls = 0;

  await db.delete(classMembers);
  await db.delete(classes);
  await db.delete(account);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "Prof", email: "p@x.ch" });
  // The signed-in user's linked GitHub id.
  await db.insert(account).values({
    id: "a1",
    userId: "u1",
    issuer: "local:oauth:github",
    providerId: "github",
    accountId: "111",
    createdAt: now,
    updatedAt: now,
  });
  await seedClass("c1", "acme");
});

test("resolves the caller's accepted invitation into a teacher row", async () => {
  await member({
    id: "cm-self",
    classId: "c1",
    githubId: "111",
    invitationId: "900",
    login: "prof",
    state: "pending_teacher",
  });

  await healAcceptedInvitations(authEnv, "u1");

  expect(await rows()).toEqual([
    // The invitation is gone: a row still naming one would keep them "invited".
    ["prof", "teacher", "111", null],
  ]);
});

test("keeps the avatar — healing is a state change, not a re-observation", async () => {
  // Blanking it would manufacture drift: reconcile compares against the live
  // roster, so a nulled avatar reads as "they changed their avatar" after every
  // accepted invitation.
  await db.insert(classMembers).values({
    id: "cm-self",
    classId: "c1",
    githubId: "111",
    invitationId: "900",
    login: "prof",
    avatarUrl: "http://avatar/prof",
    state: "pending_teacher",
    createdAt: now,
    updatedAt: now,
  });

  await healAcceptedInvitations(authEnv, "u1");

  const [row] = await db.select().from(classMembers);
  expect(row).toMatchObject({
    state: "teacher",
    avatarUrl: "http://avatar/prof",
  });
});

test("a STUDENT who accepted becomes active, not a teacher", async () => {
  // The live role decides the state. A student joins the org as a plain
  // member, so healing them into `teacher` would hand them the teacher hub.
  await member({
    id: "cm-student",
    classId: "c1",
    githubId: "111",
    login: "prof",
    state: "pending",
  });
  state.orgMemberships = { acme: { role: "member", state: "active" } };

  await healAcceptedInvitations(authEnv, "u1");

  expect(await rows()).toEqual([["prof", "active", "111", null]]);
});

test("does NOT heal while GitHub still says the invitation is open", async () => {
  // The cached row is a claim, not evidence. Only live GitHub can say the
  // invitation was accepted, and here it says they are still pending.
  state.orgMemberships = { acme: { role: "admin", state: "pending" } };
  await member({
    id: "cm-self",
    classId: "c1",
    githubId: "111",
    invitationId: "900",
    login: "prof",
    state: "pending_teacher",
  });

  await healAcceptedInvitations(authEnv, "u1");

  expect(await rows()).toEqual([["prof", "pending_teacher", "111", "900"]]);
});

test("touches ONLY the signed-in user — never another invitee's row", async () => {
  await member({
    id: "cm-self",
    classId: "c1",
    githubId: "111",
    invitationId: "900",
    login: "prof",
    state: "pending_teacher",
  });
  await member({
    id: "cm-other",
    classId: "c1",
    githubId: "222",
    invitationId: "901",
    login: "colleague",
    state: "pending_teacher",
  });

  await healAcceptedInvitations(authEnv, "u1");

  expect(await rows()).toEqual([
    // Still invited: we have no evidence they accepted.
    ["colleague", "pending_teacher", "222", "901"],
    ["prof", "teacher", "111", null],
  ]);
});

test("heals only the classes the caller actually owns now", async () => {
  await seedClass("c2", "other-org");
  await member({
    id: "cm-c1",
    classId: "c1",
    githubId: "111",
    invitationId: "900",
    login: "prof",
    state: "pending_teacher",
  });
  await member({
    id: "cm-c2",
    classId: "c2",
    githubId: "111",
    invitationId: "901",
    login: "prof",
    state: "pending_teacher",
  });
  // Owner of acme only, so the other invitation is still outstanding.
  state.orgMemberships = { acme: { role: "admin", state: "active" } };

  await healAcceptedInvitations(authEnv, "u1");

  expect(await rows()).toEqual([
    ["prof", "pending_teacher", "111", "901"],
    ["prof", "teacher", "111", null],
  ]);
});

test("with nothing outstanding it never reaches for GitHub", async () => {
  // Why this can hang off every session read: the DB gate runs first, so the
  // common read costs one indexed query and no network.
  await member({
    id: "cm-self",
    classId: "c1",
    githubId: "111",
    login: "prof",
    state: "teacher",
  });

  await healAcceptedInvitations(authEnv, "u1");

  expect(state.tokenCalls).toBe(0);
  expect(state.membershipCalls).toBe(0);
});

test("a user with no linked GitHub account is a no-op", async () => {
  await db.delete(account);

  await healAcceptedInvitations(authEnv, "u1");

  expect(state.tokenCalls).toBe(0);
});

test("a failure never propagates — the session must not depend on the heal", async () => {
  state.token = null; // no usable GitHub token
  await member({
    id: "cm-self",
    classId: "c1",
    githubId: "111",
    invitationId: "900",
    login: "prof",
    state: "pending_teacher",
  });

  await expect(healAcceptedInvitations(authEnv, "u1")).resolves.toBeUndefined();
  // Left for reconcile, exactly as before.
  expect(await rows()).toEqual([["prof", "pending_teacher", "111", "900"]]);
});

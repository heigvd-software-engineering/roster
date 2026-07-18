import { env } from "cloudflare:test";
import { classes, classMembers, getDb, user } from "@labs/db";
import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import type { AuthEnv } from "../src/lib/auth/config";

const state = vi.hoisted(() => ({
  people: {
    teachers: [] as { id: number; login: string; avatarUrl: string | null }[],
    students: [] as { id: number; login: string; avatarUrl: string | null }[],
    // Pending people are keyed by INVITATION id and carry the role the invite
    // grants — the two facts that make them a different id space from members.
    pending: [] as {
      id: number;
      login: string;
      avatarUrl: string | null;
      role: "member" | "admin";
    }[],
  },
}));

vi.mock("../src/lib/github/org", () => ({
  orgInfo: vi.fn(async () => ({
    login: "acme",
    name: "Acme",
    avatarUrl: "http://a",
  })),
  orgPeople: vi.fn(async () => state.people),
  basePermission: vi.fn(async () => "none"),
}));

vi.mock("../src/lib/github/repo", () => ({
  orgRepoActivity: vi.fn(async () => new Map()),
}));

const { buildContext } = await import("../src/lib/reconcile/context");
const { roster } = await import("../src/lib/reconcile/roster");

const db = getDb(env.DB);
const now = new Date(0);

const authEnv = {
  ...env,
  BETTER_AUTH_URL: "http://localhost:8787",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
  EDUID_ISSUER: "https://login.eduid.example",
  EDUID_CLIENT_ID: "eduid",
  EDUID_CLIENT_SECRET: "eduid-secret",
  GITHUB_CLIENT_ID: "Iv23test",
  GITHUB_CLIENT_SECRET: "gh-secret",
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: "unused",
  GITHUB_APP_SLUG: "labs",
} as AuthEnv;

async function ctx() {
  const [cls] = await db.select().from(classes).where(eq(classes.id, "cls"));
  if (!cls) throw new Error("no class");
  return buildContext(authEnv, db, cls, {
    installationId: 200,
    login: "acme",
  });
}

async function cache(
  rows: {
    /** Absent for an invitation nobody could attribute to a user. */
    githubId?: string | null;
    invitationId?: string | null;
    login: string;
    state: string;
  }[],
) {
  await db.insert(classMembers).values(
    rows.map((r, i) => ({
      id: `m-${r.githubId ?? r.invitationId ?? i}`,
      classId: "cls",
      githubId: r.githubId ?? null,
      invitationId: r.invitationId ?? null,
      login: r.login,
      avatarUrl: null,
      state: r.state as "pending" | "pending_teacher" | "active" | "teacher",
      createdAt: now,
      updatedAt: now,
    })),
  );
}

const cachedIds = async () =>
  (await db.select().from(classMembers)).map((m) => m.githubId).sort();

beforeEach(async () => {
  state.people = { teachers: [], students: [], pending: [] };
  await db.delete(classMembers);
  await db.delete(classes);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "Prof", email: "prof@x.ch" });
  await db.insert(classes).values({
    id: "cls",
    orgId: 42,
    installationId: 100,
    connectedByUserId: "u1",
    joinToken: "tok",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
});

test("audit: an Owner who is also a member reads as teacher, not active", async () => {
  // liveStates applies owners LAST, so the two GitHub lists can overlap.
  const prof = { id: 1, login: "prof", avatarUrl: null };
  state.people = { teachers: [prof], students: [prof], pending: [] };

  const findings = await roster.audit(await ctx());
  expect(findings.map((f) => f.fix)).toEqual(["Add them to the class roster"]);

  await roster.apply(await ctx(), ["roster:add:user=1"]);
  const [row] = await db.select().from(classMembers);
  expect(row?.state).toBe("teacher");
});

test("apply removes ONLY the named subject, never a bulk sweep", async () => {
  // THE safety property. GitHub's roster is empty, so a whole-roster sweep
  // ("delete everyone absent from the live roster") would wipe all three. The
  // teacher checked one box; apply must destroy exactly one row.
  await cache([
    { githubId: "7", login: "a", state: "active" },
    { githubId: "8", login: "b", state: "active" },
    { githubId: "9", login: "c", state: "active" },
  ]);

  const results = await roster.apply(await ctx(), ["roster:remove:user=8"]);

  expect(results).toEqual([{ key: "roster:remove:user=8", ok: true }]);
  expect(await cachedIds()).toEqual(["7", "9"]);
});

test("apply: removing a row that is already gone is a success (replay)", async () => {
  await cache([{ githubId: "9", login: "gone", state: "active" }]);
  const key = "roster:remove:user=9";

  expect(await roster.apply(await ctx(), [key])).toEqual([{ key, ok: true }]);
  expect(await roster.apply(await ctx(), [key])).toEqual([{ key, ok: true }]);
  expect(await cachedIds()).toEqual([]);
});

test("apply writes what GitHub says NOW, not what the proposal described", async () => {
  // The audit saw a pending invite. By the time the teacher clicks Apply the
  // student has accepted. We trust the teacher's choice of SUBJECT and re-read
  // the STATE — so the row lands as "active", not the stale "pending".
  state.people = {
    teachers: [],
    students: [{ id: 5, login: "renamed", avatarUrl: "http://new" }],
    pending: [],
  };
  await roster.apply(await ctx(), ["roster:add:user=5"]);

  const [row] = await db.select().from(classMembers);
  expect(row).toMatchObject({
    githubId: "5",
    state: "active",
    login: "renamed",
    avatarUrl: "http://new",
  });
});

test("apply: a subject GitHub no longer knows fails as ONE op, and the rest still run", async () => {
  state.people = {
    teachers: [],
    students: [{ id: 5, login: "here", avatarUrl: null }],
    pending: [],
  };
  await cache([{ githubId: "9", login: "gone", state: "active" }]);

  const results = await roster.apply(await ctx(), [
    "roster:add:user=404",
    "roster:add:user=5",
    "roster:remove:user=9",
  ]);

  expect(results).toEqual([
    {
      key: "roster:add:user=404",
      ok: false,
      error: "no longer on the organization's roster",
    },
    { key: "roster:add:user=5", ok: true },
    { key: "roster:remove:user=9", ok: true },
  ]);
  expect(await cachedIds()).toEqual(["5"]);
});

// ── The two id spaces ──────────────────────────────────────────────────────
// GitHub reports members by USER id and open invitations by INVITATION id, and
// never gives the invitee's user id on an invitation. Everything below is about
// keeping those apart without letting the same person read as two people.

test("audit: an open Owner invitation reads as an invited TEACHER", async () => {
  // The invite's role is the only thing separating an invited teacher from an
  // invited student — `state: pending` alone would list them with the students.
  state.people.pending = [
    { id: 900, login: "newprof", avatarUrl: null, role: "admin" },
    { id: 901, login: "newstudent", avatarUrl: null, role: "member" },
  ];

  const findings = await roster.audit(await ctx());

  expect(findings.map((f) => [f.key, f.change?.to])).toEqual([
    ["roster:add:invite=900", "Invited as teacher"],
    ["roster:add:invite=901", "Invited"],
  ]);
});

test("audit: an ACCEPTED invitation is one promotion, not a remove plus an add", async () => {
  // THE case the invitation id exists for. Our own invite recorded both ids;
  // the invitee has now accepted, so GitHub lists them as an Owner and the
  // invitation is gone. Comparing the cached row in the INVITE space would
  // report "invitation vanished" + "unknown owner appeared" — two findings
  // about one person, neither of them true.
  await cache([
    {
      githubId: "5",
      invitationId: "900",
      login: "newprof",
      state: "pending_teacher",
    },
  ]);
  state.people.teachers = [{ id: 5, login: "newprof", avatarUrl: null }];

  const findings = await roster.audit(await ctx());

  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({
    key: "roster:promote:user=5",
    change: { from: "Invited as teacher", to: "Teacher" },
  });
});

test("apply: accepting an invitation leaves no invitation behind", async () => {
  await cache([
    {
      githubId: "5",
      invitationId: "900",
      login: "newprof",
      state: "pending_teacher",
    },
  ]);
  state.people.teachers = [{ id: 5, login: "newprof", avatarUrl: null }];

  expect(await roster.apply(await ctx(), ["roster:promote:user=5"])).toEqual([
    { key: "roster:promote:user=5", ok: true },
  ]);

  const rows = await db.select().from(classMembers);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    githubId: "5",
    state: "teacher",
    // Cleared: a row still claiming an open invitation would keep showing them
    // as invited, and would hold the unique (classId, invitationId) slot.
    invitationId: null,
  });
});

test("apply: someone else's open invitation survives an unrelated member being added", async () => {
  // REGRESSION. Resolving a user subject clears any invitation row belonging to
  // THAT person. An invite sent from GitHub's own UI carries no user id, so
  // login is the only thing tying it to anyone — and a predicate of "any
  // invitation without a user id" would happily match a stranger's.
  //
  // The person being added here never had an invitation, so the correct answer
  // is to touch nothing: the only id-less invitation belongs to someone else.
  // Stating it this way keeps the test independent of row order, which D1 does
  // not promise (an order-dependent version of this passed against the bug).
  await cache([{ invitationId: "901", login: "unrelated", state: "pending" }]);
  state.people.teachers = [{ id: 5, login: "newprof", avatarUrl: null }];
  state.people.pending = [
    { id: 901, login: "unrelated", avatarUrl: null, role: "member" },
  ];

  await roster.apply(await ctx(), ["roster:add:user=5"]);

  const rows = await db.select().from(classMembers);
  expect(
    rows.map((r) => [r.login, r.state, r.githubId, r.invitationId]).sort(),
  ).toEqual([
    ["newprof", "teacher", "5", null],
    // Untouched — it was never newprof's to resolve.
    ["unrelated", "pending", null, "901"],
  ]);
});

test("apply: accepting an UNATTRIBUTABLE invitation resolves it by login", async () => {
  // The other half of the same rule: this invitation also has no user id, but
  // it IS the accepting person's. Login is the only correlation available, and
  // without it they would keep a ghost "invited" row forever.
  await cache([
    { invitationId: "900", login: "newprof", state: "pending_teacher" },
  ]);
  state.people.teachers = [{ id: 5, login: "newprof", avatarUrl: null }];

  await roster.apply(await ctx(), ["roster:add:user=5"]);

  const rows = await db.select().from(classMembers);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    login: "newprof",
    state: "teacher",
    githubId: "5",
    invitationId: null,
  });
});

test("audit writes nothing", async () => {
  state.people = {
    teachers: [],
    students: [{ id: 2, login: "student", avatarUrl: null }],
    pending: [],
  };
  await cache([{ githubId: "9", login: "gone", state: "active" }]);

  await roster.audit(await ctx());
  expect(await cachedIds()).toEqual(["9"]);
});

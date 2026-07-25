import { env } from "cloudflare:test";
import { account, classes, classMembers, getDb, user } from "@roster/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  githubToken: "tok" as string | null,
  membership: { state: "active", role: "member" } as {
    state: "active" | "pending";
    role: string;
  } | null,
  org: { login: "acme", name: "Acme", avatarUrl: "http://a" },
  profile: { login: "alice", id: 7, name: "Alice", avatarUrl: "http://p" } as {
    login: string;
    id: number;
    name: string | null;
    avatarUrl: string;
  } | null,
  orgLoginFails: false,
  /** Simulates a GitHub outage on the profile fetch (throws unavailable). */
  githubDown: false,
  inviteCalls: [] as unknown[],
}));

vi.mock("../src/lib/auth/config", () => ({
  createAuth: () => ({
    api: { getSession: async () => state.session },
  }),
}));

vi.mock("../src/lib/auth/github-token", () => ({
  githubAccessToken: async () => state.githubToken,
}));

vi.mock("../src/lib/github/user", async (importOriginal) => {
  // Spread the real module: `GithubUnavailableError` must be the REAL class,
  // or the on-error translator's instanceof check can't recognize the throw.
  const actual =
    await importOriginal<typeof import("../src/lib/github/user")>();
  return {
    ...actual,
    fetchGithubProfile: async () => {
      if (state.githubDown) {
        throw new actual.GithubUnavailableError("simulated outage");
      }
      return state.profile;
    },
  };
});

vi.mock("../src/lib/github/app", () => ({
  orgLogin: async () => {
    if (state.orgLoginFails) throw new Error("dead installation");
    return "acme";
  },
}));

vi.mock("../src/lib/github/org", () => ({
  orgInfo: async () => state.org,
  orgMembership: async () => state.membership,
  inviteOrgMember: async (...args: unknown[]) => {
    state.inviteCalls.push(args);
    return "pending" as const;
  },
}));

const { joinRoutes } = await import("../src/routes/join");
const { apiOnError } = await import("../src/on-error");

const app = new Hono<import("../src/lib/auth/config").Env>()
  .route("/api", joinRoutes)
  .onError(apiOnError);
const db = getDb(env.DB);

beforeEach(async () => {
  state.session = { user: { id: "u1" } };
  state.githubToken = "tok";
  state.membership = { state: "active", role: "member" };
  state.profile = {
    login: "alice",
    id: 7,
    name: "Alice",
    avatarUrl: "http://p",
  };
  state.orgLoginFails = false;
  state.githubDown = false;
  state.inviteCalls = [];

  const now = new Date(0);
  await db.delete(classMembers);
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
    joinToken: "tok123",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
});

test("GET: a GitHub outage is a 503, never 'invalid link'", async () => {
  // The link is VALID and the student's link is healthy — GitHub just can't
  // answer. Blaming the link would send them to their teacher for nothing.
  state.githubDown = true;
  const res = await app.request("/api/join/tok123", {}, env);
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "github_unavailable" });
});

test("GET: unknown token → 404 invalid_link", async () => {
  const res = await app.request("/api/join/nope", {}, env);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "invalid_link" });
});

test("GET: requires auth", async () => {
  state.session = null;
  const res = await app.request("/api/join/tok123", {}, env);
  expect(res.status).toBe(401);
});

test("GET: unusable GitHub link → 403 github_not_linked", async () => {
  state.profile = null;
  const res = await app.request("/api/join/tok123", {}, env);
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "github_not_linked" });
});

test("GET: no usable GitHub token → 403 github_not_linked", async () => {
  state.githubToken = null;
  const res = await app.request("/api/join/tok123", {}, env);
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "github_not_linked" });
});

test("GET: a valid token whose class is unreachable needs a reconcile, not a new link", async () => {
  // The token resolved to a class, so it is already proven valid — a healthy
  // class returns its name and avatar to anyone holding it. Saying "invalid
  // link" would blame the student for a link that is perfect, and hide the one
  // thing that fixes it. An UNKNOWN token still reads as 404 invalid_link.
  state.orgLoginFails = true;
  const res = await app.request("/api/join/tok123", {}, env);
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "class_needs_reconcile" });
});

test("GET: an unknown token still reveals nothing", async () => {
  const res = await app.request("/api/join/not-a-real-token", {}, env);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "invalid_link" });
});

test("GET: returns class identity + membership state", async () => {
  state.membership = null;
  const res = await app.request("/api/join/tok123", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    class: { login: "acme", name: "Acme", avatarUrl: "http://a" },
    membership: "none",
    role: null,
  });
});

test("GET: pending invite is reported", async () => {
  state.membership = { state: "pending", role: "member" };
  const res = await app.request("/api/join/tok123", {}, env);
  expect(await res.json()).toEqual({
    class: { login: "acme", name: "Acme", avatarUrl: "http://a" },
    membership: "pending",
    role: "member",
  });
});

test("GET: an org owner opening their own link sees their admin role", async () => {
  state.membership = { state: "active", role: "admin" };
  const res = await app.request("/api/join/tok123", {}, env);
  expect(await res.json()).toEqual({
    class: { login: "acme", name: "Acme", avatarUrl: "http://a" },
    membership: "active",
    role: "admin",
  });
});

test("POST: none → invites as member, returns pending", async () => {
  state.membership = null;
  const res = await app.request("/api/join/tok123", { method: "POST" }, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ membership: "pending", role: "member" });
  expect(state.inviteCalls).toHaveLength(1);
});

test("POST: already active → short-circuits, no PUT", async () => {
  state.membership = { state: "active", role: "member" };
  const res = await app.request("/api/join/tok123", { method: "POST" }, env);
  expect(await res.json()).toEqual({ membership: "active", role: "member" });
  expect(state.inviteCalls).toHaveLength(0);
});

test("POST: org admin is never demoted — no PUT even while pending", async () => {
  state.membership = { state: "pending", role: "admin" };
  const res = await app.request("/api/join/tok123", { method: "POST" }, env);
  expect(await res.json()).toEqual({ membership: "pending", role: "admin" });
  expect(state.inviteCalls).toHaveLength(0);
});

test("POST: pending member → no duplicate PUT, still pending", async () => {
  state.membership = { state: "pending", role: "member" };
  const res = await app.request("/api/join/tok123", { method: "POST" }, env);
  expect(await res.json()).toEqual({ membership: "pending", role: "member" });
  expect(state.inviteCalls).toHaveLength(0);
});

test("POST: unknown token → 404 invalid_link", async () => {
  const res = await app.request("/api/join/nope", { method: "POST" }, env);
  expect(res.status).toBe(404);
});

// --- class_members enrollment display cache (write points) ---

test("POST: a fresh invite records a pending enrollment", async () => {
  state.membership = null;
  await app.request("/api/join/tok123", { method: "POST" }, env);
  const rows = await db.select().from(classMembers);
  expect(rows).toMatchObject([
    { classId: "c1", githubId: "7", state: "pending" },
  ]);
});

test("GET: the preview writes nothing", async () => {
  // A GET returns what it sees. Recording the acceptance is POST /confirm's job,
  // and the org identity cache belongs to the `identity` reconciler.
  state.membership = { state: "active", role: "member" };

  await app.request("/api/join/tok123", {}, env);

  expect(await db.select().from(classMembers)).toEqual([]);
  const [cls] = await db.select().from(classes).where(eq(classes.id, "c1"));
  expect(cls).toMatchObject({ login: null, name: null });
});

test("POST /confirm: records an active membership", async () => {
  state.membership = { state: "active", role: "member" };

  const res = await app.request(
    "/api/join/tok123/confirm",
    { method: "POST" },
    env,
  );

  expect(res.status).toBe(200);
  expect(await db.select().from(classMembers)).toMatchObject([
    { classId: "c1", githubId: "7", state: "active" },
  ]);
});

test("POST /confirm: observed non-membership drops the stale row (lazy repair)", async () => {
  const now = new Date(0);
  await db.insert(classMembers).values({
    id: "m1",
    classId: "c1",
    githubId: "7",
    state: "active",
    createdAt: now,
    updatedAt: now,
  });
  state.membership = null;

  await app.request("/api/join/tok123/confirm", { method: "POST" }, env);

  expect(await db.select().from(classMembers)).toEqual([]);
});

test("POST /confirm: an org owner is cached as a TEACHER, never as an enrollee", async () => {
  state.membership = { state: "active", role: "admin" };

  await app.request("/api/join/tok123/confirm", { method: "POST" }, env);

  expect(await db.select().from(classMembers)).toMatchObject([
    { classId: "c1", githubId: "7", state: "teacher", login: "alice" },
  ]);
});

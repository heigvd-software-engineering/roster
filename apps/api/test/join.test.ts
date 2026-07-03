import { env } from "cloudflare:test";
import { account, classes, getDb, user } from "@labs/db";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
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
  inviteCalls: [] as unknown[],
}));

vi.mock("../src/auth/config", () => ({
  createAuth: () => ({
    api: { getSession: async () => state.session },
  }),
}));

vi.mock("../src/github/user", () => ({
  fetchGithubProfile: async () => state.profile,
}));

vi.mock("../src/github/app", () => ({
  orgLogin: async () => {
    if (state.orgLoginFails) throw new Error("dead installation");
    return "acme";
  },
}));

vi.mock("../src/github/org", () => ({
  orgInfo: async () => state.org,
  orgMembership: async () => state.membership,
  inviteOrgMember: async (...args: unknown[]) => {
    state.inviteCalls.push(args);
    return "pending" as const;
  },
}));

const { joinRoutes } = await import("../src/routes/join");

const app = new Hono().route("/api", joinRoutes);
const db = getDb(env.DB);

beforeEach(async () => {
  state.session = { user: { id: "u1" } };
  state.membership = { state: "active", role: "member" };
  state.profile = {
    login: "alice",
    id: 7,
    name: "Alice",
    avatarUrl: "http://p",
  };
  state.orgLoginFails = false;
  state.inviteCalls = [];

  const now = new Date(0);
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

test("GET: dead installation reads as invalid_link", async () => {
  state.orgLoginFails = true;
  const res = await app.request("/api/join/tok123", {}, env);
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
  });
});

test("GET: pending invite is reported", async () => {
  state.membership = { state: "pending", role: "member" };
  const res = await app.request("/api/join/tok123", {}, env);
  expect(await res.json()).toEqual({
    class: { login: "acme", name: "Acme", avatarUrl: "http://a" },
    membership: "pending",
  });
});

test("POST: none → invites as member, returns pending", async () => {
  state.membership = null;
  const res = await app.request("/api/join/tok123", { method: "POST" }, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ membership: "pending" });
  expect(state.inviteCalls).toHaveLength(1);
});

test("POST: already active → short-circuits, no PUT", async () => {
  state.membership = { state: "active", role: "member" };
  const res = await app.request("/api/join/tok123", { method: "POST" }, env);
  expect(await res.json()).toEqual({ membership: "active" });
  expect(state.inviteCalls).toHaveLength(0);
});

test("POST: org admin is never demoted — no PUT even while pending", async () => {
  state.membership = { state: "pending", role: "admin" };
  const res = await app.request("/api/join/tok123", { method: "POST" }, env);
  expect(await res.json()).toEqual({ membership: "pending" });
  expect(state.inviteCalls).toHaveLength(0);
});

test("POST: pending member → no duplicate PUT, still pending", async () => {
  state.membership = { state: "pending", role: "member" };
  const res = await app.request("/api/join/tok123", { method: "POST" }, env);
  expect(await res.json()).toEqual({ membership: "pending" });
  expect(state.inviteCalls).toHaveLength(0);
});

test("POST: unknown token → 404 invalid_link", async () => {
  const res = await app.request("/api/join/nope", { method: "POST" }, env);
  expect(res.status).toBe(404);
});

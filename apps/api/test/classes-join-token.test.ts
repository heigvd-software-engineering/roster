import { env } from "cloudflare:test";
import { account, classes, getDb, user } from "@roster/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

// POST /classes/:id/join-token retires the class's invitation link. The token
// IS the enrollment gate (handlers/join.ts), so a leaked link is standing
// permission to be invited into the org — and until this endpoint existed
// there was no way to take that back.

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  isAdmin: true,
}));

vi.mock("../src/lib/auth/config", () => ({
  createAuth: () => ({ api: { getSession: async () => state.session } }),
}));

vi.mock("../src/lib/github/app", () => ({ orgLogin: async () => "acme" }));

vi.mock("../src/lib/github/org", () => ({
  isOrgAdmin: async () => state.isAdmin,
}));

const { classesRoutes } = await import("../src/routes/classes");

const app = new Hono().route("/api", classesRoutes);
const db = getDb(env.DB);
const now = new Date(0);
const ORIGINAL = "tok123tok123tok123tok123tok12345";

const rotate = (classId = "c1") =>
  app.request(`/api/classes/${classId}/join-token`, { method: "POST" }, env);

const tokenOf = async (id: string) =>
  (await db.select().from(classes).where(eq(classes.id, id)))[0]?.joinToken;

beforeEach(async () => {
  state.session = { user: { id: "u1" } };
  state.isAdmin = true;

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
    joinToken: ORIGINAL,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
});

test("a teacher gets a new token, and the old one is gone", async () => {
  const res = await rotate();

  expect(res.status).toBe(200);
  const { joinToken } = (await res.json()) as { joinToken: string };
  expect(joinToken).not.toBe(ORIGINAL);
  // 128 bits of Web Crypto randomness as hex (lib/join-token.ts).
  expect(joinToken).toMatch(/^[0-9a-f]{32}$/);
  expect(await tokenOf("c1")).toBe(joinToken);
});

test("rotating twice yields a third token — never a fixed replacement", async () => {
  const first = (await (await rotate()).json()) as { joinToken: string };
  const second = (await (await rotate()).json()) as { joinToken: string };
  expect(second.joinToken).not.toBe(first.joinToken);
});

test("a non-teacher changes nothing and is told the class doesn't exist", async () => {
  state.isAdmin = false;

  const res = await rotate();

  expect(res.status).toBe(404);
  expect(await tokenOf("c1")).toBe(ORIGINAL);
});

test("an unknown class is the same 404 — no class is confirmed to exist", async () => {
  const res = await rotate("nope");
  expect(res.status).toBe(404);
});

test("no session is a 401 before any of this", async () => {
  state.session = null;

  const res = await rotate();

  expect(res.status).toBe(401);
  expect(await tokenOf("c1")).toBe(ORIGINAL);
});

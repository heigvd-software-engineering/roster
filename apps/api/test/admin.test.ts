import { env } from "cloudflare:test";
import { classCreators, getDb, user } from "@roster/db";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

/**
 * /api/admin — the super-admin zone. The guard is CONFIG-based
 * (SUPER_ADMIN_EMAILS matched against the session email); the grant it
 * manages is the `class_creators` row, the ONE condition class creation
 * checks — identical for admins and everyone else.
 */

const state = vi.hoisted(() => ({
  session: { user: { id: "admin", email: "admin@x.ch" } } as {
    user: { id: string; email: string };
  } | null,
}));

vi.mock("../src/lib/auth/config", () => ({
  createAuth: () => ({
    api: { getSession: async () => state.session },
  }),
}));

const { adminRoutes } = await import("../src/routes/admin");

const app = new Hono().route("/api", adminRoutes);
const db = getDb(env.DB);
const asAdmin = { ...env, SUPER_ADMIN_EMAILS: "admin@x.ch" };

beforeEach(async () => {
  state.session = { user: { id: "admin", email: "admin@x.ch" } };
  await db.delete(classCreators);
  await db.delete(user);
  await db.insert(user).values([
    { id: "admin", name: "Ada Admin", email: "admin@x.ch" },
    { id: "u2", name: "Bob", email: "bob@x.ch" },
  ]);
});

// ── The guard ────────────────────────────────────────────────────────────

test("no session is 401", async () => {
  state.session = null;
  const res = await app.request("/api/admin/users", {}, asAdmin);
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
});

test("a session whose email is not configured is 403", async () => {
  state.session = { user: { id: "u2", email: "bob@x.ch" } };
  const res = await app.request("/api/admin/users", {}, asAdmin);
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "forbidden" });
});

test("empty/unset SUPER_ADMIN_EMAILS is 403 for everyone — fail closed", async () => {
  const res = await app.request("/api/admin/users", {}, env);
  expect(res.status).toBe(403);
});

test("the email match is case-insensitive and whitespace-tolerant", async () => {
  const res = await app.request(
    "/api/admin/users",
    {},
    { ...env, SUPER_ADMIN_EMAILS: " other@y.ch , ADMIN@X.CH " },
  );
  expect(res.status).toBe(200);
});

// ── The list ─────────────────────────────────────────────────────────────

test("lists every user with grant state and config-admin state", async () => {
  await db
    .insert(classCreators)
    .values({ userId: "u2", createdAt: new Date(0) });
  const res = await app.request("/api/admin/users", {}, asAdmin);
  expect(res.status).toBe(200);
  const { users } = (await res.json()) as {
    users: {
      id: string;
      email: string;
      isSuperAdmin: boolean;
      canCreateClasses: boolean;
    }[];
  };
  expect(users).toHaveLength(2);
  const admin = users.find((u) => u.id === "admin");
  const bob = users.find((u) => u.id === "u2");
  // The admin holds no grant row — the toggle is off even for them.
  expect(admin).toMatchObject({ isSuperAdmin: true, canCreateClasses: false });
  expect(bob).toMatchObject({ isSuperAdmin: false, canCreateClasses: true });
});

// ── The toggle ───────────────────────────────────────────────────────────

const put = (id: string, enabled: boolean) =>
  app.request(
    `/api/admin/users/${id}/class-creator`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
    asAdmin,
  );

test("granting is idempotent — one row no matter how often", async () => {
  expect((await put("u2", true)).status).toBe(200);
  expect((await put("u2", true)).status).toBe(200);
  const rows = await db.select().from(classCreators);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.userId).toBe("u2");
});

test("revoking is idempotent — absent stays absent", async () => {
  await put("u2", true);
  expect((await put("u2", false)).status).toBe(200);
  expect((await put("u2", false)).status).toBe(200);
  expect(await db.select().from(classCreators)).toHaveLength(0);
});

test("an admin can grant THEMSELVES — the toggle is the one condition", async () => {
  expect((await put("admin", true)).status).toBe(200);
  const rows = await db.select().from(classCreators);
  expect(rows[0]?.userId).toBe("admin");
});

test("an unknown user id is 404 and writes nothing", async () => {
  const res = await put("ghost", true);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
  expect(await db.select().from(classCreators)).toHaveLength(0);
});

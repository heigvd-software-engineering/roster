import { env } from "cloudflare:test";
import { account, classes, getDb, labs, user } from "@labs/db";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  admins: [{ id: 111 }] as Array<{ id: number }>,
}));

vi.mock("../src/auth/config", () => ({
  createAuth: () => ({
    api: { getSession: async () => state.session },
  }),
}));

vi.mock("../src/github/app", () => ({
  orgLogin: async () => "acme",
}));

vi.mock("../src/github/org", () => ({
  isOrgAdmin: async (
    _env: unknown,
    _installationId: number,
    _org: string,
    githubUserId: number,
  ) => state.admins.some((a) => a.id === githubUserId),
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

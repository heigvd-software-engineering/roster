import { env } from "cloudflare:test";
import { account, classCreators, classes, getDb, user } from "@roster/db";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  githubToken: "tok" as string | null,
  account: { id: 42, login: "acme", type: "Organization" } as {
    id: number;
    login: string;
    type: string;
  },
  installations: [{ id: 100 }] as Array<{ id: number }>,
  org: { login: "acme", name: "Acme", avatarUrl: "http://a" },
}));

vi.mock("../src/lib/auth/config", () => ({
  createAuth: () => ({
    api: { getSession: async () => state.session },
  }),
}));

vi.mock("../src/lib/auth/github-token", () => ({
  githubAccessToken: async () => state.githubToken,
}));

vi.mock("../src/lib/github/app", () => ({
  installationAccount: async () => ({
    id: state.account.id,
    login: state.account.login,
    isOrganization: state.account.type === "Organization",
  }),
}));

vi.mock("../src/lib/github/user", () => ({
  userHasInstallation: async (_token: string, installationId: number) =>
    state.installations.some((i) => i.id === installationId),
}));

// The callback seeds the org identity cache: nothing else writes login/name/
// avatarUrl now that the hub is a pure read.
vi.mock("../src/lib/github/org", () => ({
  orgInfo: async () => state.org,
}));

const { setupRoutes } = await import("../src/routes/setup");

const app = new Hono().route("/api", setupRoutes);
const db = getDb(env.DB);

beforeEach(async () => {
  state.session = { user: { id: "u1" } };
  state.githubToken = "tok";
  state.account = { id: 42, login: "acme", type: "Organization" };
  state.installations = [{ id: 100 }];
  await db.delete(classes);
  await db.delete(classCreators);
  await db.delete(account);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "U1", email: "u1@x.ch" });
  // Class creation is a granted capability. The happy paths assume the caller
  // holds it; the not_class_creator tests below delete it.
  await db
    .insert(classCreators)
    .values({ userId: "u1", createdAt: new Date(0) });
  await db.insert(account).values({
    id: "a1",
    userId: "u1",
    issuer: "local:oauth:github",
    providerId: "github",
    accountId: "111",
    accessToken: "tok",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
});

test("with a session, inserts the class (with a join token) and redirects to confirm", async () => {
  const res = await app.request(
    "/api/github/setup?installation_id=100",
    undefined,
    env,
  );
  expect(res.status).toBe(302);

  const [row] = await db.select().from(classes);
  expect(row).toMatchObject({
    orgId: 42,
    installationId: 100,
    connectedByUserId: "u1",
    status: "active",
  });
  expect(row?.joinToken).toMatch(/^[0-9a-f]{32}$/);
  expect(res.headers.get("location")).toBe(`/classes/${row?.id}/confirm`);
});

test("reinstall updates installationId but keeps id, joinToken, provenance", async () => {
  await app.request("/api/github/setup?installation_id=100", undefined, env);
  const [first] = await db.select().from(classes);

  state.installations = [{ id: 200 }];
  const res = await app.request(
    "/api/github/setup?installation_id=200",
    undefined,
    env,
  );
  expect(res.status).toBe(302);

  const rows = await db.select().from(classes);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: first?.id,
    installationId: 200,
    // The cohort's link must survive a reinstall.
    joinToken: first?.joinToken,
    connectedByUserId: "u1",
  });
});

test("without a session, redirects home and writes nothing", async () => {
  state.session = null;
  const res = await app.request(
    "/api/github/setup?installation_id=100",
    undefined,
    env,
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/");
  expect(await db.select().from(classes)).toHaveLength(0);
});

test("non-organization account redirects with an error and writes nothing", async () => {
  state.account = { id: 42, login: "acme", type: "User" };
  const res = await app.request(
    "/api/github/setup?installation_id=100",
    undefined,
    env,
  );
  expect(res.headers.get("location")).toBe("/?error=not_an_org");
  expect(await db.select().from(classes)).toHaveLength(0);
});

test("no usable GitHub token redirects with an error and writes nothing", async () => {
  state.githubToken = null;
  const res = await app.request(
    "/api/github/setup?installation_id=100",
    undefined,
    env,
  );
  expect(res.headers.get("location")).toBe("/?error=github_not_linked");
  expect(await db.select().from(classes)).toHaveLength(0);
});

test("installation not owned by the caller redirects with an error and writes nothing", async () => {
  state.installations = [{ id: 999 }];
  const res = await app.request(
    "/api/github/setup?installation_id=100",
    undefined,
    env,
  );
  expect(res.headers.get("location")).toBe("/?error=not_your_installation");
  expect(await db.select().from(classes)).toHaveLength(0);
});

test("without the class-creator grant, refuses and writes nothing", async () => {
  await db.delete(classCreators);
  const res = await app.request(
    "/api/github/setup?installation_id=100",
    undefined,
    env,
  );
  expect(res.headers.get("location")).toBe("/?error=not_class_creator");
  expect(await db.select().from(classes)).toHaveLength(0);
});

test("repair of an EXISTING class needs no grant — revocation is never retroactive", async () => {
  await app.request("/api/github/setup?installation_id=100", undefined, env);
  const [first] = await db.select().from(classes);

  await db.delete(classCreators);
  state.installations = [{ id: 200 }];
  const res = await app.request(
    "/api/github/setup?installation_id=200",
    undefined,
    env,
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(`/classes/${first?.id}/confirm`);

  const rows = await db.select().from(classes);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: first?.id, installationId: 200 });
});

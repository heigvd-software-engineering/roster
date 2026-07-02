import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  account: { id: 42, login: "acme", type: "Organization" } as {
    id: number;
    login: string;
    type: string;
  },
  upsertClassByOrgId: vi.fn(async (_db: unknown, _args: unknown) => ({
    id: "c1",
  })),
}));

vi.mock("../src/auth", () => ({
  createAuth: () => ({
    api: { getSession: async () => state.session },
  }),
}));

vi.mock("../src/github", () => ({
  appJwtOctokit: () => ({
    request: async () => ({ data: { account: state.account } }),
  }),
}));

vi.mock("@labs/db", () => ({
  getDb: () => ({}),
  upsertClassByOrgId: (db: unknown, args: unknown) =>
    state.upsertClassByOrgId(db, args),
}));

const { setupRoutes } = await import("../src/routes/setup");

const app = new Hono().route("/api", setupRoutes);
const env = { DB: {} };

beforeEach(() => {
  state.session = { user: { id: "u1" } };
  state.account = { id: 42, login: "acme", type: "Organization" };
  state.upsertClassByOrgId.mockClear();
});

test("with a session, redirects to the confirm page and upserts the class", async () => {
  const res = await app.request(
    "/api/github/setup?installation_id=100",
    undefined,
    env,
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/classes/c1/confirm");
  expect(state.upsertClassByOrgId).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      orgId: 42,
      installationId: 100,
      connectedByUserId: "u1",
    }),
  );
});

test("without a session, redirects home", async () => {
  state.session = null;
  const res = await app.request(
    "/api/github/setup?installation_id=100",
    undefined,
    env,
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/");
  expect(state.upsertClassByOrgId).not.toHaveBeenCalled();
});

test("non-organization account redirects with an error and does not upsert", async () => {
  state.account = { id: 42, login: "acme", type: "User" };
  const res = await app.request(
    "/api/github/setup?installation_id=100",
    undefined,
    env,
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/?error=not_an_org");
  expect(state.upsertClassByOrgId).not.toHaveBeenCalled();
});

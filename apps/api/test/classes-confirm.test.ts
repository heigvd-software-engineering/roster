import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  cls: {
    id: "c1",
    orgId: 42,
    installationId: 100,
    connectedByUserId: "u1",
  } as
    | {
        id: string;
        orgId: number;
        installationId: number;
        connectedByUserId: string;
      }
    | undefined,
  defaultRepositoryPermission: "none" as string,
  patchCalls: [] as unknown[],
}));

vi.mock("../src/auth/config", () => ({
  createAuth: () => ({
    api: { getSession: async () => state.session },
  }),
}));

vi.mock("../src/github/clients", () => ({
  appJwtOctokit: () => ({
    request: async (route: string) => {
      if (route === "GET /app/installations/{installation_id}") {
        return { data: { account: { login: "acme" } } };
      }
      throw new Error(`unexpected app-jwt request ${route}`);
    },
  }),
  installationOctokit: async () => ({
    request: async (route: string, params: unknown) => {
      if (route === "PATCH /orgs/{org}") {
        state.patchCalls.push(params);
        return { data: {} };
      }
      if (route === "GET /orgs/{org}") {
        return {
          data: {
            default_repository_permission: state.defaultRepositoryPermission,
          },
        };
      }
      throw new Error(`unexpected installation request ${route}`);
    },
  }),
}));

vi.mock("@labs/db", () => ({
  getDb: () => ({}),
  getClassById: async (_db: unknown, _id: string) => state.cls,
}));

vi.mock("../src/github/teacher", () => ({
  callerGithubId: vi.fn(async () => 111),
  isOrgAdmin: vi.fn(async () => true),
}));

const { classesRoutes } = await import("../src/routes/classes");
const { callerGithubId, isOrgAdmin } = await import("../src/github/teacher");

const app = new Hono().route("/api", classesRoutes);
const env = { DB: {} };

beforeEach(() => {
  state.session = { user: { id: "u1" } };
  state.cls = {
    id: "c1",
    orgId: 42,
    installationId: 100,
    connectedByUserId: "u1",
  };
  state.defaultRepositoryPermission = "none";
  state.patchCalls = [];
});

test("sets the org base permission to none and returns ok:true", async () => {
  const res = await app.request(
    "/api/classes/c1/confirm",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, org: { login: "acme" } });
  expect(state.patchCalls).toEqual([
    { org: "acme", default_repository_permission: "none" },
  ]);
});

test("returns ok:false when the re-GET doesn't confirm none", async () => {
  state.defaultRepositoryPermission = "read";
  const res = await app.request(
    "/api/classes/c1/confirm",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: false, org: { login: "acme" } });
});

test("unknown class id returns 404", async () => {
  state.cls = undefined;
  const res = await app.request(
    "/api/classes/c1/confirm",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(404);
});

test("confirms for a co-owner (admin) even if they didn't connect it", async () => {
  state.cls = {
    id: "c1",
    orgId: 42,
    installationId: 100,
    connectedByUserId: "someone-else",
  };
  // default mocks: callerGithubId 111, isOrgAdmin true → 200 path
  const res = await app.request(
    "/api/classes/c1/confirm",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, org: { login: "acme" } });
  expect(state.patchCalls).toEqual([
    { org: "acme", default_repository_permission: "none" },
  ]);
});

test("returns 404 and makes no org writes for a non-admin", async () => {
  vi.mocked(isOrgAdmin).mockResolvedValueOnce(false);
  const res = await app.request(
    "/api/classes/c1/confirm",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
  expect(state.patchCalls).toEqual([]);
});

test("returns 404 when the caller has no linked GitHub id", async () => {
  vi.mocked(callerGithubId).mockResolvedValueOnce(null);
  const res = await app.request(
    "/api/classes/c1/confirm",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
  expect(state.patchCalls).toEqual([]);
});

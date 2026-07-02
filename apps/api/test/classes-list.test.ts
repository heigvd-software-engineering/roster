import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  rows: [{ id: "c1", orgId: 42, installationId: 100 }] as Array<{
    id: string;
    orgId: number;
    installationId: number;
  }>,
  refreshCalls: [] as unknown[],
  installations: [{ id: 200, account: { id: 42, login: "acme" } }] as Array<{
    id: number;
    account: { id: number; login: string };
  }>,
  org: { login: "acme", name: "Acme", avatar_url: "http://a" },
}));

vi.mock("../src/auth", () => ({
  createAuth: () => ({
    api: { getSession: async () => state.session },
  }),
}));

vi.mock("../src/github", () => ({
  appJwtOctokit: () => ({
    request: async (route: string) => {
      throw new Error(`unexpected app-jwt request ${route}`);
    },
  }),
  installationOctokit: async () => ({
    request: async (route: string, _params: unknown) => {
      if (route === "GET /orgs/{org}") {
        return { data: state.org };
      }
      throw new Error(`unexpected installation request ${route}`);
    },
  }),
}));

vi.mock("../src/github-user", () => ({
  githubUserToken: async () => "tok",
}));

const octokitRequestMock = vi.hoisted(() =>
  vi.fn(async (route: string) => {
    if (route === "GET /user/installations") {
      return { data: { installations: state.installations } };
    }
    throw new Error(`unexpected user-octokit request ${route}`);
  }),
);

vi.mock("octokit", () => ({
  Octokit: vi.fn().mockImplementation(function Octokit() {
    return { request: octokitRequestMock };
  }),
}));

vi.mock("@labs/db", () => ({
  getDb: () => ({}),
  listClassesByUser: async (_db: unknown, _userId: string) => state.rows,
  refreshInstallationId: async (
    _db: unknown,
    orgId: number,
    installationId: number,
    now: Date,
  ) => {
    state.refreshCalls.push({ orgId, installationId, now });
  },
}));

const { classesRoutes } = await import("../src/routes/classes");

const app = new Hono().route("/api", classesRoutes);
const env = { DB: {} };

beforeEach(() => {
  state.session = { user: { id: "u1" } };
  state.rows = [{ id: "c1", orgId: 42, installationId: 100 }];
  state.refreshCalls = [];
  state.installations = [{ id: 200, account: { id: 42, login: "acme" } }];
  state.org = { login: "acme", name: "Acme", avatar_url: "http://a" };
  octokitRequestMock.mockClear();
});

test("lists classes, reconciles stale installationId, enriches with live org", async () => {
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({
    classes: [
      {
        id: "c1",
        orgId: 42,
        login: "acme",
        name: "Acme",
        avatarUrl: "http://a",
      },
    ],
  });
  expect(state.refreshCalls).toHaveLength(1);
  const call = state.refreshCalls[0] as {
    orgId: number;
    installationId: number;
  };
  expect(call.orgId).toBe(42);
  expect(call.installationId).toBe(200);
});

test("skips classes whose org is no longer in the user's installations", async () => {
  state.installations = [];
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ classes: [] });
  expect(state.refreshCalls).toHaveLength(0);
});

test("does not refresh when installationId is unchanged", async () => {
  state.installations = [{ id: 100, account: { id: 42, login: "acme" } }];
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  expect(state.refreshCalls).toHaveLength(0);
});

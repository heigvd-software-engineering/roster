import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  rows: [
    {
      id: "c1",
      orgId: 42,
      installationId: 100,
      connectedByUserId: "u1",
      joinToken: "tokC1",
    },
  ] as Array<{
    id: string;
    orgId: number;
    installationId: number;
    connectedByUserId: string;
    joinToken: string;
  }>,
  refreshCalls: [] as unknown[],
  installations: [{ id: 200, account: { id: 42, login: "acme" } }] as Array<{
    id: number;
    account: { id: number; login: string };
  }>,
  org: { login: "acme", name: "Acme", avatar_url: "http://a" },
  failInstallationIds: [] as number[],
}));

vi.mock("../src/auth/config", () => ({
  createAuth: () => ({
    api: { getSession: async () => state.session },
  }),
}));

vi.mock("../src/github/clients", () => ({
  appJwtOctokit: () => ({
    request: async (route: string) => {
      throw new Error(`unexpected app-jwt request ${route}`);
    },
  }),
  installationOctokit: async (_env: unknown, installationId: number) => ({
    request: async (route: string, _params: unknown) => {
      if (route === "GET /orgs/{org}") {
        if (state.failInstallationIds.includes(installationId)) {
          throw new Error("simulated GitHub failure");
        }
        return { data: state.org };
      }
      throw new Error(`unexpected installation request ${route}`);
    },
  }),
}));

vi.mock("../src/github/user-token", () => ({
  githubUserToken: async () => "tok",
}));

vi.mock("../src/github/teacher", () => ({
  callerGithubId: vi.fn(async () => 111),
  isOrgAdmin: vi.fn(async () => true),
}));

const userInstallationsByOrgIdMock = vi.hoisted(() =>
  vi.fn(async (_token: string) => {
    const byOrgId = new Map<
      number,
      { installationId: number; login: string }
    >();
    for (const inst of state.installations) {
      if (inst.account) {
        byOrgId.set(inst.account.id, {
          installationId: inst.id,
          login: inst.account.login,
        });
      }
    }
    return byOrgId;
  }),
);

vi.mock("../src/github/user-installations", () => ({
  userInstallationsByOrgId: userInstallationsByOrgIdMock,
}));

vi.mock("@labs/db", () => ({
  getDb: () => ({}),
  listClassesByOrgIds: async (_db: unknown, _orgIds: number[]) => state.rows,
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
const { callerGithubId, isOrgAdmin } = await import("../src/github/teacher");

const app = new Hono().route("/api", classesRoutes);
const env = { DB: {} };

beforeEach(() => {
  state.session = { user: { id: "u1" } };
  state.rows = [
    {
      id: "c1",
      orgId: 42,
      installationId: 100,
      connectedByUserId: "u1",
      joinToken: "tokC1",
    },
  ];
  state.refreshCalls = [];
  state.installations = [{ id: 200, account: { id: 42, login: "acme" } }];
  state.org = { login: "acme", name: "Acme", avatar_url: "http://a" };
  state.failInstallationIds = [];
  userInstallationsByOrgIdMock.mockClear();
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
        joinToken: "tokC1",
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

test("skips a class whose live-enrich call fails, without 500ing the rest", async () => {
  state.rows = [
    {
      id: "c1",
      orgId: 42,
      installationId: 100,
      connectedByUserId: "u1",
      joinToken: "tokC1",
    },
    {
      id: "c2",
      orgId: 43,
      installationId: 101,
      connectedByUserId: "u1",
      joinToken: "tokC2",
    },
  ];
  state.installations = [
    { id: 100, account: { id: 42, login: "acme" } },
    { id: 101, account: { id: 43, login: "beta" } },
  ];
  state.failInstallationIds = [100];
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({
    classes: [
      {
        id: "c2",
        orgId: 43,
        login: "acme",
        name: "Acme",
        avatarUrl: "http://a",
        joinToken: "tokC2",
      },
    ],
  });
});

test("returns a class connected by someone else when the caller is an org admin", async () => {
  state.rows = [
    {
      id: "c1",
      orgId: 42,
      installationId: 100,
      connectedByUserId: "someone-else",
      joinToken: "tokC1",
    },
  ];
  // default mocks: callerGithubId 111, isOrgAdmin true — installations
  // include orgId 42, so the caller sees the class though they never
  // connected it.
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    classes: [
      {
        id: "c1",
        orgId: 42,
        login: "acme",
        name: "Acme",
        avatarUrl: "http://a",
        joinToken: "tokC1",
      },
    ],
  });
});

test("skips a class when the caller has installation access but is NOT an admin (F8 guard)", async () => {
  vi.mocked(isOrgAdmin).mockResolvedValueOnce(false);
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ classes: [] });
});

test("returns [] when the caller has no linked GitHub id", async () => {
  vi.mocked(callerGithubId).mockResolvedValueOnce(null);
  const res = await app.request("/api/classes", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ classes: [] });
  expect(userInstallationsByOrgIdMock).not.toHaveBeenCalled();
});

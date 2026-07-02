import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  account: { id: 42, login: "acme", type: "Organization" } as {
    id: number;
    login: string;
    type: string;
  },
  token: "tok" as string | undefined,
  installations: [{ id: 100 }] as Array<{ id: number }>,
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

vi.mock("../src/github-user", () => ({
  githubUserToken: async () => state.token,
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
  upsertClassByOrgId: (db: unknown, args: unknown) =>
    state.upsertClassByOrgId(db, args),
}));

const { setupRoutes } = await import("../src/routes/setup");

const app = new Hono().route("/api", setupRoutes);
const env = { DB: {} };

beforeEach(() => {
  state.session = { user: { id: "u1" } };
  state.account = { id: 42, login: "acme", type: "Organization" };
  state.token = "tok";
  state.installations = [{ id: 100 }];
  state.upsertClassByOrgId.mockClear();
  octokitRequestMock.mockClear();
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

test("no linked GitHub token redirects with an error and does not upsert", async () => {
  state.token = undefined;
  const res = await app.request(
    "/api/github/setup?installation_id=100",
    undefined,
    env,
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/?error=github_not_linked");
  expect(state.upsertClassByOrgId).not.toHaveBeenCalled();
});

test("installation not owned by the caller redirects with an error and does not upsert", async () => {
  state.installations = [{ id: 999 }];
  const res = await app.request(
    "/api/github/setup?installation_id=100",
    undefined,
    env,
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/?error=not_your_installation");
  expect(state.upsertClassByOrgId).not.toHaveBeenCalled();
});

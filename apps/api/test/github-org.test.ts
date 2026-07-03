import { expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  membership: {
    status: 200 as number,
    data: { state: "active", role: "member" } as {
      state: string;
      role: string;
    },
  },
  putCalls: [] as unknown[],
}));

vi.mock("../src/github/clients", () => ({
  appJwtOctokit: () => ({
    request: async () => ({
      data: { account: { login: "acme" } },
    }),
  }),
  installationOctokit: async () => ({
    request: async (route: string, params: unknown) => {
      if (route === "GET /orgs/{org}/memberships/{username}") {
        if (state.membership.status === 404) {
          throw Object.assign(new Error("Not Found"), { status: 404 });
        }
        if (state.membership.status !== 200) {
          throw Object.assign(new Error("boom"), {
            status: state.membership.status,
          });
        }
        return { data: state.membership.data };
      }
      if (route === "PUT /orgs/{org}/memberships/{username}") {
        state.putCalls.push(params);
        return { data: { state: "pending", role: "member" } };
      }
      throw new Error(`unexpected request ${route}`);
    },
  }),
}));

const { inviteOrgMember, orgLogin, orgMembership } = await import(
  "../src/github/org"
);

const env = {} as Parameters<typeof orgLogin>[0];

test("orgLogin resolves the installation's org login", async () => {
  expect(await orgLogin(env, 1)).toBe("acme");
});

test("orgMembership maps an existing membership", async () => {
  state.membership = {
    status: 200,
    data: { state: "pending", role: "member" },
  };
  expect(await orgMembership(env, 1, "acme", "alice")).toEqual({
    state: "pending",
    role: "member",
  });
});

test("orgMembership returns null on GitHub 404 (not a member)", async () => {
  state.membership = { status: 404, data: { state: "", role: "" } };
  expect(await orgMembership(env, 1, "acme", "alice")).toBeNull();
});

test("orgMembership rethrows non-404 errors", async () => {
  state.membership = { status: 500, data: { state: "", role: "" } };
  await expect(orgMembership(env, 1, "acme", "alice")).rejects.toThrow("boom");
});

test("inviteOrgMember PUTs role member and returns the new state", async () => {
  state.putCalls = [];
  expect(await inviteOrgMember(env, 1, "acme", "alice")).toBe("pending");
  expect(state.putCalls).toEqual([
    { org: "acme", username: "alice", role: "member" },
  ]);
});

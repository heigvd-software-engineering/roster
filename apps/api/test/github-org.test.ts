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
  admins: [] as Array<{ id: number; login: string; avatar_url: string }>,
  members: [] as Array<{ id: number; login: string; avatar_url: string }>,
  invitations: [] as Array<{
    id: number;
    login: string | null;
    email: string | null;
    /** GitHub's own role vocabulary, wider than ours on purpose. */
    role: string;
  }>,
}));

vi.mock("../src/lib/github/clients", () => ({
  appJwtOctokit: () => ({
    request: async () => ({
      data: { account: { id: 42, login: "acme", type: "Organization" } },
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
      if (route === "GET /orgs/{org}/members") {
        return { data: state.admins };
      }
      throw new Error(`unexpected request ${route}`);
    },
    paginate: async (route: string, params: { role?: string }) => {
      if (route === "GET /orgs/{org}/members") {
        return params.role === "admin" ? state.admins : state.members;
      }
      if (route === "GET /orgs/{org}/invitations") {
        return state.invitations;
      }
      throw new Error(`unexpected paginate ${route}`);
    },
  }),
}));

const { installationAccount, orgLogin } = await import("../src/lib/github/app");
const { inviteOrgMember, isOrgAdmin, orgMembership, orgPeople } = await import(
  "../src/lib/github/org"
);

test("installationAccount narrows the installation's org account", async () => {
  expect(await installationAccount({} as never, 1)).toEqual({
    id: 42,
    login: "acme",
    isOrganization: true,
  });
});

test("isOrgAdmin: true iff the github id is in the org's admin list", async () => {
  state.admins = [{ id: 111, login: "prof", avatar_url: "http://p" }];
  expect(await isOrgAdmin({} as never, 1, "acme", 111)).toBe(true);
  expect(await isOrgAdmin({} as never, 1, "acme", 999)).toBe(false);
});

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

test("orgPeople splits admins/members and maps pending invitations", async () => {
  state.admins = [{ id: 1, login: "prof", avatar_url: "http://p" }];
  state.members = [{ id: 2, login: "student", avatar_url: "http://s" }];
  state.invitations = [
    { id: 900, login: "invited-user", email: null, role: "direct_member" },
    { id: 901, login: null, email: "ext@heig-vd.ch", role: "admin" },
  ];
  expect(await orgPeople(env, 1, "acme")).toEqual({
    teachers: [{ id: 1, login: "prof", avatarUrl: "http://p" }],
    students: [{ id: 2, login: "student", avatarUrl: "http://s" }],
    pending: [
      // GitHub's invitation roles are finer than ours: only `admin` becomes a
      // teacher, everything else collapses to an ordinary member.
      { id: 900, login: "invited-user", avatarUrl: null, role: "member" },
      { id: 901, login: "ext@heig-vd.ch", avatarUrl: null, role: "admin" },
    ],
  });
});

test("orgPeople returns empty arrays for an empty org", async () => {
  state.admins = [];
  state.members = [];
  state.invitations = [];
  expect(await orgPeople(env, 1, "acme")).toEqual({
    teachers: [],
    students: [],
    pending: [],
  });
});

import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  requests: [] as Array<{ route: string; params: unknown }>,
  members: [] as Array<{ id: number; login: string; avatar_url: string }>,
  membersStatus: 200 as number,
}));

vi.mock("../src/lib/github/clients", () => ({
  installationOctokit: async () => ({
    request: async (route: string, params: unknown) => {
      state.requests.push({ route, params });
      if (route === "POST /orgs/{org}/teams") {
        const { name } = params as { name: string };
        return {
          data: { id: 77, slug: "alpha-team", name },
        };
      }
      if (
        route === "PUT /orgs/{org}/teams/{team_slug}/memberships/{username}" ||
        route ===
          "DELETE /orgs/{org}/teams/{team_slug}/memberships/{username}" ||
        route === "DELETE /orgs/{org}/teams/{team_slug}"
      ) {
        return { data: {} };
      }
      throw new Error(`unexpected request ${route}`);
    },
    paginate: async (route: string, params: unknown) => {
      state.requests.push({ route, params });
      if (route === "GET /orgs/{org}/teams/{team_slug}/members") {
        if (state.membersStatus !== 200) {
          throw Object.assign(new Error("gone"), {
            status: state.membersStatus,
          });
        }
        return state.members;
      }
      throw new Error(`unexpected paginate ${route}`);
    },
  }),
}));

const { addTeamMember, createTeam, deleteTeam, removeTeamMember, teamMembers } =
  await import("../src/lib/github/team");

const env = {} as Parameters<typeof createTeam>[0];

beforeEach(() => {
  state.requests = [];
  state.members = [];
  state.membersStatus = 200;
});

test("createTeam creates a SECRET team and narrows its identity", async () => {
  const team = await createTeam(env, 1, "acme", "Alpha Team");
  expect(team).toEqual({ id: 77, slug: "alpha-team", name: "Alpha Team" });
  expect(state.requests[0]).toEqual({
    route: "POST /orgs/{org}/teams",
    params: { org: "acme", name: "Alpha Team", privacy: "secret" },
  });
});

test("teamMembers returns the live roster as OrgPerson shapes", async () => {
  state.members = [{ id: 7, login: "alice", avatar_url: "http://a" }];
  expect(await teamMembers(env, 1, "acme", "alpha-team")).toEqual([
    { id: 7, login: "alice", avatarUrl: "http://a" },
  ]);
});

test("teamMembers returns null when the team is gone (orphaned group)", async () => {
  state.membersStatus = 404;
  expect(await teamMembers(env, 1, "acme", "alpha-team")).toBeNull();
});

test("teamMembers propagates non-404 errors", async () => {
  state.membersStatus = 500;
  await expect(teamMembers(env, 1, "acme", "alpha-team")).rejects.toThrow();
});

test("addTeamMember always adds with role member", async () => {
  await addTeamMember(env, 1, "acme", "alpha-team", "alice");
  expect(state.requests[0]).toEqual({
    route: "PUT /orgs/{org}/teams/{team_slug}/memberships/{username}",
    params: {
      org: "acme",
      team_slug: "alpha-team",
      username: "alice",
      role: "member",
    },
  });
});

test("removeTeamMember deletes the membership", async () => {
  await removeTeamMember(env, 1, "acme", "alpha-team", "alice");
  expect(state.requests[0]?.route).toBe(
    "DELETE /orgs/{org}/teams/{team_slug}/memberships/{username}",
  );
});

test("deleteTeam deletes the team", async () => {
  await deleteTeam(env, 1, "acme", "alpha-team");
  expect(state.requests[0]).toEqual({
    route: "DELETE /orgs/{org}/teams/{team_slug}",
    params: { org: "acme", team_slug: "alpha-team" },
  });
});

// Installation-token operations on a class org's teams: a roster group is a
// GitHub Team (F7). One GitHub call plus narrowing per function; no
// orchestration (see README.md). Students are always role `member`, so only
// roster (installation token) and org Owners can manage rosters.
import type { AuthEnv } from "../auth/config";
import { installationOctokit } from "./clients";
import type { OrgPerson } from "./org";

/** Create the group's backing team as `secret`, so non-members can't discover
 *  it or ask to join out of band. Returns GitHub's team identity (GitHub
 *  derives the slug from the name; a duplicate name 422s, which the route
 *  surfaces as "name taken"). */
export async function createTeam(
  env: AuthEnv,
  installationId: number,
  org: string,
  name: string,
): Promise<{ id: number; slug: string; name: string }> {
  const gh = await installationOctokit(env, installationId);
  const { data } = await gh.request("POST /orgs/{org}/teams", {
    org,
    name,
    privacy: "secret",
  });
  return { id: data.id, slug: data.slug, name: data.name };
}

/** The team's live member list, which is the group roster (never stored). Null
 *  when the team is gone on GitHub (404): the group row is orphaned and the
 *  caller reconciles. Other errors propagate. */
export async function teamMembers(
  env: AuthEnv,
  installationId: number,
  org: string,
  teamSlug: string,
): Promise<OrgPerson[] | null> {
  const gh = await installationOctokit(env, installationId);
  try {
    const members = await gh.paginate(
      "GET /orgs/{org}/teams/{team_slug}/members",
      { org, team_slug: teamSlug, per_page: 100 },
    );
    return members.map((m) => ({
      id: m.id,
      login: m.login,
      avatarUrl: m.avatar_url,
    }));
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return null;
    }
    throw err;
  }
}

/** Add a user to the team, always role `member`, never maintainer. */
export async function addTeamMember(
  env: AuthEnv,
  installationId: number,
  org: string,
  teamSlug: string,
  username: string,
): Promise<void> {
  const gh = await installationOctokit(env, installationId);
  await gh.request("PUT /orgs/{org}/teams/{team_slug}/memberships/{username}", {
    org,
    team_slug: teamSlug,
    username,
    role: "member",
  });
}

export async function removeTeamMember(
  env: AuthEnv,
  installationId: number,
  org: string,
  teamSlug: string,
  username: string,
): Promise<void> {
  const gh = await installationOctokit(env, installationId);
  await gh.request(
    "DELETE /orgs/{org}/teams/{team_slug}/memberships/{username}",
    { org, team_slug: teamSlug, username },
  );
}

/** Delete the team (labs' teacher-only path; the group row goes with it). */
export async function deleteTeam(
  env: AuthEnv,
  installationId: number,
  org: string,
  teamSlug: string,
): Promise<void> {
  const gh = await installationOctokit(env, installationId);
  await gh.request("DELETE /orgs/{org}/teams/{team_slug}", {
    org,
    team_slug: teamSlug,
  });
}

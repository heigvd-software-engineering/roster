// Installation-token operations on a class org's REPOSITORIES — the work
// repos F8 distributes. One GitHub call + narrowing per function; no
// orchestration (see README.md). Repos are always PRIVATE; students reach
// them only through their team's grant (base permission is "none").
import type { AuthEnv } from "../auth/config";
import { installationOctokit } from "./clients";

export type CreatedRepo = { id: number; fullName: string };

/** Create an empty private repo in the org (auto-initialized so it's
 *  immediately cloneable). */
export async function createOrgRepo(
  env: AuthEnv,
  installationId: number,
  org: string,
  name: string,
): Promise<CreatedRepo> {
  const gh = await installationOctokit(env, installationId);
  const { data } = await gh.request("POST /orgs/{org}/repos", {
    org,
    name,
    private: true,
    auto_init: true,
  });
  return { id: data.id, fullName: data.full_name };
}

/** Create a private repo from a TEMPLATE repo (starter code). */
export async function generateFromTemplate(
  env: AuthEnv,
  installationId: number,
  templateFullName: string,
  org: string,
  name: string,
): Promise<CreatedRepo> {
  const gh = await installationOctokit(env, installationId);
  const [templateOwner, templateRepo] = templateFullName.split("/");
  const { data } = await gh.request(
    "POST /repos/{template_owner}/{template_repo}/generate",
    {
      template_owner: templateOwner ?? "",
      template_repo: templateRepo ?? "",
      owner: org,
      name,
      private: true,
    },
  );
  return { id: data.id, fullName: data.full_name };
}

/** Grant the group's team PUSH on its work repo. */
export async function grantTeamRepo(
  env: AuthEnv,
  installationId: number,
  org: string,
  teamSlug: string,
  repoFullName: string,
): Promise<void> {
  const gh = await installationOctokit(env, installationId);
  const [owner, repo] = repoFullName.split("/");
  await gh.request("PUT /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}", {
    org,
    team_slug: teamSlug,
    owner: owner ?? "",
    repo: repo ?? "",
    permission: "push",
  });
}

/** The org's TEMPLATE repos — the lab dialog's starter-code choices. */
export async function orgTemplateRepos(
  env: AuthEnv,
  installationId: number,
  org: string,
): Promise<Array<{ id: number; fullName: string; name: string }>> {
  const gh = await installationOctokit(env, installationId);
  const repos = await gh.paginate("GET /orgs/{org}/repos", {
    org,
    per_page: 100,
  });
  return repos
    .filter((r) => r.is_template === true)
    .map((r) => ({ id: r.id, fullName: r.full_name, name: r.name }));
}

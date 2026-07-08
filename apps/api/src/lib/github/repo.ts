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

/** Read a repo the org already owns. Used to ADOPT a work repo whose creation
 *  succeeded but never got recorded (see `createWorkRepo`). Throws 404 when the
 *  App installation can't see it. */
export async function getOrgRepo(
  env: AuthEnv,
  installationId: number,
  org: string,
  name: string,
): Promise<CreatedRepo> {
  const gh = await installationOctokit(env, installationId);
  const { data } = await gh.request("GET /repos/{owner}/{repo}", {
    owner: org,
    repo: name,
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

/**
 * Push/creation timestamps for ALL the org's repos, keyed by full name —
 * ONE list call covers every work repo of a lab (the org listing already
 * carries `pushed_at`), instead of a per-repo GET. Note: the creation
 * commit (auto-init / template generation) also bumps `pushed_at`, so
 * "has the group pushed" must compare it against `created_at`.
 */
export async function orgRepoActivity(
  env: AuthEnv,
  installationId: number,
  org: string,
): Promise<Map<string, { pushedAt: string | null; createdAt: string | null }>> {
  const gh = await installationOctokit(env, installationId);
  const repos = await gh.paginate("GET /orgs/{org}/repos", {
    org,
    per_page: 100,
  });
  return new Map(
    repos.map((r) => [
      r.full_name,
      { pushedAt: r.pushed_at ?? null, createdAt: r.created_at ?? null },
    ]),
  );
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

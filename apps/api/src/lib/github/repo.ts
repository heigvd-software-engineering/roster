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

/** What the wall's byline shows about a repo's most recent default-branch
 *  commit. `login`/`avatarUrl` are null when the git author has no linked
 *  GitHub account; `name` is the raw git identity as the fallback. */
export type RepoLastCommit = {
  login: string | null;
  avatarUrl: string | null;
  name: string | null;
  message: string;
  committedAt: string;
  commitCount: number;
};

/** What ONE repo alias in the `reposLastCommit` query resolves to — the
 *  mirror of its selection set, hand-declared because a GraphQL response is
 *  shaped by our query text, not by an endpoint the lib could type. Null
 *  when the alias didn't resolve (repo gone); `defaultBranchRef` null on an
 *  empty repo; `user` null when the git identity has no GitHub account. */
type LastCommitAlias = {
  defaultBranchRef: {
    target: {
      history: {
        totalCount: number;
        nodes: Array<{
          messageHeadline: string;
          committedDate: string;
          author: {
            name: string | null;
            user: { login: string; avatarUrl: string } | null;
          } | null;
        }>;
      };
    } | null;
  } | null;
} | null;

/**
 * The last commit on each repo's DEFAULT branch (author identity, headline,
 * date) plus that branch's total commit count — ONE GraphQL request, one
 * alias per repo, covers all of a lab's work repos instead of a commits GET
 * per repo. Repos GraphQL can't resolve (deleted, renamed, still empty) are
 * simply absent from the map. NOTE: default branch only — `pushed_at`
 * (any-branch) stays the activity signal; this is the byline.
 */
export async function reposLastCommit(
  env: AuthEnv,
  installationId: number,
  repoFullNames: string[],
): Promise<Map<string, RepoLastCommit>> {
  if (repoFullNames.length === 0) return new Map();
  const gh = await installationOctokit(env, installationId);
  const fields = repoFullNames
    .map((full, i) => {
      const [owner, name] = full.split("/");
      return `r${i}: repository(owner: ${JSON.stringify(owner ?? "")}, name: ${JSON.stringify(name ?? "")}) {
        defaultBranchRef { target { ... on Commit {
          history(first: 1) { totalCount nodes {
            messageHeadline committedDate
            author { name user { login avatarUrl } }
          } }
        } } }
      }`;
    })
    .join("\n");
  // A dead alias (repo deleted between the listing and this query) makes
  // octokit THROW a GraphqlResponseError that still carries every alias
  // that DID resolve — recover the partial data instead of losing the batch.
  let data: Record<string, LastCommitAlias>;
  try {
    data = await gh.graphql<Record<string, LastCommitAlias>>(
      `query { ${fields} }`,
    );
  } catch (e) {
    const partial = (e as { data?: Record<string, LastCommitAlias> }).data;
    if (!partial) throw e;
    data = partial;
  }
  const out = new Map<string, RepoLastCommit>();
  repoFullNames.forEach((full, i) => {
    const history = data[`r${i}`]?.defaultBranchRef?.target?.history;
    const node = history?.nodes[0];
    if (!history || !node) return;
    out.set(full, {
      login: node.author?.user?.login ?? null,
      avatarUrl: node.author?.user?.avatarUrl ?? null,
      name: node.author?.name ?? null,
      message: node.messageHeadline,
      committedAt: node.committedDate,
      commitCount: history.totalCount,
    });
  });
  return out;
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

/**
 * Why a work repo couldn't be created. "name_taken" = the repo exists but we
 * can't read it back; "template_error" = the /generate call refused (the
 * template repo is EMPTY or gone) and is ONLY ever returned when the lab has a
 * template; "app_permissions" = the App lacks Repository write.
 */
export type RepoFailure = "name_taken" | "template_error" | "app_permissions";

/** Everything GitHub said about a failure. A 422 body carries a GENERIC
 *  summary ("Repository creation failed.") plus the actual reason in
 *  `errors[]` ("name already exists on this account") — so reading `message`
 *  alone tells you nothing. Octokit flattens both into `err.message`; we join
 *  every source rather than depend on which. Lives HERE so knowledge of
 *  octokit's error shape never leaves lib/github. */
function githubErrorText(err: unknown): string {
  const e = err as {
    message?: string;
    response?: { data?: { message?: string; errors?: { message?: string }[] } };
  };
  const data = e.response?.data;
  return [
    e.message ?? "",
    data?.message ?? "",
    ...(data?.errors ?? []).map((x) => x.message ?? ""),
  ].join(" ");
}

/**
 * Turn a GitHub repo-creation error into one of our sentinels, or `null` when
 * we don't recognize it (the caller rethrows — a 500 with the real error beats
 * a friendly lie). `usedTemplate` matters: a lab with no template calls
 * `POST /orgs/{org}/repos`, where a template error is impossible by
 * construction, so we must never blame one.
 */
export function classifyRepoFailure(
  err: unknown,
  usedTemplate: boolean,
): RepoFailure | null {
  const status = (err as { status?: number }).status;
  // "Resource not accessible by integration": the App installation lacks
  // Repository Administration/Contents write — an admin problem, surface it.
  if (status === 403) return "app_permissions";
  // A template lab's /generate 404s when the template was DELETED or RENAMED
  // since the lab was created — same teacher-must-fix answer as an empty
  // one. A 404 on the plain create path stays unrecognized (rethrown).
  if (status === 404) return usedTemplate ? "template_error" : null;
  if (status !== 422) return null;
  if (/already exists/i.test(githubErrorText(err))) return "name_taken";
  return usedTemplate ? "template_error" : null;
}

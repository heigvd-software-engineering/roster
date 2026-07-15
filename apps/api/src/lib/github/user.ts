// User-token operations — act as the caller's own GitHub account (OAuth
// token stored at link time). Only ever used for the caller's own identity
// and access; org writes go through the installation token (org.ts).
import { WorkersOctokit } from "./clients";

export type GithubProfile = {
  login: string;
  id: number;
  name: string | null;
  avatarUrl: string;
};

/**
 * GitHub could not answer AT ALL — a 5xx, a rate limit, a network fault, a
 * malformed body. Deliberately distinct from a dead token (null profile):
 * the app's one translator (`apiOnError`) turns this into a 503
 * "github_unavailable", and it must NEVER read as "not linked" (re-link
 * onboarding), "invalid link" (join), or "not found" (class access).
 */
export class GithubUnavailableError extends Error {
  constructor(detail: string, options?: { cause?: unknown }) {
    super(`GitHub unavailable: ${detail}`, options);
    this.name = "GithubUnavailableError";
  }
}

/** Rethrow an octokit failure as `GithubUnavailableError` when GitHub itself
 *  is the problem (network = no status, 5xx, 429); anything else keeps its
 *  meaning for the caller. */
function rethrowUnavailable(err: unknown, op: string): never {
  const status = (err as { status?: number }).status;
  if (status === undefined || status >= 500 || status === 429) {
    throw new GithubUnavailableError(`${op} → ${status ?? "network"}`, {
      cause: err,
    });
  }
  throw err;
}

/**
 * The linked user's live GitHub profile, or `null` — which means exactly ONE
 * thing: GitHub answered 401, the token is dead/revoked, and (re)linking is
 * the correct next step. Every other failure throws `GithubUnavailableError`
 * instead: an outage is ambiguous, and ambiguity must never send a healthy
 * link back through onboarding.
 */
export async function fetchGithubProfile(
  token: string,
): Promise<GithubProfile | null> {
  let res: Response;
  try {
    res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "labs",
      },
    });
  } catch (err) {
    throw new GithubUnavailableError("GET /user network failure", {
      cause: err,
    });
  }
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new GithubUnavailableError(`GET /user answered ${res.status}`);
  }
  try {
    const gh = (await res.json()) as {
      login: string;
      id: number;
      name: string | null;
      avatar_url: string;
    };
    return {
      login: gh.login,
      id: gh.id,
      name: gh.name,
      avatarUrl: gh.avatar_url,
    };
  } catch (err) {
    throw new GithubUnavailableError("GET /user body unreadable", {
      cause: err,
    });
  }
}

type UserInstallation = {
  installationId: number;
  login: string;
  avatarUrl: string;
};

/**
 * The App installations accessible to the user, keyed by org account id.
 * GitHub includes an org's installation for every org Owner (and, later,
 * members with repo access) — callers layer their own role checks on top.
 *
 * The payload already carries each org's `login` and `avatar_url`, so the teacher
 * hub renders those without paying for a per-class `orgInfo` call. `name` is
 * OPTIONAL on this endpoint (`string | null | undefined`) and therefore not
 * trustworthy — it comes from the cached class row until a reconcile refreshes it.
 */
export async function userInstallationsByOrgId(
  token: string,
): Promise<Map<number, UserInstallation>> {
  const gh = new WorkersOctokit({ auth: token });
  const { data } = await gh
    .request("GET /user/installations")
    .catch((err) => rethrowUnavailable(err, "GET /user/installations"));
  const byOrgId = new Map<number, UserInstallation>();
  for (const inst of data.installations) {
    if (inst.account && "login" in inst.account) {
      byOrgId.set(inst.account.id, {
        installationId: inst.id,
        login: inst.account.login,
        avatarUrl: inst.account.avatar_url,
      });
    }
  }
  return byOrgId;
}

/**
 * Every org the caller belongs to — role + state, keyed by org login,
 * LOWERCASED (GitHub logins are case-insensitive, cf. `isSameRepo`). ONE
 * bulk call answers the hub's per-class Owner question for all classes at
 * once (spec 2026-07-08): a class is the caller's iff its org is in the
 * installations map AND this map says `role: "admin", state: "active"`.
 * Authorization stays LIVE — this swaps one live shape for another; it
 * introduces no cache. Empirically verified reachable with a user-to-server
 * token (2026-07-09; the spec records the check).
 */
export async function userOrgMemberships(token: string): Promise<{
  byLogin: Map<string, { role: string; state: string }>;
  /** The caller's own GitHub login — every membership names them, so it rides
   *  along for free (no extra /user call). Null only if the caller belongs to
   *  no org. Lets a caller heal their OWN stale pending row, which is keyed by
   *  the invitation id (not their user id) and so is only findable by login. */
  login: string | null;
}> {
  const gh = new WorkersOctokit({ auth: token });
  const memberships = await gh
    .paginate("GET /user/memberships/orgs", { per_page: 100 })
    .catch((err) => rethrowUnavailable(err, "GET /user/memberships/orgs"));
  const byLogin = new Map<string, { role: string; state: string }>();
  let login: string | null = null;
  for (const m of memberships) {
    byLogin.set(m.organization.login.toLowerCase(), {
      role: m.role,
      state: m.state,
    });
    login ??= m.user?.login ?? null;
  }
  return { byLogin, login };
}

/** True iff the user can access this installation id (owns the install). */
export async function userHasInstallation(
  token: string,
  installationId: number,
): Promise<boolean> {
  const byOrgId = await userInstallationsByOrgId(token);
  for (const v of byOrgId.values()) {
    if (v.installationId === installationId) return true;
  }
  return false;
}

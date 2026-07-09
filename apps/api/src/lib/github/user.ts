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
 * The linked user's live GitHub profile. Returns null on ANY failure
 * (expired token, rate limit, outage) — a null profile is NOT the same as
 * being unlinked; the link status is tracked separately.
 */
export async function fetchGithubProfile(
  token: string,
): Promise<GithubProfile | null> {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "labs",
      },
    });
    if (!res.ok) {
      return null;
    }
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
  } catch {
    // Network error, GitHub outage, malformed JSON, etc. — same contract as
    // an HTTP error response: null, not a thrown exception.
    return null;
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
  const { data } = await gh.request("GET /user/installations");
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
export async function userOrgMemberships(
  token: string,
): Promise<Map<string, { role: string; state: string }>> {
  const gh = new WorkersOctokit({ auth: token });
  const memberships = await gh.paginate("GET /user/memberships/orgs", {
    per_page: 100,
  });
  const byLogin = new Map<string, { role: string; state: string }>();
  for (const m of memberships) {
    byLogin.set(m.organization.login.toLowerCase(), {
      role: m.role,
      state: m.state,
    });
  }
  return byLogin;
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

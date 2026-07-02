import { Octokit } from "octokit";

type UserInstallation = { installationId: number; login: string };

/**
 * The App installations accessible to a user token, keyed by org account id.
 * GitHub includes an org's installation for every org Owner (and, later,
 * members with repo access) — callers layer their own role checks on top.
 */
export async function userInstallationsByOrgId(
  token: string,
): Promise<Map<number, UserInstallation>> {
  const gh = new Octokit({ auth: token });
  const { data } = await gh.request("GET /user/installations");
  const byOrgId = new Map<number, UserInstallation>();
  for (const inst of data.installations) {
    if (inst.account && "login" in inst.account) {
      byOrgId.set(inst.account.id, {
        installationId: inst.id,
        login: inst.account.login,
      });
    }
  }
  return byOrgId;
}

/** True iff the token's user can access this installation id. */
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

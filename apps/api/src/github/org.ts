import type { AuthEnv } from "../auth/config";
import { appJwtOctokit, installationOctokit } from "./clients";

/** Resolves the org login for an installation via the App JWT. The `account`
 *  union includes the (rarer) enterprise-account shape, which has no `login`
 *  field — narrow with `in` rather than assuming the org shape. */
export async function orgLogin(env: AuthEnv, installationId: number) {
  const { data } = await appJwtOctokit(env).request(
    "GET /app/installations/{installation_id}",
    { installation_id: installationId },
  );
  if (!data.account || !("login" in data.account)) {
    throw new Error("installation account has no login");
  }
  return data.account.login;
}

/**
 * The user's live org membership, read with the installation token:
 * `{ state, role }`, or null when they're neither a member nor invited
 * (GitHub 404). Other errors propagate.
 */
export async function orgMembership(
  env: AuthEnv,
  installationId: number,
  org: string,
  username: string,
): Promise<{ state: "active" | "pending"; role: string } | null> {
  const gh = await installationOctokit(env, installationId);
  try {
    const { data } = await gh.request(
      "GET /orgs/{org}/memberships/{username}",
      { org, username },
    );
    return { state: data.state, role: data.role };
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return null;
    }
    throw err;
  }
}

/** Invite the user as an org Member (pending until they accept natively). */
export async function inviteOrgMember(
  env: AuthEnv,
  installationId: number,
  org: string,
  username: string,
): Promise<"active" | "pending"> {
  const gh = await installationOctokit(env, installationId);
  const { data } = await gh.request("PUT /orgs/{org}/memberships/{username}", {
    org,
    username,
    role: "member",
  });
  return data.state;
}

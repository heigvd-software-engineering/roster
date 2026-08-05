// App-JWT operations: reads about the App itself and its installations.
// One GitHub call plus narrowing per function; no orchestration (see README.md).
import type { AuthEnv } from "../auth/config";
import { appJwtOctokit } from "./clients";

/**
 * The account an installation sits on, or null when GitHub reports none or a
 * shape without a login (the rarer enterprise account, say). Narrow with `in`;
 * never assume the org shape.
 */
export async function installationAccount(
  env: AuthEnv,
  installationId: number,
): Promise<{ id: number; login: string; isOrganization: boolean } | null> {
  const { data } = await appJwtOctokit(env).request(
    "GET /app/installations/{installation_id}",
    { installation_id: installationId },
  );
  if (!data.account || !("login" in data.account)) {
    return null;
  }
  return {
    id: data.account.id,
    login: data.account.login,
    isOrganization:
      "type" in data.account && data.account.type === "Organization",
  };
}

/** The installation's org login; throws when there is none, since a class row
 *  always points at an org installation and anything else is a broken state. */
export async function orgLogin(env: AuthEnv, installationId: number) {
  const account = await installationAccount(env, installationId);
  if (!account) {
    throw new Error("installation account has no login");
  }
  return account.login;
}

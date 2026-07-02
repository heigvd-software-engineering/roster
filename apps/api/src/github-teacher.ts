import type { getDb } from "@labs/db";
import type { AuthEnv } from "./auth";
import { installationOctokit } from "./github";

type Db = ReturnType<typeof getDb>;

/**
 * Teacher = live GitHub org Owner (role `admin`). The caller's identity is the
 * stored `github` account id (set at link time) — no user-token call, so an
 * expired user OAuth token can't break authorization. The org's admin list is
 * read with the installation token (least privilege).
 */

/** The caller's GitHub user id, or null when unlinked/unparsable. */
export async function callerGithubId(
  db: Db,
  userId: string,
): Promise<number | null> {
  const account = await db.query.account.findFirst({
    where: (a, { and, eq }) =>
      and(eq(a.userId, userId), eq(a.providerId, "github")),
    columns: { accountId: true },
  });
  if (!account?.accountId) {
    return null;
  }
  const id = Number(account.accountId);
  return Number.isFinite(id) ? id : null;
}

/** True iff the GitHub user is an org Owner. Errors propagate to the caller. */
export async function isOrgAdmin(
  env: AuthEnv,
  installationId: number,
  orgLogin: string,
  githubUserId: number,
): Promise<boolean> {
  const gh = await installationOctokit(env, installationId);
  const { data } = await gh.request("GET /orgs/{org}/members", {
    org: orgLogin,
    role: "admin",
  });
  return data.some((member) => member.id === githubUserId);
}

import { account, getDb } from "@roster/db";
import { and, eq } from "drizzle-orm";
import { type AuthEnv, createAuth } from "./config";

/**
 * A usable GitHub access token for the user, or null.
 *
 * GitHub App user tokens expire after 8 hours; Better Auth's getAccessToken
 * refreshes an expired one with the stored refresh token and persists the new
 * pair. Null means nothing usable: no linked github account, or the refresh was
 * rejected (revoked grant, expired refresh token). Callers read that as "not
 * linked" and route the user to (re)link.
 *
 * The account is selected by row id. Better Auth 1.7 replaced the old
 * `providerId` selector with `accountId`, and despite the name that value is
 * matched against `account.id` (the primary key), never `account.accountId`
 * (GitHub's own id, which is what the rest of this codebase means by the word).
 * Passing the wrong one type-checks and quietly finds nothing, so the lookup
 * lives here rather than at the call sites.
 */
export async function githubAccessToken(
  env: AuthEnv,
  userId: string,
): Promise<string | null> {
  try {
    const [linked] = await getDb(env.DB)
      .select({ id: account.id })
      .from(account)
      .where(
        and(eq(account.userId, userId), eq(account.providerId, "github")),
      )
      .limit(1);
    if (!linked) return null;

    const { accessToken } = await createAuth(env).api.getAccessToken({
      body: { accountId: linked.id, userId },
    });
    return accessToken || null;
  } catch {
    return null;
  }
}

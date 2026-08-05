import { type AuthEnv, createAuth } from "./config";

/**
 * A usable GitHub access token for the user, or null.
 *
 * GitHub App user tokens expire after 8 hours; Better Auth's getAccessToken
 * refreshes an expired one with the stored refresh token and persists the new
 * pair. Null means nothing usable: no linked github account, or the refresh was
 * rejected (revoked grant, expired refresh token). Callers read that as "not
 * linked" and route the user to (re)link.
 */
export async function githubAccessToken(
  env: AuthEnv,
  userId: string,
): Promise<string | null> {
  try {
    const { accessToken } = await createAuth(env).api.getAccessToken({
      body: { providerId: "github", userId },
    });
    return accessToken || null;
  } catch {
    return null;
  }
}

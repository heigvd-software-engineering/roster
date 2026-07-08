import { type AuthEnv, createAuth } from "./config";

/**
 * A currently-usable GitHub access token for the user, or null.
 *
 * GitHub App user tokens expire after 8 hours; Better Auth's getAccessToken
 * transparently refreshes an expired token with the stored refresh token and
 * persists the new pair. Null means there is nothing usable: no linked
 * github account, or the refresh was rejected (revoked grant, expired
 * refresh token) — callers treat that as "not linked" and route the user
 * to (re)link.
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

import { requireMcpAuth } from "@better-auth/mcp";
import type { JSONWebKeySet, JWTPayload } from "jose";
import type { AppBindings } from "../../env";
import { createAuth } from "../auth/config";

/**
 * Bearer protection for the /mcp lane: `requireMcpAuth`, the toolkit's own
 * resource-server guard — verification, scope enforcement, every RFC
 * 6750/9728 challenge, issuer derived from the auth instance — with ONE
 * thing supplied from outside: where the JWKS comes from. Its default is an
 * HTTP fetch of `<origin>/api/auth/jwks`, and a Worker may not fetch its
 * own hostname (Cloudflare refuses self-subrequests; /mcp sharing this
 * Worker was decided 2026-08-31). So the keys come from the jwt plugin's
 * own endpoint invoked in-process — `auth.api.getJwks()` — the same
 * document with no HTTP in between.
 *
 * The one seam: the verifier's public type says `jwksUrl?: string`, but its
 * runtime has a designed second branch — a non-string source is CALLED as a
 * `() => Promise<JSONWebKeySet>` (see `fetchJwks` in @better-auth/core
 * oauth2/verify, WeakMap cache provisions included). The cast below leans
 * on that branch on purpose; the upstream issue asks for the type to say
 * so, and the day it does the cast is the only line that changes. The
 * library's function-source cache is keyed by an option `requireMcpAuth`
 * doesn't forward (`jwksCacheKey`), so the source carries its own
 * five-minute cache — the keys live in D1 and effectively never rotate.
 *
 * DPoP comes with the toolkit's defaults (replay store on the auth
 * instance's adapter); roster issues Bearer tokens and nothing requests
 * proof binding.
 */

export const READ_SCOPE = "roster:read";

let cache: { keys: JSONWebKeySet; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

const jwksInProcess = (auth: ReturnType<typeof createAuth>) => async () => {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.keys;
  }
  const keys = (await auth.api.getJwks()) as JSONWebKeySet;
  cache = { keys, fetchedAt: Date.now() };
  return keys;
};

/**
 * Wrap the lane's handler in standard MCP bearer protection. Unauthenticated
 * and invalid tokens receive the toolkit's 401 challenge (an MCP client
 * starts its authorization from it); missing scopes its 403; the handler
 * runs only with verified claims.
 */
export function protectMcp(
  env: AppBindings,
  handler: (request: Request, claims: JWTPayload) => Promise<Response>,
): (request: Request) => Promise<Response> {
  const auth = createAuth(env);
  return requireMcpAuth(auth, handler, {
    resource: `${env.BETTER_AUTH_URL}/mcp`,
    requiredScopes: [READ_SCOPE],
    // The runtime-supported function source; see the module comment.
    jwksUrl: jwksInProcess(auth) as unknown as string,
  });
}

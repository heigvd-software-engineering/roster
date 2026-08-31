import { createMcpProtectedRequestHandler } from "@better-auth/mcp";
import type { Hono } from "hono";
import type { JSONWebKeySet, JWTPayload } from "jose";
import type { AppBindings, Env } from "../../env";

/**
 * Bearer protection for the /mcp lane — the STANDARD pipeline
 * (`createMcpProtectedRequestHandler`: verification, scope enforcement, and
 * every RFC 6750/9728 challenge), fed a JWKS the one way this Worker can
 * read its own: in-process, through `app.request`. A Worker may not fetch
 * its own hostname (Cloudflare refuses self-subrequests), which is why
 * `requireMcpAuth` — the same pipeline with a hardwired self-URL — cannot
 * run here, and why /mcp staying in this Worker (decided 2026-08-31) makes
 * this file exist at all.
 *
 * The one seam: the verifier's public type says `jwksUrl?: string`, but its
 * runtime has a designed second branch — a non-string source is CALLED as a
 * `() => Promise<JSONWebKeySet>` (see `fetchJwks` in @better-auth/core
 * oauth2/verify). The cast below leans on that branch on purpose; the
 * upstream issue asks for the type to say so, and the day it does the cast
 * is the only line that changes. The library's own cache is keyed by an
 * option the handler doesn't forward (`jwksCacheKey`), so the function
 * carries its own five-minute cache — the keys live in D1 and effectively
 * never rotate.
 *
 * DPoP defaults stay untouched: roster issues Bearer tokens and advertises
 * `bearer_methods_supported: ["header"]`; nothing requests proof binding.
 */

export const READ_SCOPE = "roster:read";

let cache: { keys: JSONWebKeySet; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

const jwksInProcess = (app: Hono<Env>, env: AppBindings) => async () => {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.keys;
  }
  const res = await app.request(
    "/api/auth/jwks",
    { headers: { accept: "application/json" } },
    env,
  );
  if (!res.ok) {
    throw new Error(`jwks endpoint answered ${res.status}`);
  }
  const keys = (await res.json()) as JSONWebKeySet;
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
  app: Hono<Env>,
  env: AppBindings,
  handler: (request: Request, claims: JWTPayload) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return createMcpProtectedRequestHandler(
    {
      issuer: `${env.BETTER_AUTH_URL}/api/auth`,
      audience: `${env.BETTER_AUTH_URL}/mcp`,
      requiredScopes: [READ_SCOPE],
      // The runtime-supported function source; see the module comment.
      jwksUrl: jwksInProcess(app, env) as unknown as string,
    },
    handler,
  );
}

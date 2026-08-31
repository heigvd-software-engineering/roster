import type { Hono } from "hono";
import type { JSONWebKeySet, JWTPayload } from "jose";
import { createLocalJWKSet, jwtVerify } from "jose";
import type { AppBindings, Env } from "../../env";

/**
 * Bearer-token verification for the /mcp lane, done in-process.
 *
 * This exists because `requireMcpAuth` cannot run here, and the reason is
 * structural, found by 9.10's first authenticated request: it verifies
 * against `<origin>/api/auth/jwks` with a real HTTP fetch, and a Worker may
 * not fetch its own hostname — Cloudflare refuses self-subrequests, so every
 * token, valid or not, died as a 500. Its other path, remote introspection,
 * is a self-fetch too. The authorization server and the resource server
 * being one Worker is the design (decision #3), so the resource side reads
 * the JWKS the way it reads everything else about itself: through
 * `app.request`, in-process, no network.
 *
 * What is checked matches what `requireMcpAuth` checked: signature against
 * our JWKS, issuer, audience `<origin>/mcp` (decision #8), expiry (jose),
 * and the required scope. DPoP is not implemented: roster issues Bearer
 * tokens and nothing requests proof binding.
 */

export const READ_SCOPE = "roster:read";

/** The issuer the jwt plugin writes: origin + Better Auth's mount path. */
const issuerOf = (env: AppBindings) => `${env.BETTER_AUTH_URL}/api/auth`;

/**
 * Per-isolate JWKS cache. The signing keys live in D1 (`jwks` table) and
 * effectively never rotate; five minutes bounds the staleness if they ever
 * do, and a cold isolate pays one in-process request.
 */
let cache: { keys: JSONWebKeySet; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function jwks(app: Hono<Env>, env: AppBindings): Promise<JSONWebKeySet> {
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
}

/** The RFC 9728 challenge an MCP client starts its authorization from. */
const challenge = (
  env: AppBindings,
  status: 401 | 403,
  detail: string | null,
) => {
  // Every refusal says why in the tail: 9.10 diagnostics.
  console.warn(`mcp challenge ${status}:`, detail ?? "no bearer presented");
  const metadata = `resource_metadata="${new URL(env.BETTER_AUTH_URL).origin}/.well-known/oauth-protected-resource/mcp"`;
  const error =
    status === 403
      ? `error="insufficient_scope", scope="${READ_SCOPE}", `
      : detail
        ? `error="invalid_token", error_description="${detail}", `
        : "";
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: detail ?? "authorization required" },
      id: null,
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer ${error}${metadata}, scope="${READ_SCOPE}"`,
      },
    },
  );
};

/**
 * Verify the request's bearer token. Returns the verified claims, or the
 * Response that refuses the request — the caller forwards it as-is.
 */
export async function verifyMcpBearer(
  app: Hono<Env>,
  env: AppBindings,
  request: Request,
): Promise<{ claims: JWTPayload } | Response> {
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer /i.test(authorization)) {
    return challenge(env, 401, null);
  }
  const token = authorization.replace(/^Bearer\s+/i, "");

  let claims: JWTPayload;
  try {
    const keys = await jwks(app, env);
    ({ payload: claims } = await jwtVerify(token, createLocalJWKSet(keys), {
      issuer: issuerOf(env),
      audience: `${env.BETTER_AUTH_URL}/mcp`,
    }));
  } catch (error) {
    // Malformed, mis-signed, wrong issuer or audience, expired: to a client
    // they are all one thing — this token buys nothing, get a new grant. The
    // log carries the reason (never the token): a refused REAL token is
    // otherwise indistinguishable from noise in the tail.
    console.warn(
      "mcp token refused:",
      error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
    );
    return challenge(env, 401, "invalid or expired token");
  }

  // Typed view: JWTPayload holds `scope` only in its index signature, and
  // strictest TS forbids dotting into that while biome dislikes brackets.
  const { scope } = claims as { scope?: unknown };
  const scopes = typeof scope === "string" ? scope.split(" ") : [];
  if (!scopes.includes(READ_SCOPE)) {
    return challenge(env, 403, `missing scope ${READ_SCOPE}`);
  }
  console.warn("mcp token verified, sub:", claims.sub);
  return { claims };
}

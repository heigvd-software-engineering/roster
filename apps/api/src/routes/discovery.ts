import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { Hono } from "hono";
import type { Env } from "../env";
import { betterAuthHandler } from "../handlers/auth";
import { createAuth } from "../lib/auth/config";

/**
 * RFC 9728 protected resource metadata, at the origin root.
 *
 * An MCP client is given one address — `/mcp` — and derives the metadata URL
 * from it: `/.well-known/oauth-protected-resource` and the path-suffixed
 * `/.well-known/oauth-protected-resource/mcp`. The MCP plugin answers both, but
 * it does so from an `onRequest` hook that matches the *raw* pathname, and
 * Better Auth is mounted at `/api/auth` — so at the root nothing ever reaches
 * it. These routes hand the untouched request over, which is all the hook needs.
 *
 * The authorization server document needs routes here too, and 9.10's first
 * real client proved it (Claude Code, 2026-08-31, "DCR rejected: HTTP 405"):
 * RFC 8414 §3.1 says a path-bearing issuer publishes its metadata
 * path-INSERTED — `/.well-known/oauth-authorization-server/api/auth` — which
 * is the first URL the MCP SDK tries, while the provider's own route lives
 * path-appended under its mount. The provider ships exportable handlers for
 * exactly this ("useful when basePath prevents the endpoint from being
 * located at the root"): `oauthProviderAuthServerMetadata`, served below —
 * the toolkit's own document, nothing here builds or rewrites metadata. Its
 * OIDC twin is deliberately not mounted: this provider runs pure OAuth (no
 * OIDC mode), `getOpenIdConfig` throws, and the SDK tries the OAuth form
 * first anyway.
 *
 * Outside `/api/*` deliberately, so `requireSameOrigin` does not apply — it is
 * browser-shaped, and a client fetching discovery sends no `Origin`.
 */
export const discoveryRoutes = new Hono<Env>()
  .on(
    ["GET", "HEAD"],
    "/.well-known/oauth-protected-resource",
    ...betterAuthHandler,
  )
  .on(
    ["GET", "HEAD"],
    "/.well-known/oauth-protected-resource/*",
    ...betterAuthHandler,
  )
  .on(
    ["GET", "HEAD"],
    "/.well-known/oauth-authorization-server/api/auth",
    // The cast is collateral of config.ts's documented `as BetterAuthPlugin`
    // cast on the mcp plugin, which erases its endpoint inference — the
    // runtime serves getOAuthServerConfig/getOpenIdConfig regardless (the
    // mounted routes prove it). Both casts fall together.
    (c) =>
      oauthProviderAuthServerMetadata(
        createAuth(c.env) as unknown as Parameters<
          typeof oauthProviderAuthServerMetadata
        >[0],
      )(c.req.raw),
  );

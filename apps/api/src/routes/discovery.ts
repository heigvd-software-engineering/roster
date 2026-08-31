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
 * The authorization server document DOES need one, and 9.10's first real
 * client proved it (Claude Code, 2026-08-31, "DCR rejected: HTTP 405"). The
 * provider serves it path-APPENDED under its mount —
 * `/api/auth/.well-known/oauth-authorization-server` — but RFC 8414 §3.1
 * says a path-bearing issuer publishes it path-INSERTED:
 * `/.well-known/oauth-authorization-server/api/auth`, and that is the first
 * (and for OAuth, only) URL the MCP SDK tries. Stands in for: RFC 8414 §3.1
 * serving, which the plugin does not do at the insertion path for any issuer
 * with a path (checked 1.7.2, 2026-08-31 audit) — delete the rewrite when it
 * does. All three of its candidates
 * 404ed here, so it fell back to a default `/register` at the origin, where
 * the assets layer answers POST with 405. The route below rewrites the
 * RFC 8414 form onto the one the provider serves; the two OIDC-shaped
 * candidates stay unanswered on purpose, since the OAuth form is tried
 * first and suffices.
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
    (c) => {
      // The rewrite, not a redirect: a redirect would work but wastes the
      // client a round-trip, and the document is the same bytes either way.
      const url = new URL(c.req.url);
      url.pathname = "/api/auth/.well-known/oauth-authorization-server";
      return createAuth(c.env).handler(new Request(url, c.req.raw));
    },
  );

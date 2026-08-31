import { Hono } from "hono";
import type { Env } from "../env";
import { betterAuthHandler } from "../handlers/auth";

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
 * The authorization server document is the same story, and it took 9.10's
 * real client plus three of the user's "isn't this in the toolkit?" pushes
 * to land on the honest minimum: the provider's hook ALSO matches the
 * RFC 8414 path-INSERTED form (`/.well-known/oauth-authorization-server` +
 * the issuer's path) by raw pathname — the exact URL the MCP SDK tries
 * first. It answered 404 only because nothing routed origin-root traffic
 * into the mounted handler. So: one more plain forward, and Better Auth
 * serves its own document. (Its OIDC twin answers only when the `openid`
 * scope is configured; roster's provider is pure OAuth, and the SDK tries
 * the OAuth form first anyway.)
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
    "/.well-known/oauth-authorization-server/*",
    ...betterAuthHandler,
  );

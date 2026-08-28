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
 * The authorization server document needs no such route: clients read its
 * location from `authorization_servers` in the document below, which points at
 * the mount point, where the provider already serves it.
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
  );

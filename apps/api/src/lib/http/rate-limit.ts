import { createMiddleware } from "hono/factory";
import type { Env, RateLimitBindings } from "../../env";

/**
 * Per-IP rate limit on one of the Cloudflare rate-limiter bindings (declared in
 * `src/env.ts`, configured under `ratelimits` in wrangler.jsonc). The binding is
 * optional, and an absent one means no limit: `wrangler dev` and the test pool
 * both run without it, and a limiter that only exists in production must not be
 * the difference between booting and crashing.
 *
 * Applied per route module, beside the path it protects, rather than from a
 * list in `index.ts`, so renaming a route carries its ceiling along. Which
 * routes get one is a judgement about cost, not about authentication:
 * `/api/github/setup` resolves an installation, reads the org and seeds its
 * whole roster (three paginated GitHub calls plus a write per member) for any
 * installation id, and installation ids are small integers. Left open, one
 * client can drain the GitHub App's shared quota and take every class down with
 * it: `orgMembership` authorizes almost everything, so a spent quota is a 503
 * for all. `/api/auth/*` gets one for the ordinary reason (credentials and
 * OAuth state); `/api/join/*`, though authenticated, because it invites people
 * into a GitHub org.
 *
 * The limiter answers per key per period; we store nothing.
 */
export const rateLimit = (binding: keyof RateLimitBindings) =>
  createMiddleware<Env>(async (c, next) => {
    const limiter = c.env[binding];
    if (!limiter) return next();
    // Cloudflare sets `CF-Connecting-IP` itself, so outside callers cannot
    // spoof it. The fallback puts a local run (no edge) on one shared bucket
    // rather than leaving it silently unlimited.
    const key = c.req.header("CF-Connecting-IP") ?? "local";
    const { success } = await limiter.limit({ key });
    if (!success) return c.json({ error: "rate_limited" }, 429);
    return next();
  });

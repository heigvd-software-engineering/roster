import type { RateLimit } from "@cloudflare/workers-types";
import type { AuthEnv } from "./lib/auth/config";

/**
 * The Worker's bindings, composed HERE rather than in `lib/auth/config.ts`.
 * That file states its own scope — "exactly what Better Auth needs" — and it
 * has to keep it: every future binding (a KV, a queue, an analytics engine)
 * would otherwise register itself in the auth module, which would then import
 * a subsystem per binding while the guards import `Env` back out of it. One
 * file that knows the whole env, importing in one direction, avoids that.
 */

/**
 * Cloudflare rate-limiter bindings (`ratelimits` in wrangler.jsonc). OPTIONAL
 * on purpose: `wrangler dev` without them and the Workers test pool both run
 * with the binding absent, and a limiter that only exists in production must
 * not turn every local request into a crash. Absent = no limit, which is the
 * pre-existing behaviour.
 */
export type RateLimitBindings = {
  /** Sign-in and OAuth callbacks — where credentials are exchanged. */
  AUTH_LIMITER?: RateLimit;
  /** The App-install callback: unauthenticated, and expensive. */
  SETUP_LIMITER?: RateLimit;
};

/** Everything a request may reach: Better Auth's surface plus the rest. */
export type AppBindings = AuthEnv & RateLimitBindings;

/** The Hono env for our Worker: `new Hono<Env>()` → `c.env` is AppBindings. */
export type Env = { Bindings: AppBindings };

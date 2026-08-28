import type { RateLimit } from "@cloudflare/workers-types";
import type { AuthEnv } from "./lib/auth/config";

/**
 * The Worker's bindings live here, not in `lib/auth/config.ts`, whose scope is
 * exactly what Better Auth needs. Otherwise every new binding (a KV, a queue,
 * an analytics engine) would register itself in the auth module, which would
 * then import a subsystem per binding while the guards import `Env` back out
 * of it. One file knows the whole env, and imports flow one way.
 */

/**
 * Cloudflare rate-limiter bindings (`ratelimits` in wrangler.jsonc). Optional
 * on purpose: `wrangler dev` and the Workers test pool both run without them,
 * and a limiter that exists only in production must not crash every local
 * request. Absent means no limit.
 */
export type RateLimitBindings = {
  /** Sign-in and OAuth callbacks, where credentials are exchanged. */
  AUTH_LIMITER?: RateLimit;
  /** The App-install callback: unauthenticated, and expensive. */
  SETUP_LIMITER?: RateLimit;
  /** Dynamic client registration: unauthenticated by design, since a CLI has
   *  no session to present. A registration grants nothing on its own — no
   *  access exists until a teacher signs in and consents — so what spam buys
   *  is rows, not authority. This is the ceiling on the rows. */
  MCP_REGISTER_LIMITER?: RateLimit;
};

/** Everything a request may reach: Better Auth's surface plus the rest. */
export type AppBindings = AuthEnv & RateLimitBindings;

/** The Hono env for our Worker: `new Hono<Env>()` → `c.env` is AppBindings. */
export type Env = { Bindings: AppBindings };

import type { RateLimit } from "@cloudflare/workers-types";
import type { User } from "@roster/db";
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

/**
 * Not a Cloudflare binding: no wrangler.jsonc entry ever declares it, so on an
 * external request it is always absent. The MCP lane authenticates a tool call
 * itself, resolves the teacher, and re-enters the API through
 * `app.request(path, init, { ...env, MCP_ACTOR: user }, ctx)` — the env of an
 * internal call is the ONE channel a request cannot write to, which is what
 * makes the injection safe (decision #8; test 9.1 proves the negative space).
 * Typed like the optional rate limiters above: absent means "a browser
 * session decides", exactly as before the MCP lane existed.
 */
export type McpBindings = {
  MCP_ACTOR?: User;
};

/** Everything a request may reach: Better Auth's surface plus the rest. */
export type AppBindings = AuthEnv & RateLimitBindings & McpBindings;

/** The Hono env for our Worker: `new Hono<Env>()` → `c.env` is AppBindings. */
export type Env = { Bindings: AppBindings };

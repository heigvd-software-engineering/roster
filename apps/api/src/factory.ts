import { createFactory } from "hono/factory";
import type { Env } from "./lib/auth/config";
import type { AuthedEnv } from "./lib/auth/require-auth";

/**
 * API ORGANIZATION STANDARD (adopted 2026-07-03)
 *
 * `routes/` holds ROUTE TABLES ONLY — paths, middleware, and handler refs —
 * so each resource's API surface reads on one screen. Implementations live
 * in `handlers/` (one file per concern, several exported handlers each) and
 * are spread into the chain: `.post("/path", ...createLab)`.
 *
 * Extracting a bare `async (c) => …` would lose all of `c`'s inference
 * (env, path params, validated input) — Hono warns against exactly that.
 * These factories are the documented escape hatch: `createHandlers` infers
 * `c` from the env generic plus any validators passed alongside the handler
 * (validators therefore live WITH their handler, not in the route table),
 * and the returned tuple carries the types back into the chain, keeping
 * `AppType` → `hc` inference intact end to end.
 *
 * Recommendation: https://hono.dev/docs/guides/best-practices
 * ("If you still want to create a RoR-like Controller, use
 *  factory.createHandlers() in hono/factory. If you use this, type
 *  inference will work correctly.")
 */

/** For handlers behind `requireAuth` — `c.get("user")` is typed non-null. */
export const authedFactory = createFactory<AuthedEnv>();

/** For session-optional handlers (me, setup, auth, health). */
export const factory = createFactory<Env>();

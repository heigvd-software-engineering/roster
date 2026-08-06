import { createFactory } from "hono/factory";
import type { Env } from "./env";
import type { AuthedEnv } from "./lib/auth/require-auth";

/**
 * API organization standard (adopted 2026-07-03).
 *
 * `routes/` holds route tables only (paths, middleware, handler refs), so each
 * resource's API surface reads on one screen. Implementations live in
 * `handlers/` and are spread into the chain: `.post("/path",
 * ...createAssignment)`.
 *
 * Extracting a bare `async (c) => …` would lose all of `c`'s inference (env,
 * path params, validated input). `createHandlers` is Hono's documented escape
 * hatch: it infers `c` from the env generic plus any validators passed
 * alongside the handler (so validators live with their handler, not in the
 * route table), and the returned tuple carries the types back into the chain,
 * keeping `AppType` → `hc` inference intact end to end.
 *
 * https://hono.dev/docs/guides/best-practices
 */

/** For handlers behind `requireAuth`: `c.get("user")` is typed non-null. */
export const authedFactory = createFactory<AuthedEnv>();

/** For session-optional handlers (me, setup, auth, health). */
export const factory = createFactory<Env>();

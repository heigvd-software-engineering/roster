import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppBindings, Env } from "../env";
import { betterAuthHandler } from "../handlers/auth";
import { declareNativeLoopbackClients } from "../lib/auth/native-client-registration";
import { pruneUnclaimedClients } from "../lib/auth/unclaimed-clients";
import { rateLimit } from "../lib/http/rate-limit";

/**
 * Client registration is the one endpoint here an anonymous caller is meant to
 * reach, so it carries its own ceiling on top of AUTH_LIMITER, and sweeps
 * registrations that never became a grant. The sweep runs after the response is
 * produced and never changes it: a failed cleanup must not fail a registration.
 */
const registrationHousekeeping = createMiddleware<{ Bindings: AppBindings }>(
  async (c, next) => {
    await next();
    try {
      c.executionCtx.waitUntil(
        pruneUnclaimedClients(c.env).catch(() => {
          // Swept next time. Nothing here is load-bearing.
        }),
      );
    } catch {
      // No ExecutionContext — `app.request`-driven tests; Hono throws on the
      // ACCESSOR, which would turn a successful registration into a 500 and
      // make the doc comment above a lie. Swept next time, same as a failed
      // prune.
    }
  },
);

/** Better Auth owns everything under /api/auth/* (mounted at that prefix).
 *  Its own limiter is off (lib/auth/config.ts), so this binding is the
 *  ceiling. */
export const authRoutes = new Hono<Env>()
  .use("/*", rateLimit("AUTH_LIMITER"))
  .use(
    "/oauth2/register",
    rateLimit("MCP_REGISTER_LIMITER"),
    declareNativeLoopbackClients,
    registrationHousekeeping,
  )
  .on(["GET", "POST"], "/*", ...betterAuthHandler);

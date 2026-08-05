import { Hono } from "hono";
import type { Env } from "../env";
import { betterAuthHandler } from "../handlers/auth";
import { rateLimit } from "../lib/http/rate-limit";

/** Better Auth owns everything under /api/auth/* (mounted at that prefix).
 *  Its own limiter is off (lib/auth/config.ts), so this binding is the
 *  ceiling. */
export const authRoutes = new Hono<Env>()
  .use("/*", rateLimit("AUTH_LIMITER"))
  .on(["GET", "POST"], "/*", ...betterAuthHandler);

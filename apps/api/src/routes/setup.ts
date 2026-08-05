import { Hono } from "hono";
import type { Env } from "../env";
import { githubSetupCallback } from "../handlers/setup";
import { rateLimit } from "../lib/http/rate-limit";

/** The App-install callback. Unauthenticated by design (see the handler) AND
 *  expensive — several GitHub calls per request — so it carries the tighter
 *  of the two ceilings. */
export const setupRoutes = new Hono<Env>()
  .use("/github/setup", rateLimit("SETUP_LIMITER"))
  .get("/github/setup", ...githubSetupCallback);

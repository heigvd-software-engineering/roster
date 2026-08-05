import { Hono } from "hono";
import { confirmJoin, previewJoin, requestJoin } from "../handlers/join";
import { type AuthedEnv, requireAuth } from "../lib/auth/require-auth";
import { rateLimit } from "../lib/http/rate-limit";

export const joinRoutes = new Hono<AuthedEnv>()
  // Authenticated, but every POST here invites someone into a GitHub org.
  .use("/join/*", rateLimit("AUTH_LIMITER"))
  .use("/join/*", requireAuth)
  .get("/join/:token", ...previewJoin)
  .post("/join/:token", ...requestJoin)
  // The preview is a pure read; this records what it observed.
  .post("/join/:token/confirm", ...confirmJoin);

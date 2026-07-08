import { Hono } from "hono";
import { confirmJoin, previewJoin, requestJoin } from "../handlers/join";
import { type AuthedEnv, requireAuth } from "../lib/auth/require-auth";

export const joinRoutes = new Hono<AuthedEnv>()
  .use("/join/*", requireAuth)
  .get("/join/:token", ...previewJoin)
  .post("/join/:token", ...requestJoin)
  // The preview is a pure read; this records what it observed.
  .post("/join/:token/confirm", ...confirmJoin);

import { Hono } from "hono";
import { type AuthedEnv, requireAuth } from "../auth/require-auth";
import { previewJoin, requestJoin } from "../handlers/join";

export const joinRoutes = new Hono<AuthedEnv>()
  .use("/join/*", requireAuth)
  .get("/join/:token", ...previewJoin)
  .post("/join/:token", ...requestJoin);

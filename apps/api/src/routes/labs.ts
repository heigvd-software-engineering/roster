import { Hono } from "hono";
import { createLab } from "../handlers/labs";
import { type AuthedEnv, requireAuth } from "../lib/auth/require-auth";

export const labsRoutes = new Hono<AuthedEnv>()
  .use("/classes/*", requireAuth)
  .post("/classes/:id/labs", ...createLab);

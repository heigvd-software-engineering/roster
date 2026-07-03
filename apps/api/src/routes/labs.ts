import { Hono } from "hono";
import { type AuthedEnv, requireAuth } from "../auth/require-auth";
import { createLab } from "../handlers/labs";

export const labsRoutes = new Hono<AuthedEnv>()
  .use("/classes/*", requireAuth)
  .post("/classes/:id/labs", ...createLab);

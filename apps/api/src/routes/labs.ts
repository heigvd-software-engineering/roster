import { Hono } from "hono";
import { createLab, updateLab } from "../handlers/labs";
import { type AuthedEnv, requireAuth } from "../lib/auth/require-auth";

export const labsRoutes = new Hono<AuthedEnv>()
  .use("/classes/*", requireAuth)
  .post("/classes/:id/labs", ...createLab)
  .put("/classes/:id/labs/:labId", ...updateLab);

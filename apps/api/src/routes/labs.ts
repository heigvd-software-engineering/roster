import { Hono } from "hono";
import {
  createLab,
  deleteLab,
  listTemplateRepos,
  updateLab,
} from "../handlers/labs";
import { type AuthedEnv, requireAuth } from "../lib/auth/require-auth";

export const labsRoutes = new Hono<AuthedEnv>()
  .use("/classes/*", requireAuth)
  .post("/classes/:id/labs", ...createLab)
  .put("/classes/:id/labs/:labId", ...updateLab)
  .delete("/classes/:id/labs/:labId", ...deleteLab)
  .get("/classes/:id/templates", ...listTemplateRepos);

import { Hono } from "hono";
import { confirmClass, listClasses } from "../handlers/classes";
import { type AuthedEnv, requireAuth } from "../lib/auth/require-auth";

export const classesRoutes = new Hono<AuthedEnv>()
  .use("/classes", requireAuth)
  .use("/classes/*", requireAuth)
  .post("/classes/:id/confirm", ...confirmClass)
  .get("/classes", ...listClasses);

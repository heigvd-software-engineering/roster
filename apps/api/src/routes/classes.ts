import { Hono } from "hono";
import { type AuthedEnv, requireAuth } from "../auth/require-auth";
import { confirmClass, listClasses } from "../handlers/classes";

export const classesRoutes = new Hono<AuthedEnv>()
  .use("/classes", requireAuth)
  .use("/classes/*", requireAuth)
  .post("/classes/:id/confirm", ...confirmClass)
  .get("/classes", ...listClasses);

import { Hono } from "hono";
import { listUsers, setClassCreator } from "../handlers/admin";
import type { AuthedEnv } from "../lib/auth/require-auth";
import { requireSuperAdmin } from "../lib/auth/super-admin";

export const adminRoutes = new Hono<AuthedEnv>()
  .use("/admin/*", requireSuperAdmin)
  .get("/admin/users", ...listUsers)
  .put("/admin/users/:id/class-creator", ...setClassCreator);

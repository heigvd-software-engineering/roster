import { Hono } from "hono";
import { confirmClass, inviteTeacher, listClasses } from "../handlers/classes";
import { auditClass, reconcileClass } from "../handlers/reconcile";
import { type AuthedEnv, requireAuth } from "../lib/auth/require-auth";

export const classesRoutes = new Hono<AuthedEnv>()
  .use("/classes", requireAuth)
  .use("/classes/*", requireAuth)
  .post("/classes/:id/confirm", ...confirmClass)
  .post("/classes/:id/teachers", ...inviteTeacher)
  // The audit READS (it writes nothing); reconcile applies what the teacher accepted.
  .get("/classes/:id/audit", ...auditClass)
  .post("/classes/:id/reconcile", ...reconcileClass)
  .get("/classes", ...listClasses);

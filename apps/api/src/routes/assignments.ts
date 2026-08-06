import { Hono } from "hono";
import {
  createAssignment,
  deleteAssignment,
  listTemplateRepos,
  updateAssignment,
} from "../handlers/assignments";
import { type AuthedEnv, requireAuth } from "../lib/auth/require-auth";

export const assignmentsRoutes = new Hono<AuthedEnv>()
  .use("/classes/*", requireAuth)
  .post("/classes/:id/assignments", ...createAssignment)
  .put("/classes/:id/assignments/:assignmentId", ...updateAssignment)
  .delete("/classes/:id/assignments/:assignmentId", ...deleteAssignment)
  .get("/classes/:id/templates", ...listTemplateRepos);

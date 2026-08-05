import { Hono } from "hono";
import {
  addGroupMember,
  deleteGroup,
  joinGroup,
  leaveGroup,
  removeGroupMember,
  unlinkGroupRepo,
} from "../handlers/groups";
import { type AuthedEnv, requireAuth } from "../lib/auth/require-auth";

// Group membership and lifecycle by group id (per-lab model: a group belongs
// to one lab, so these stay class-scoped by the globally unique group id).
// Create is lab-scoped (routes/lab-groups.ts). `membership` is the caller's
// own (self join/leave), `members/:login` is a teacher acting on someone else,
// and `repo` is the teacher's escape hatch for a repo deleted on GitHub.
export const groupsRoutes = new Hono<AuthedEnv>()
  .use("/classes/:id/groups/*", requireAuth)
  .put("/classes/:id/groups/:groupId/membership", ...joinGroup)
  .delete("/classes/:id/groups/:groupId/membership", ...leaveGroup)
  .put("/classes/:id/groups/:groupId/members/:login", ...addGroupMember)
  .delete("/classes/:id/groups/:groupId/members/:login", ...removeGroupMember)
  .delete("/classes/:id/groups/:groupId/repo", ...unlinkGroupRepo)
  .delete("/classes/:id/groups/:groupId", ...deleteGroup);

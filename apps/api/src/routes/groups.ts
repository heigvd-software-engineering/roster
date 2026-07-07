import { Hono } from "hono";
import {
  addGroupMember,
  deleteGroup,
  joinGroup,
  leaveGroup,
  removeGroupMember,
} from "../handlers/groups";
import { type AuthedEnv, requireAuth } from "../lib/auth/require-auth";

// Group MEMBERSHIP + lifecycle by group id (per-lab model: a group owns its
// lab, so these stay class-scoped by the globally-unique group id). CREATE
// is lab-scoped — see routes/lab-groups.ts. `membership` = the CALLER's own
// (self join/leave); `members/:login` = a teacher acting on someone else.
export const groupsRoutes = new Hono<AuthedEnv>()
  .use("/classes/:id/groups/*", requireAuth)
  .put("/classes/:id/groups/:groupId/membership", ...joinGroup)
  .delete("/classes/:id/groups/:groupId/membership", ...leaveGroup)
  .put("/classes/:id/groups/:groupId/members/:login", ...addGroupMember)
  .delete("/classes/:id/groups/:groupId/members/:login", ...removeGroupMember)
  .delete("/classes/:id/groups/:groupId", ...deleteGroup);

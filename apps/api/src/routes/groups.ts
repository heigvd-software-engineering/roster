import { Hono } from "hono";
import {
  addGroupMember,
  createGroup,
  deleteGroup,
  joinGroup,
  leaveGroup,
  removeGroupMember,
} from "../handlers/groups";
import { type AuthedEnv, requireAuth } from "../lib/auth/require-auth";

// `membership` = the CALLER's own (self join/leave); `members/:login` = a
// teacher acting on someone else. Both live under the class so the group id
// is always scope-checked against it. There is no class-level group LIST —
// groups are listed per-lab (the lab page is the only group surface).
export const groupsRoutes = new Hono<AuthedEnv>()
  .use("/classes/:id/groups", requireAuth)
  .use("/classes/:id/groups/*", requireAuth)
  .post("/classes/:id/groups", ...createGroup)
  .put("/classes/:id/groups/:groupId/membership", ...joinGroup)
  .delete("/classes/:id/groups/:groupId/membership", ...leaveGroup)
  .put("/classes/:id/groups/:groupId/members/:login", ...addGroupMember)
  .delete("/classes/:id/groups/:groupId/members/:login", ...removeGroupMember)
  .delete("/classes/:id/groups/:groupId", ...deleteGroup);

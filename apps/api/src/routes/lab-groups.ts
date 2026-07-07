import { Hono } from "hono";
import {
  acceptIndividualLab,
  attachGroup,
  createLabRepo,
  detachGroup,
  listLabGroups,
} from "../handlers/lab-groups";
import { type AuthedEnv, requireAuth } from "../lib/auth/require-auth";

// A lab's participating groups — the group↔lab attachment, managed from the
// lab page. Group and lab are both scope-checked against the class.
// `accept` = the one-click INDIVIDUAL path (solo group + repo);
// `repo` = the explicit completion step for GROUP labs (min enforced there).
export const labGroupsRoutes = new Hono<AuthedEnv>()
  .use("/classes/:id/labs/:labId/groups", requireAuth)
  .use("/classes/:id/labs/:labId/groups/*", requireAuth)
  .use("/classes/:id/labs/:labId/accept", requireAuth)
  .get("/classes/:id/labs/:labId/groups", ...listLabGroups)
  .put("/classes/:id/labs/:labId/groups/:groupId", ...attachGroup)
  .delete("/classes/:id/labs/:labId/groups/:groupId", ...detachGroup)
  .post("/classes/:id/labs/:labId/groups/:groupId/repo", ...createLabRepo)
  .post("/classes/:id/labs/:labId/accept", ...acceptIndividualLab);

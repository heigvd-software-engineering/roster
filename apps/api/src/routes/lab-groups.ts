import { Hono } from "hono";
import {
  acceptIndividualLab,
  createLabGroup,
  createLabRepo,
  createMissingLabRepos,
  listLabGroups,
  listReusableGroups,
} from "../handlers/lab-groups";
import { type AuthedEnv, requireAuth } from "../lib/auth/require-auth";

// A lab's groups (per-lab model): groups are BORN in a lab, so create is
// here (POST /groups, optionally copying a roster forward). Group and lab
// are both scope-checked against the class.
// `accept` = the one-click INDIVIDUAL path (solo group + repo);
// `repo` = the explicit completion step for GROUP labs (min enforced there);
// `repos` = the teacher's batch of every missing one, in one request.
export const labGroupsRoutes = new Hono<AuthedEnv>()
  .use("/classes/:id/labs/:labId/groups", requireAuth)
  .use("/classes/:id/labs/:labId/groups/*", requireAuth)
  .use("/classes/:id/labs/:labId/accept", requireAuth)
  .use("/classes/:id/labs/:labId/repos", requireAuth)
  .use("/classes/:id/labs/:labId/reusable", requireAuth)
  .get("/classes/:id/labs/:labId/groups", ...listLabGroups)
  .get("/classes/:id/labs/:labId/reusable", ...listReusableGroups)
  .post("/classes/:id/labs/:labId/groups", ...createLabGroup)
  .post("/classes/:id/labs/:labId/groups/:groupId/repo", ...createLabRepo)
  .post("/classes/:id/labs/:labId/repos", ...createMissingLabRepos)
  .post("/classes/:id/labs/:labId/accept", ...acceptIndividualLab);

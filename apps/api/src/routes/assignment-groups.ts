import { Hono } from "hono";
import {
  acceptIndividualAssignment,
  createAssignmentGroup,
  createAssignmentRepo,
  createMissingAssignmentRepos,
  listAssignmentGroups,
  listReusableGroups,
} from "../handlers/assignment-groups";
import { type AuthedEnv, requireAuth } from "../lib/auth/require-auth";

// An assignment's groups (per-assignment model): groups are born in an
// assignment, so create lives here (POST /groups, optionally copying a roster
// forward). Group and assignment are both scope-checked against the class.
// `accept` is the one-click individual path (solo group + repo), `repo` the
// explicit completion step for group assignments (min enforced there), and
// `repos` the teacher's batch of every missing one.
export const assignmentGroupsRoutes = new Hono<AuthedEnv>()
  .use("/classes/:id/assignments/:assignmentId/groups", requireAuth)
  .use("/classes/:id/assignments/:assignmentId/groups/*", requireAuth)
  .use("/classes/:id/assignments/:assignmentId/accept", requireAuth)
  .use("/classes/:id/assignments/:assignmentId/repos", requireAuth)
  .use("/classes/:id/assignments/:assignmentId/reusable", requireAuth)
  .get("/classes/:id/assignments/:assignmentId/groups", ...listAssignmentGroups)
  .get("/classes/:id/assignments/:assignmentId/reusable", ...listReusableGroups)
  .post(
    "/classes/:id/assignments/:assignmentId/groups",
    ...createAssignmentGroup,
  )
  .post(
    "/classes/:id/assignments/:assignmentId/groups/:groupId/repo",
    ...createAssignmentRepo,
  )
  .post(
    "/classes/:id/assignments/:assignmentId/repos",
    ...createMissingAssignmentRepos,
  )
  .post(
    "/classes/:id/assignments/:assignmentId/accept",
    ...acceptIndividualAssignment,
  );

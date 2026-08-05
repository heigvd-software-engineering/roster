// A group row whose backing GitHub Team no longer exists.
//
// GitHub is the authority for what exists. As far as GitHub is concerned the
// team is the group: it holds the roster, and the work-repo grant is made to it.
// Delete the team and the group is gone. The students have lost push, the roster
// is unrecoverable because it only ever lived in the team, and no app-side data
// brings either back. So we follow GitHub and drop the row rather than resurrect
// an empty team the teacher never asked for.
//
// The work repo stays. Nothing in this codebase ever deletes a GitHub
// repository, because student work outlives the group that made it. The repo
// becomes an orphan, and the way back is the `work-repos` reconciler, not the
// create path: a group recreated with the same lab title and group name
// computes the same slug, and the next audit offers to adopt the repo waiting
// under it. `createWorkRepo` would answer `name_taken` — it never adopts.
//
// Teams that exist on GitHub with no group row are not our business. We cannot
// know which lab they belong to, and an org has teams roster never made.
import { groups } from "@roster/db";
import { eq } from "drizzle-orm";
import { teamMembers } from "../github/team";
import type {
  AppliedOp,
  FailedOp,
  Finding,
  FindingKey,
  Reconciler,
} from "./types";

const subjectOf = (key: FindingKey) => key.split("groupId=")[1] ?? "";

export const groupTeams: Reconciler = {
  name: "group-teams",

  async audit(ctx) {
    const rows = await ctx.groups();
    // A per-team 404 is definitive. Listing the org's teams would be one call
    // instead of N, but a team the App cannot see would read as deleted, and
    // this finding removes a group row.
    const rosters = await Promise.all(
      rows.map((g) =>
        teamMembers(ctx.env, ctx.installationId, ctx.org, g.ghTeamSlug),
      ),
    );

    const findings: Finding[] = [];
    rows.forEach((group, i) => {
      if (rosters[i] !== null) return; // team alive
      findings.push({
        key: `group-teams:delete:groupId=${group.id}`,
        reconciler: "group-teams",
        severity: "broken",
        title: `"${group.name}" no longer exists on GitHub`,
        detail: group.ghRepoFullName
          ? `Its team was deleted, so its members and their access to ${group.ghRepoFullName} are gone. The repository is kept — recreating a group with the same name re-attaches it.`
          : "Its team was deleted, so the group has no members and cannot be worked in.",
        fix: "Remove the group from this lab",
        change: {
          from: "In this lab",
          to: group.ghRepoFullName ? "Removed (repository kept)" : "Removed",
        },
      });
    });
    return findings;
  },

  async apply(ctx, keys) {
    const byId = new Map((await ctx.groups()).map((g) => [g.id, g]));
    const results: (AppliedOp | FailedOp)[] = [];

    for (const key of keys) {
      const groupId = subjectOf(key);
      try {
        // Idempotent: a row already gone is a success. The GitHub team is
        // already deleted, which is what produced this finding, and the repo is
        // never touched.
        if (byId.has(groupId)) {
          await ctx.db.delete(groups).where(eq(groups.id, groupId));
        }
        results.push({ key, ok: true });
      } catch (err) {
        results.push({
          key,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  },
};

// A group whose backing GitHub Team was deleted out of band.
//
// This state is worse than it looks. Repo access is granted TO the team
// (`grantTeamRepo`), so when the team dies the students lose push on their own
// work repo. The group is then stuck: it cannot be deleted (deleteGroup refuses
// while a repo exists — the repo is a deliverable), it cannot be worked in, and
// nothing recreates a team. Until now the lab page silently deleted the row and
// orphaned the repo, which hid all of that.
import { groups } from "@labs/db";
import { eq } from "drizzle-orm";
import { grantTeamRepo } from "../github/repo";
import { createTeam, teamMembers } from "../github/team";
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
    const rosters = await Promise.all(
      rows.map((g) =>
        teamMembers(ctx.env, ctx.installationId, ctx.org, g.ghTeamSlug),
      ),
    );
    const findings: Finding[] = [];
    rows.forEach((group, i) => {
      if (rosters[i] !== null) return; // team alive
      findings.push({
        key: `group-teams:recreate:groupId=${group.id}`,
        reconciler: "group-teams",
        severity: "broken",
        title: `"${group.name}" has no GitHub team`,
        detail: group.ghRepoFullName
          ? `Its team was deleted on GitHub, so its students can no longer push to ${group.ghRepoFullName}.`
          : "Its team was deleted on GitHub, so it has no members and cannot be worked in.",
        // The roster only ever lived in the GitHub team, so it died with it.
        // The group comes back empty; the teacher re-adds from the pool.
        fix: "Recreate the team and restore its repository access — the group comes back empty",
        destructive: false,
      });
    });
    return findings;
  },

  async apply(ctx, keys) {
    const rows = await ctx.groups();
    const byId = new Map(rows.map((g) => [g.id, g]));
    const results: (AppliedOp | FailedOp)[] = [];

    for (const key of keys) {
      const group = byId.get(subjectOf(key));
      try {
        if (!group) throw new Error("group no longer exists");

        try {
          const team = await createTeam(
            ctx.env,
            ctx.installationId,
            ctx.org,
            group.slug,
          );
          // Repo access was granted TO the old team and died with it.
          if (group.ghRepoFullName) {
            await grantTeamRepo(
              ctx.env,
              ctx.installationId,
              ctx.org,
              team.slug,
              group.ghRepoFullName,
            );
          }
          await ctx.db
            .update(groups)
            .set({
              ghTeamId: team.id,
              ghTeamSlug: team.slug,
              updatedAt: new Date(),
            })
            .where(eq(groups.id, group.id));
        } catch (err) {
          // 422 = a team with that name already exists: someone recreated it
          // between the audit and now. Idempotent — treat as already done.
          if ((err as { status?: number }).status !== 422) throw err;
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

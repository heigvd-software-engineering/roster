// A work repo that exists in the org but is not recorded on its group row —
// `createWorkRepo` created it and then died before the row write.
//
// Distinguish two states, and never conflate them:
//
//   UNRECORDED  group row exists, ghRepoFullName NULL, repo exists on GitHub
//               -> a partial createWorkRepo. This reconciler adopts it.
//   ORPHANED    no group row at all, repo exists
//               -> only the old GET-path delete produced these. With that gone
//                  and deleteGroup's has_repo guard holding, they can no longer
//                  be created. Nothing in apps/api ever deletes a GitHub repo.
import { groups, type Lab, labs } from "@roster/db";
import { eq, inArray } from "drizzle-orm";
import { getOrgRepo, grantTeamRepo } from "../github/repo";
import { isSameRepo } from "../groups";
import type {
  AppliedOp,
  FailedOp,
  Finding,
  FindingKey,
  Reconciler,
} from "./types";

const subjectOf = (key: FindingKey) => key.split("groupId=")[1] ?? "";

/** The template of the lab each group belongs to, so we never adopt it. */
async function templatesByLabId(
  ctx: Parameters<Reconciler["audit"]>[0],
  labIds: string[],
): Promise<Map<string, Lab["templateRepoFullName"]>> {
  if (labIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({ id: labs.id, template: labs.templateRepoFullName })
    .from(labs)
    .where(inArray(labs.id, labIds));
  return new Map(rows.map((r) => [r.id, r.template]));
}

export const workRepos: Reconciler = {
  name: "work-repos",

  async audit(ctx) {
    const rows = (await ctx.groups()).filter((g) => g.ghRepoFullName === null);
    if (rows.length === 0) return [];

    const repos = await ctx.orgRepos();
    const templates = await templatesByLabId(
      ctx,
      rows.map((g) => g.labId),
    );

    const findings: Finding[] = [];
    for (const group of rows) {
      const fullName = `${ctx.org}/${group.slug}`;
      if (!repos.has(fullName)) continue; // nothing to adopt

      // NEVER the lab's own template. Adoption ends in grantTeamRepo, so a group
      // slug colliding with the template's name would hand the students push on
      // the starter code. `labs: unique(classId, title)` makes that collision
      // nearly unreachable; this makes it impossible.
      if (isSameRepo(templates.get(group.labId) ?? null, fullName)) continue;

      findings.push({
        key: `work-repos:adopt:groupId=${group.id}`,
        reconciler: "work-repos",
        severity: "broken",
        title: `"${group.name}" has a repository that is not linked`,
        detail: `${fullName} exists in the organization but was never recorded on the group — its creation was interrupted.`,
        fix: "Link it to the group and re-grant the team",
        change: { from: "No repository linked", to: fullName },
      });
    }
    return findings;
  },

  async apply(ctx, keys) {
    const byId = new Map((await ctx.groups()).map((g) => [g.id, g]));
    const results: (AppliedOp | FailedOp)[] = [];

    for (const key of keys) {
      const group = byId.get(subjectOf(key));
      try {
        if (!group) throw new Error("group no longer exists");
        if (group.ghRepoFullName) {
          // Someone linked it between the audit and now. Idempotent.
          results.push({ key, ok: true });
          continue;
        }
        // The same find-or-create path createWorkRepo already takes. Throws 404
        // if the repo has since been deleted, which is reported as a failed op.
        const repo = await getOrgRepo(
          ctx.env,
          ctx.installationId,
          ctx.org,
          group.slug,
        );
        await grantTeamRepo(
          ctx.env,
          ctx.installationId,
          ctx.org,
          group.ghTeamSlug,
          repo.fullName,
        );
        // groups.ghRepoId is globally unique: if another row already holds this
        // repo the write throws, and the op reports failed rather than silently
        // moving a repo between groups.
        await ctx.db
          .update(groups)
          .set({
            ghRepoId: repo.id,
            ghRepoFullName: repo.fullName,
            updatedAt: new Date(),
          })
          .where(eq(groups.id, group.id));
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

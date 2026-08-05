// A work repo that exists in the org but is not recorded on its group row:
// `createWorkRepo` created it and then died before the row write.
//
// Two states, never to be conflated:
//
//   UNRECORDED  group row exists, ghRepoFullName NULL, repo exists on GitHub
//               -> a partial createWorkRepo. This reconciler adopts it.
//   ORPHANED    no group row at all, repo exists
//               -> deleting a group, or the lab above it, leaves one behind:
//                  the row and the team go, the repo never does. Nothing in
//                  apps/api ever deletes a GitHub repo. This reconciler cannot
//                  see them (it audits group rows, and there is none), so an
//                  orphan waits: recreate a group under the same lab title and
//                  group name and it becomes UNRECORDED above, which the next
//                  audit offers to adopt. Note the teacher must come THROUGH
//                  here — clicking "create repository" on that group instead
//                  fails `name_taken`, since `createWorkRepo` never adopts.
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

      // Never the lab's own template. Adoption ends in grantTeamRepo, so a group
      // slug colliding with the template's name would hand students push on the
      // starter code. `labs: unique(classId, title)` makes that collision nearly
      // unreachable; this makes it impossible.
      if (isSameRepo(templates.get(group.labId) ?? null, fullName)) continue;

      findings.push({
        key: `work-repos:adopt:groupId=${group.id}`,
        reconciler: "work-repos",
        severity: "broken",
        title: `"${group.name}" has a repository that is not linked`,
        // Two causes now, and the teacher arrives here from either: a create
        // that died before the row write, or a group recreated over work its
        // deleted predecessor left behind. Naming both means the page answers
        // the question that sent them ("where did my repository go?").
        detail: `${fullName} exists in the organization but is not linked to the group — either its creation was interrupted, or the group was recreated over work left by an earlier one.`,
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
        // The same find-or-create path createWorkRepo takes. Throws 404 if the
        // repo has since been deleted, and that becomes a failed op.
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
        // repo the write throws, and the op fails rather than move a repo
        // between groups.
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

// The live GitHub Team roster vs the `group_members` display cache.
//
// The team owns the roster: it grants push on the work repo. Every app mutation
// re-derives the cache from GitHub right after the change, so drift appears
// only when someone edits a team outside the app, or when the cache is new and
// still empty, which is why this reconciler doubles as the backfill.
//
// A team GitHub 404s is not reported here. That is `group-teams`' finding, and
// it alone decides a vanished team's fate. A missing roster means "unknowable",
// and a diff against nothing would propose emptying a group whose team we
// merely failed to read.
import { assignments } from "@roster/db";
import { inArray } from "drizzle-orm";
import type { OrgPerson } from "../github/org";
import { teamMembers } from "../github/team";
import { cachedRosters, syncGroupMembers } from "../group-members";
import type {
  AppliedOp,
  FailedOp,
  Finding,
  FindingKey,
  Reconciler,
} from "./types";

const subjectOf = (key: FindingKey) => key.split("groupId=")[1] ?? "";

const logins = (people: OrgPerson[]) => new Set(people.map((p) => p.login));
const list = (names: Iterable<string>) =>
  [...names].map((l) => `@${l}`).join(", ");

/** Assignment titles, so a finding can name the group unambiguously. A group's `name`
 * is unique only within its assignment, and in an individual assignment it is
 * the student's own login, so `"Ovich" has a different roster` reads as
 * nonsense alone. */
async function assignmentTitles(
  ctx: Parameters<Reconciler["audit"]>[0],
  assignmentIds: string[],
): Promise<Map<string, string>> {
  if (assignmentIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({ id: assignments.id, title: assignments.title })
    .from(assignments)
    .where(inArray(assignments.id, assignmentIds));
  return new Map(rows.map((r) => [r.id, r.title]));
}

/**
 * How the two differ, and what to call it.
 *
 * An audit compares two snapshots. It never witnessed a change, so it may not
 * name one: "@x joined on GitHub" asserts an event, an actor, and a direction
 * we did not observe, when the row could equally have been dropped on our side.
 * Every string below states what is, and lets the teacher infer why.
 *
 * Two genuinely different situations:
 *
 *   FIRST SYNC  we hold no roster at all: a group made before this cache
 *               existed, or one whose rows were lost. Nothing drifted.
 *   DRIFT       we hold a roster, and GitHub's team disagrees with it.
 */
function diff(
  live: OrgPerson[],
  cached: OrgPerson[],
): {
  title: string;
  detail: string;
  fix: string;
  change: { from: string; to: string };
} | null {
  const now = logins(live);
  const was = logins(cached);
  const added = [...now].filter((l) => !was.has(l));
  const removed = [...was].filter((l) => !now.has(l));
  if (added.length === 0 && removed.length === 0) return null;

  // The from/to chips are the two rosters themselves. An empty side reads as
  // words, never as a blank chip.
  const change = {
    from: cached.length === 0 ? "No roster recorded" : list(was),
    to: now.size === 0 ? "No members" : list(now),
  };

  if (cached.length === 0) {
    return {
      title: "— no roster recorded",
      detail: `On GitHub: ${list(now)}.`,
      fix: "Record the GitHub roster",
      change,
    };
  }

  const parts: string[] = [];
  if (added.length > 0) parts.push(`On GitHub only: ${list(added)}.`);
  if (removed.length > 0) parts.push(`Here only: ${list(removed)}.`);
  return {
    title: "— roster differs from GitHub",
    detail: parts.join(" "),
    fix: "Copy the GitHub roster",
    change,
  };
}

export const groupMembersReconciler: Reconciler = {
  name: "group-members",

  async audit(ctx) {
    const rows = await ctx.groups();
    if (rows.length === 0) return [];

    const [live, cached, titles] = await Promise.all([
      Promise.all(
        rows.map((g) =>
          teamMembers(ctx.env, ctx.installationId, ctx.org, g.ghTeamSlug),
        ),
      ),
      cachedRosters(
        ctx.db,
        rows.map((g) => g.id),
      ),
      assignmentTitles(
        ctx,
        rows.map((g) => g.assignmentId),
      ),
    ]);

    const findings: Finding[] = [];
    rows.forEach((group, i) => {
      const team = live[i];
      if (team === undefined || team === null) return; // gone → group-teams' finding
      const changed = diff(team, cached.get(group.id) ?? []);
      if (!changed) return;
      const assignment = titles.get(group.assignmentId);
      const named = assignment
        ? `"${group.name}" in ${assignment}`
        : `"${group.name}"`;
      findings.push({
        key: `group-members:sync:groupId=${group.id}`,
        reconciler: "group-members",
        severity: "drift",
        title: `${named} ${changed.title}`,
        detail: changed.detail,
        fix: changed.fix,
        change: changed.change,
      });
    });
    return findings;
  },

  async apply(ctx, keys) {
    const byId = new Map((await ctx.groups()).map((g) => [g.id, g]));
    const results: (AppliedOp | FailedOp)[] = [];

    for (const key of keys) {
      const group = byId.get(subjectOf(key));
      try {
        if (!group) throw new Error("group no longer exists");
        // Re-read GitHub rather than trust the proposal: the audit only chose
        // which group to refresh. A second apply writes the same rows.
        const live = await syncGroupMembers(
          ctx.db,
          ctx.env,
          ctx.installationId,
          ctx.org,
          group,
        );
        if (live === null)
          throw new Error("the team no longer exists on GitHub");
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

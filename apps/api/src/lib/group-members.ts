import { type Group, type getDb, groupMembers } from "@roster/db";
import { eq, inArray } from "drizzle-orm";
import type { AuthEnv } from "./auth/config";
import type { OrgPerson } from "./github/org";
import { teamMembers } from "./github/team";

type Db = ReturnType<typeof getDb>;

/**
 * Writers and readers for the `group_members` roster display cache.
 *
 * GitHub's Team is the authority: it holds the roster and it grants push on the
 * work repo. This table mirrors it, so rendering a lab costs zero GitHub calls
 * and "is this student already in a group of this lab?" is a query rather than
 * one team-roster fetch per group.
 *
 * Invariant, same as `class_members`: nothing authorizes against this table.
 * Push comes from the team.
 *
 * There is deliberately no bulk writer across groups. `syncGroupMembers` takes
 * one group and replaces exactly that group's rows with what GitHub just said
 * about that one team.
 */

/** Mirror a roster we already hold into `group_members`, replacing what's there.
 *
 *  Scoped to one group, so a failure can never reach another group's rows. Split
 *  out of `syncGroupMembers` because several write paths fetch the live roster
 *  for their own reasons (the solo-group guard, the "is this group complete
 *  enough for a repo" gate) and mirror what they read rather than pay for a
 *  second call. Anywhere a write path holds the truth, it writes it. */
export async function replaceGroupMembers(
  db: Db,
  groupId: string,
  people: OrgPerson[],
): Promise<void> {
  const now = new Date();
  await db.delete(groupMembers).where(eq(groupMembers.groupId, groupId));
  if (people.length === 0) return;
  await db.insert(groupMembers).values(
    people.map((person) => ({
      id: crypto.randomUUID(),
      groupId,
      githubId: String(person.id),
      login: person.login,
      avatarUrl: person.avatarUrl,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

/** GitHub's roster for one team, mirrored into `group_members`.
 *
 *  Called on the write paths (join, leave, add, remove, create) right after the
 *  mutation GitHub just accepted, so the cache is re-derived from the authority
 *  rather than guessed from the request. A login rename or an out-of-band edit
 *  therefore self-heals on the next mutation.
 *
 *  Returns the live roster, or `null` when the team is gone on GitHub. A 404 is
 *  unknowable, not empty, so the rows stay exactly as they were: deleting them
 *  would destroy the only record of who was in the group on the strength of a
 *  call that merely failed, and the `group-teams` reconciler, not a read,
 *  decides a vanished team's fate. */
export async function syncGroupMembers(
  db: Db,
  env: AuthEnv,
  installationId: number,
  org: string,
  group: Pick<Group, "id" | "ghTeamSlug">,
): Promise<OrgPerson[] | null> {
  const live = await teamMembers(env, installationId, org, group.ghTeamSlug);
  if (live === null) return null;
  // Replace, not diff: the live list is the roster.
  await replaceGroupMembers(db, group.id, live);
  return live;
}

/** Cached rosters for many groups, in one query. Groups with no rows map to an
 *  empty list: a group nobody has joined yet is legitimately empty. */
export async function cachedRosters(
  db: Db,
  groupIds: string[],
): Promise<Map<string, OrgPerson[]>> {
  const out = new Map<string, OrgPerson[]>(groupIds.map((id) => [id, []]));
  if (groupIds.length === 0) return out;

  const rows = await db
    .select()
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, groupIds));
  for (const row of rows) {
    out.get(row.groupId)?.push({
      id: Number(row.githubId),
      login: row.login,
      avatarUrl: row.avatarUrl,
    });
  }
  return out;
}

export async function cachedRoster(
  db: Db,
  groupId: string,
): Promise<OrgPerson[]> {
  return (await cachedRosters(db, [groupId])).get(groupId) ?? [];
}

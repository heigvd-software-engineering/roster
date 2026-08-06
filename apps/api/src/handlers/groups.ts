import { assignments, type Group, type getDb, groups } from "@roster/db";
import { eq } from "drizzle-orm";
import { authedFactory } from "../factory";
import { findGroupInClass, resolveClassAsMember } from "../lib/class-scope";
import { cachedRoster } from "../lib/group-members";
import {
  alreadyInAssignmentGroup,
  assignmentMax,
  assignmentStarted,
  checkRepoExists,
  deleteGroupsWithTeams,
} from "../lib/groups";

type Db = ReturnType<typeof getDb>;

/** The repo lock: once the work repo exists the group is a deliverable, and
 *  its roster only changes through the teacher. Join and leave refuse with the
 *  same vocabulary (409 has_repo). Deletion is NOT gated on it: no delete in
 *  this app is refused, they are all gated on typing the name instead (see
 *  `deleteGroup`). */
const isLocked = (group: Pick<Group, "ghRepoId">) => group.ghRepoId !== null;

/** Fresh read of the lock. The handler's first check can be seconds stale by
 *  the time the GitHub membership call lands (repo creation records ghRepoId
 *  only after a chain of GitHub calls), so join and leave re-check after. */
async function lockedNow(db: Db, groupId: string): Promise<boolean> {
  const [row] = await db
    .select({ ghRepoId: groups.ghRepoId })
    .from(groups)
    .where(eq(groups.id, groupId));
  return row !== undefined && row.ghRepoId !== null;
}

/**
 * Group membership and lifecycle (per-assignment model, spec 2026-07-07). A
 * group is a GitHub Team (secret, students always role `member`) belonging to
 * one assignment, and the team owns the roster. Permissions: any live active
 * org member joins or leaves themselves; only a live org Owner (teacher)
 * manages other members or deletes groups. Creating a group is
 * assignment-scoped (handlers/assignment-groups.ts). `groupId` is globally
 * unique, so these stay class-scoped by id; the group carries its own
 * `assignmentId` for the invariant.
 *
 * Every mutation here ends in `team.syncMembers(group)`: GitHub accepted the
 * change, so we re-read that one team and mirror it into `group_members`, and
 * the read paths then cost zero GitHub calls. The mirror is display-only:
 * push on the work repo comes from the team, never from the table.
 */

/** Join the group; the caller only ever adds themselves. Refused when it would
 *  put them in two groups of the same assignment, or when the group's work repo
 *  exists: a locked group changes only through the teacher. */
export const joinGroup = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsMember(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const group = await findGroupInClass(access, c.req.param("groupId"));
  if (!group) return c.json({ error: "not_found" }, 404);

  const [assignment] = await access.db
    .select()
    .from(assignments)
    .where(eq(assignments.id, group.assignmentId));
  // The start gate comes first: before the assignment opens, membership is
  // frozen for students. A teacher may pre-form groups (escape hatch), and
  // students must not reshape them early.
  if (assignment && !access.isTeacher && !assignmentStarted(assignment)) {
    return c.json({ error: "not_started" }, 409);
  }
  // The repo lock (same vocabulary as delete): joining a team means push on
  // its work repo, so once that repo exists only the teacher moves people.
  if (isLocked(group)) {
    return c.json({ error: "has_repo" }, 409);
  }
  if (
    await alreadyInAssignmentGroup(
      access,
      group.assignmentId,
      access.callerLogin,
      group.id,
    )
  ) {
    return c.json({ error: "member_already_participating" }, 409);
  }
  // The size cap: the UI hides Join on full groups, but the API is the
  // boundary, and a direct request must not oversize the group either.
  if (
    assignment &&
    (await cachedRoster(access.db, group.id)).length >=
      assignmentMax(assignment)
  ) {
    return c.json({ error: "group_full" }, 409);
  }
  await access.team.add(group.ghTeamSlug, access.callerLogin);
  // The lock can appear while we add (see lockedNow): re-check and roll back,
  // or the joiner gains push on a repo that locked without them.
  if (await lockedNow(access.db, group.id)) {
    await access.team.remove(group.ghTeamSlug, access.callerLogin);
    await access.team.syncMembers(group);
    return c.json({ error: "has_repo" }, 409);
  }
  await access.team.syncMembers(group);
  return c.json({ ok: true });
});

/** Leave the group; the caller only ever removes themselves. Refused once the
 *  work repo exists: the lock keeps students from hopping between groups
 *  after work has started. */
export const leaveGroup = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsMember(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const group = await findGroupInClass(access, c.req.param("groupId"));
  if (!group) return c.json({ error: "not_found" }, 404);

  // Same start gate as join: membership is frozen until the assignment opens.
  const [assignment] = await access.db
    .select()
    .from(assignments)
    .where(eq(assignments.id, group.assignmentId));
  if (assignment && !access.isTeacher && !assignmentStarted(assignment)) {
    return c.json({ error: "not_started" }, 409);
  }
  if (isLocked(group)) {
    return c.json({ error: "has_repo" }, 409);
  }
  await access.team.remove(group.ghTeamSlug, access.callerLogin);
  // Same race as join: if the lock landed while we removed, reinstate. The
  // leave should have been refused, and a locked group must not shrink below
  // the roster its repo was granted to.
  if (await lockedNow(access.db, group.id)) {
    await access.team.add(group.ghTeamSlug, access.callerLogin);
    await access.team.syncMembers(group);
    return c.json({ error: "has_repo" }, 409);
  }
  await access.team.syncMembers(group);
  return c.json({ ok: true });
});

/** Teacher-only: put any org user into the group, under the same within-assignment
 *  double-booking guard and size cap as self-join. */
export const addGroupMember = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsMember(c, c.req.param("id"));
  if (!access?.isTeacher) return c.json({ error: "not_found" }, 404);
  const group = await findGroupInClass(access, c.req.param("groupId"));
  const login = c.req.param("login");
  if (!group || !login) return c.json({ error: "not_found" }, 404);

  if (
    await alreadyInAssignmentGroup(access, group.assignmentId, login, group.id)
  ) {
    return c.json({ error: "member_already_participating" }, 409);
  }
  // The size cap binds the teacher too: the assignment's max is the
  // assignment's rule, not a default the roster may drift past one add at a
  // time. A bigger group is a decision about the assignment, so raise
  // maxMembers there and every group gets it visibly, instead of one group
  // quietly becoming special.
  const [assignment] = await access.db
    .select()
    .from(assignments)
    .where(eq(assignments.id, group.assignmentId));
  if (
    assignment &&
    (await cachedRoster(access.db, group.id)).length >=
      assignmentMax(assignment)
  ) {
    return c.json({ error: "group_full" }, 409);
  }
  await access.team.add(group.ghTeamSlug, login);
  await access.team.syncMembers(group);
  return c.json({ ok: true });
});

/** Teacher-only: remove any member from the group. */
export const removeGroupMember = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsMember(c, c.req.param("id"));
  if (!access?.isTeacher) return c.json({ error: "not_found" }, 404);
  const group = await findGroupInClass(access, c.req.param("groupId"));
  const login = c.req.param("login");
  if (!group || !login) return c.json({ error: "not_found" }, 404);

  await access.team.remove(group.ghTeamSlug, login);
  await access.team.syncMembers(group);
  return c.json({ ok: true });
});

/**
 * Teacher-only: delete the group (team + row, via `deleteGroupsWithTeams`).
 *
 * Refuses nothing, including a group whose work repo exists — the app has one
 * deletion rule and it is the typed name in the client's dialog (see
 * `docs/classes-and-assignments.md`). A repo-bearing group was refused here
 * once, which read as a guarantee it never was: deleting the assignment above
 * it took the same group anyway.
 *
 * Losing the group costs the students push, not their work: the repo stays in
 * the org, and the teacher's GitHub sync offers to link it to a group recreated
 * under the same name (`lib/reconcile/work-repos.ts`).
 */
export const deleteGroup = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsMember(c, c.req.param("id"));
  if (!access?.isTeacher) return c.json({ error: "not_found" }, 404);
  const group = await findGroupInClass(access, c.req.param("groupId"));
  if (!group) return c.json({ error: "not_found" }, 404);

  await deleteGroupsWithTeams(access, [group]);
  return c.json({ ok: true });
});

/** Teacher-only: clear a repo link the assignment page flagged as missing
 * (`repoStatus: "missing"`, `listAssignmentGroups` / `resolveRepoStatuses`).
 * The repo was deleted directly on GitHub, which otherwise leaves the group
 * locked forever (`isLocked` reads `ghRepoId`, with no path back to null).
 * Re-verifies live rather than trusting a possibly stale client flag: if the
 * repo reappeared (recreated with the same name after the page loaded), refuse
 * rather than rip out a working link. */
export const unlinkGroupRepo = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsMember(c, c.req.param("id"));
  if (!access?.isTeacher) return c.json({ error: "not_found" }, 404);
  const group = await findGroupInClass(access, c.req.param("groupId"));
  if (!group?.ghRepoFullName) return c.json({ error: "not_found" }, 404);

  const repo = await checkRepoExists(c.env, access, group);
  if (repo !== null) return c.json({ error: "still_exists" }, 409);

  await access.db
    .update(groups)
    .set({ ghRepoId: null, ghRepoFullName: null, updatedAt: new Date() })
    .where(eq(groups.id, group.id));
  return c.json({ ok: true });
});

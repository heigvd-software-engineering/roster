import { type Group, type getDb, groups, labs } from "@roster/db";
import { eq } from "drizzle-orm";
import { authedFactory } from "../factory";
import { findGroupInClass, resolveClassAsMember } from "../lib/class-scope";
import { cachedRoster } from "../lib/group-members";
import {
  alreadyInLabGroup,
  checkRepoExists,
  labMax,
  labStarted,
} from "../lib/groups";

type Db = ReturnType<typeof getDb>;

/** The repo lock: once the WORK REPO exists the group is a deliverable —
 *  membership and existence only change through the teacher. Join, leave
 *  and delete all refuse with the same vocabulary (409 has_repo). */
const isLocked = (group: Pick<Group, "ghRepoId">) => group.ghRepoId !== null;

/** Fresh read of the lock — the handler's first check can be seconds stale
 *  by the time the GitHub membership call lands (repo creation only records
 *  ghRepoId after a chain of GitHub calls), so join/leave re-check after. */
async function lockedNow(db: Db, groupId: string): Promise<boolean> {
  const [row] = await db
    .select({ ghRepoId: groups.ghRepoId })
    .from(groups)
    .where(eq(groups.id, groupId));
  return row !== undefined && row.ghRepoId !== null;
}

/**
 * Group MEMBERSHIP + lifecycle (per-lab model, spec 2026-07-07). A group is
 * a GitHub Team (secret, students always role `member`) that belongs to ONE
 * lab; the team OWNS the roster. Permission model: any live ACTIVE org member
 * joins/leaves THEMSELVES; only a live org Owner (teacher) manages other
 * members or deletes groups. Creating a group is lab-scoped — see
 * handlers/lab-groups.ts. `groupId` is globally unique, so these stay
 * class-scoped by id; the group carries its own `labId` for the invariant.
 *
 * Every mutation here ends in `team.syncMembers(group)`: GitHub accepted the
 * change, so we re-read that one team and mirror it into `group_members`. The
 * read paths then cost zero GitHub calls. The mirror is display-only — push on
 * the work repo comes from the team, never from the table.
 */

/** Join the group — the caller only ever adds THEMSELVES. Refused when it
 *  would put them in two groups OF THE SAME LAB, or when the group's work
 *  repo exists: a locked group only changes through the teacher. */
export const joinGroup = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsMember(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const group = await findGroupInClass(access, c.req.param("groupId"));
  if (!group) return c.json({ error: "not_found" }, 404);

  const [lab] = await access.db
    .select()
    .from(labs)
    .where(eq(labs.id, group.labId));
  // The start gate comes first: before the lab opens, membership is frozen
  // for students — a teacher may pre-form groups (escape hatch), and
  // students must not reshape them early. Teachers manage top-down.
  if (lab && !access.isTeacher && !labStarted(lab)) {
    return c.json({ error: "not_started" }, 409);
  }
  // The repo lock (same vocabulary as delete): joining a team means push on
  // its work repo — once that repo exists, only the teacher moves people.
  if (isLocked(group)) {
    return c.json({ error: "has_repo" }, 409);
  }
  if (
    await alreadyInLabGroup(access, group.labId, access.callerLogin, group.id)
  ) {
    return c.json({ error: "member_already_participating" }, 409);
  }
  // The size cap: the UI hides Join on full groups, but the API is the
  // boundary — a direct request must not oversize the group either.
  if (lab && (await cachedRoster(access.db, group.id)).length >= labMax(lab)) {
    return c.json({ error: "group_full" }, 409);
  }
  await access.team.add(group.ghTeamSlug, access.callerLogin);
  // The lock can appear WHILE we add (see lockedNow) — re-check and roll
  // back, or the joiner gains push on a repo that locked without them.
  if (await lockedNow(access.db, group.id)) {
    await access.team.remove(group.ghTeamSlug, access.callerLogin);
    await access.team.syncMembers(group);
    return c.json({ error: "has_repo" }, 409);
  }
  await access.team.syncMembers(group);
  return c.json({ ok: true });
});

/** Leave the group — the caller only ever removes THEMSELVES. Refused once
 *  the work repo exists: the lock keeps students from hopping between
 *  groups after work has started. */
export const leaveGroup = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsMember(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const group = await findGroupInClass(access, c.req.param("groupId"));
  if (!group) return c.json({ error: "not_found" }, 404);

  // Same start gate as join: membership is frozen until the lab opens.
  const [lab] = await access.db
    .select()
    .from(labs)
    .where(eq(labs.id, group.labId));
  if (lab && !access.isTeacher && !labStarted(lab)) {
    return c.json({ error: "not_started" }, 409);
  }
  if (isLocked(group)) {
    return c.json({ error: "has_repo" }, 409);
  }
  await access.team.remove(group.ghTeamSlug, access.callerLogin);
  // Same race as join: if the lock landed while we removed, reinstate —
  // the leave should have been refused, and a locked group must not
  // shrink below the roster its repo was granted to.
  if (await lockedNow(access.db, group.id)) {
    await access.team.add(group.ghTeamSlug, access.callerLogin);
    await access.team.syncMembers(group);
    return c.json({ error: "has_repo" }, 409);
  }
  await access.team.syncMembers(group);
  return c.json({ ok: true });
});

/** Teacher-only: put ANY org user into the group — same within-lab
 *  double-booking guard AND the same size cap as self-join. */
export const addGroupMember = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsMember(c, c.req.param("id"));
  if (!access?.isTeacher) return c.json({ error: "not_found" }, 404);
  const group = await findGroupInClass(access, c.req.param("groupId"));
  const login = c.req.param("login");
  if (!group || !login) return c.json({ error: "not_found" }, 404);

  if (await alreadyInLabGroup(access, group.labId, login, group.id)) {
    return c.json({ error: "member_already_participating" }, 409);
  }
  // The size cap binds the TEACHER too: the lab's max is the lab's rule, not
  // a default the roster may drift past one add at a time. Wanting a bigger
  // group is a decision about the LAB — raise maxMembers there and every
  // group gets it, visibly, instead of one group quietly becoming special.
  const [lab] = await access.db
    .select()
    .from(labs)
    .where(eq(labs.id, group.labId));
  if (lab && (await cachedRoster(access.db, group.id)).length >= labMax(lab)) {
    return c.json({ error: "group_full" }, 409);
  }
  await access.team.add(group.ghTeamSlug, login);
  await access.team.syncMembers(group);
  return c.json({ ok: true });
});

/** Teacher-only: remove ANY member from the group. */
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

/** Teacher-only: delete the group (team + row). A team already gone on
 *  GitHub still drops the row; a group whose WORK REPO exists is a
 *  deliverable — refuse rather than orphan it. */
export const deleteGroup = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsMember(c, c.req.param("id"));
  if (!access?.isTeacher) return c.json({ error: "not_found" }, 404);
  const group = await findGroupInClass(access, c.req.param("groupId"));
  if (!group) return c.json({ error: "not_found" }, 404);

  if (isLocked(group)) {
    return c.json({ error: "has_repo" }, 409);
  }

  try {
    await access.team.delete(group.ghTeamSlug);
  } catch (err) {
    if ((err as { status?: number }).status !== 404) throw err;
  }
  // group_members rows go with it (FK ON DELETE CASCADE).
  await access.db.delete(groups).where(eq(groups.id, group.id));
  return c.json({ ok: true });
});

/** Teacher-only: clear a repo link the lab page has flagged as missing
 *  (`repoStatus: "missing"`, `listLabGroups` / `resolveRepoStatuses`) — the
 *  repo was deleted directly on GitHub, which otherwise leaves the group
 *  locked forever (`isLocked` reads `ghRepoId`, with no path back to null).
 *  Re-verifies live rather than trusting a possibly stale client flag: if
 *  the repo has reappeared (recreated with the same name after the page
 *  loaded), refuse rather than rip out a working link. */
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

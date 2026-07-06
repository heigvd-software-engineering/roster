import { groups, studentLabRepos } from "@labs/db";
import { and, eq } from "drizzle-orm";
import { authedFactory } from "../factory";
import {
  groupInClass,
  labInClass,
  linkedUsers,
  resolveClassAccess,
} from "../lib/access";
import { teamMembers } from "../lib/github/team";
import {
  attachPair,
  createGroupWithTeam,
  groupsWithRosters,
} from "../lib/groups";

/**
 * The lab page's group surface (F7): ONE list — all the class's groups with
 * live rosters + which of them participate in this lab — so the page needs
 * a single request for attached groups AND accept/attach candidates.
 * Attaching creates the `student_lab_repos` link (repos arrive with F8).
 * Attach rules: caller in the group (or a teacher), live size within the
 * lab's MAX (under-min groups form in place — min bites at F8's repo
 * creation), and no member already participating through another group.
 * Denials are 404, like everything class-scoped.
 */

/** All class groups with live rosters + the lab's attached group ids +
 *  linked SWITCH users for every roster member. */
export const listLabGroups = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const lab = await labInClass(access, c.req.param("labId"));
  if (!lab) return c.json({ error: "not_found" }, 404);

  const rows = await access.db
    .select()
    .from(groups)
    .where(eq(groups.classId, access.cls.id))
    .orderBy(groups.createdAt);
  const out = await groupsWithRosters(c.env, access, rows);
  // After reconciliation: gone groups' attachments were dropped with them.
  const attached = await access.db
    .select({ groupId: studentLabRepos.groupId })
    .from(studentLabRepos)
    .where(eq(studentLabRepos.labId, lab.id));
  const users = await linkedUsers(
    access.db,
    out.flatMap((g) => g.members.map((m) => String(m.id))),
  );
  return c.json({
    groups: out,
    users,
    attachedIds: attached.map((a) => a.groupId),
  });
});

/** Attach a group to the lab (member of the group, or a teacher). */
export const attachGroup = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const lab = await labInClass(access, c.req.param("labId"));
  const group = await groupInClass(access, c.req.param("groupId"));
  if (!lab || !group) return c.json({ error: "not_found" }, 404);

  const members = await teamMembers(
    c.env,
    access.cls.installationId,
    access.org,
    group.ghTeamSlug,
  );
  if (members === null) return c.json({ error: "not_found" }, 404);
  if (!access.admin && !members.some((m) => m.login === access.login)) {
    return c.json({ error: "not_found" }, 404);
  }

  // Size gate against the LIVE roster — MAX only (individual = one).
  const max =
    lab.groupMode === "individual"
      ? 1
      : (lab.maxMembers ?? Number.MAX_SAFE_INTEGER);
  if (members.length > max) {
    return c.json({ error: "group_size" }, 409);
  }

  // Invariant: a student participates in a lab through AT MOST one group —
  // checked against the live rosters of the other attached groups.
  const attached = await access.db
    .select({ group: groups })
    .from(studentLabRepos)
    .innerJoin(groups, eq(studentLabRepos.groupId, groups.id))
    .where(eq(studentLabRepos.labId, lab.id));
  const others = attached.filter(({ group: g }) => g.id !== group.id);
  const rosters = await Promise.all(
    others.map(({ group: g }) =>
      teamMembers(c.env, access.cls.installationId, access.org, g.ghTeamSlug),
    ),
  );
  const overlaps = rosters.some(
    (other) => other?.some((o) => members.some((m) => m.id === o.id)) ?? false,
  );
  if (overlaps) {
    return c.json({ error: "member_already_participating" }, 409);
  }

  await attachPair(access.db, lab.id, group.id);
  return c.json({ ok: true });
});

/**
 * One-click accept for INDIVIDUAL labs: find-or-create the caller's SOLO
 * group (a team named after their login) and attach it. Group labs refuse —
 * their accept path is the group UI. Idempotent.
 */
export const acceptIndividualLab = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const lab = await labInClass(access, c.req.param("labId"));
  if (!lab) return c.json({ error: "not_found" }, 404);
  if (lab.groupMode !== "individual") {
    return c.json({ error: "group_lab" }, 409);
  }

  // The solo group, by naming convention (team name = login) — verified
  // live to really be the caller's own one-person team.
  const [existing] = await access.db
    .select()
    .from(groups)
    .where(
      and(eq(groups.classId, access.cls.id), eq(groups.name, access.login)),
    );
  if (existing) {
    const members = await teamMembers(
      c.env,
      access.cls.installationId,
      access.org,
      existing.ghTeamSlug,
    );
    if (members?.length !== 1 || members[0]?.login !== access.login) {
      // A same-named group that isn't the caller's solo team — refuse
      // rather than hijack it.
      return c.json({ error: "solo_name_taken" }, 409);
    }
    await attachPair(access.db, lab.id, existing.id);
    return c.json({ ok: true, groupId: existing.id });
  }

  const created = await createGroupWithTeam(
    c.env,
    access,
    access.login,
    c.get("user").id,
    { autoJoin: true },
  );
  if (!created) return c.json({ error: "solo_name_taken" }, 409);
  await attachPair(access.db, lab.id, created.id);
  return c.json({ ok: true, groupId: created.id });
});

/** Detach a group from the lab (member of the group, or a teacher). */
export const detachGroup = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const lab = await labInClass(access, c.req.param("labId"));
  const group = await groupInClass(access, c.req.param("groupId"));
  if (!lab || !group) return c.json({ error: "not_found" }, 404);

  if (!access.admin) {
    const members = await teamMembers(
      c.env,
      access.cls.installationId,
      access.org,
      group.ghTeamSlug,
    );
    if (!members?.some((m) => m.login === access.login)) {
      return c.json({ error: "not_found" }, 404);
    }
  }

  await access.db
    .delete(studentLabRepos)
    .where(
      and(
        eq(studentLabRepos.labId, lab.id),
        eq(studentLabRepos.groupId, group.id),
      ),
    );
  return c.json({ ok: true });
});

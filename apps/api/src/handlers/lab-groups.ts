import { classMembers, type Group, groups, studentLabRepos } from "@labs/db";
import { and, eq, isNull } from "drizzle-orm";
import { authedFactory } from "../factory";
import {
  groupInClass,
  labInClass,
  linkedUsers,
  resolveClassAccess,
} from "../lib/access";
import { orgRepoActivity } from "../lib/github/repo";
import { teamMembers } from "../lib/github/team";
import {
  attachPair,
  createGroupWithTeam,
  createPairRepo,
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
 *  the class's enrolled students (from the class_members display cache —
 *  BOTH roles use it as the "without a group" pool) + linked SWITCH users
 *  for everyone involved. */
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
  const pairings = await access.db
    .select({
      groupId: studentLabRepos.groupId,
      repoFullName: studentLabRepos.ghRepoFullName,
    })
    .from(studentLabRepos)
    .where(eq(studentLabRepos.labId, lab.id));
  // Work-repo activity (last push vs deadline drives the roster's status
  // chips): ONE org-repos listing covers every repo, and a failure only
  // degrades the chips (activity unknown), never the roster itself.
  let activity = new Map<
    string,
    { pushedAt: string | null; createdAt: string | null }
  >();
  if (pairings.some((p) => p.repoFullName)) {
    try {
      activity = await orgRepoActivity(
        c.env,
        access.cls.installationId,
        access.org,
      );
    } catch {}
  }
  const attached = pairings.map((p) => ({
    ...p,
    pushedAt: p.repoFullName
      ? (activity.get(p.repoFullName)?.pushedAt ?? null)
      : null,
    repoCreatedAt: p.repoFullName
      ? (activity.get(p.repoFullName)?.createdAt ?? null)
      : null,
  }));
  const students = await access.db
    .select({
      githubId: classMembers.githubId,
      login: classMembers.login,
      avatarUrl: classMembers.avatarUrl,
    })
    .from(classMembers)
    .where(
      and(
        eq(classMembers.classId, access.cls.id),
        eq(classMembers.state, "active"),
      ),
    );
  const users = await linkedUsers(access.db, [
    ...new Set([
      ...out.flatMap((g) => g.members.map((m) => String(m.id))),
      ...students.map((s) => s.githubId),
    ]),
  ]);
  return c.json({
    groups: out,
    users,
    students,
    // The lab's pairings: which groups participate + their work repos
    // (repoFullName null while the group is still forming).
    attached,
  });
});

/**
 * Create the pairing's work repo — the EXPLICIT accept-completion step for
 * group labs (user-decided): any group member (or a teacher) triggers it
 * once the group meets the lab's MIN size, which is enforced exactly here.
 * Idempotent: an existing repo is simply returned.
 */
export const createLabRepo = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const lab = await labInClass(access, c.req.param("labId"));
  const group = await groupInClass(access, c.req.param("groupId"));
  if (!lab || !group) return c.json({ error: "not_found" }, 404);

  const [pairing] = await access.db
    .select()
    .from(studentLabRepos)
    .where(
      and(
        eq(studentLabRepos.labId, lab.id),
        eq(studentLabRepos.groupId, group.id),
      ),
    );
  if (!pairing) return c.json({ error: "not_found" }, 404);
  if (pairing.ghRepoFullName) {
    return c.json({ repo: { fullName: pairing.ghRepoFullName } });
  }

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
  const min = lab.groupMode === "individual" ? 1 : (lab.minMembers ?? 1);
  if (members.length < min) {
    return c.json({ error: "group_incomplete" }, 409);
  }

  const repo = await createPairRepo(c.env, access, lab, group);
  if (repo === "name_taken") {
    return c.json({ error: "repo_name_taken" }, 409);
  }
  if (repo === "app_permissions") {
    return c.json({ error: "app_permissions" }, 409);
  }
  return c.json({ repo: { fullName: repo.fullName } });
});

/**
 * Batch-create every missing work repo for the lab (teacher only) — the
 * roster toolbar's "create N missing repositories" as ONE request instead
 * of N create+refetch round-trips. Creations run sequentially on purpose
 * (repo-creation bursts trip GitHub's abuse limits). Per-group blockers
 * (under min, orphaned team, name collision) are skipped and reported —
 * their rows simply stay "no repo" — while a permissions failure aborts:
 * it's an installation-level problem that would fail every remaining
 * create the same way.
 */
export const createMissingLabRepos = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  // The batch verb is the teacher's; students create for their own group.
  if (!access.admin) return c.json({ error: "not_found" }, 404);
  const lab = await labInClass(access, c.req.param("labId"));
  if (!lab) return c.json({ error: "not_found" }, 404);

  const pairings = await access.db
    .select()
    .from(studentLabRepos)
    .where(
      and(
        eq(studentLabRepos.labId, lab.id),
        isNull(studentLabRepos.ghRepoFullName),
      ),
    );

  const min = lab.groupMode === "individual" ? 1 : (lab.minMembers ?? 1);
  let created = 0;
  const skipped: {
    groupId: string;
    reason: "group_gone" | "group_incomplete" | "repo_name_taken";
  }[] = [];
  for (const pairing of pairings) {
    const group = await groupInClass(access, pairing.groupId);
    if (!group) {
      skipped.push({ groupId: pairing.groupId, reason: "group_gone" });
      continue;
    }
    const members = await teamMembers(
      c.env,
      access.cls.installationId,
      access.org,
      group.ghTeamSlug,
    );
    if (members === null) {
      skipped.push({ groupId: group.id, reason: "group_gone" });
      continue;
    }
    if (members.length < min) {
      skipped.push({ groupId: group.id, reason: "group_incomplete" });
      continue;
    }
    const repo = await createPairRepo(c.env, access, lab, group);
    if (repo === "name_taken") {
      skipped.push({ groupId: group.id, reason: "repo_name_taken" });
      continue;
    }
    if (repo === "app_permissions") {
      return c.json({ error: "app_permissions" }, 409);
    }
    created++;
  }
  return c.json({ created, skipped });
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
 * group (a team named after their login), attach it, AND create the work
 * repo (a solo group is always complete, so accept = repo in one click).
 * Group labs refuse — their accept path is the group UI. Idempotent.
 */
export const acceptIndividualLab = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const lab = await labInClass(access, c.req.param("labId"));
  if (!lab) return c.json({ error: "not_found" }, 404);
  if (lab.groupMode !== "individual") {
    return c.json({ error: "group_lab" }, 409);
  }

  async function finish(solo: Group) {
    if (!access || !lab) throw new Error("unreachable");
    await attachPair(access.db, lab.id, solo.id);
    const [pairing] = await access.db
      .select()
      .from(studentLabRepos)
      .where(
        and(
          eq(studentLabRepos.labId, lab.id),
          eq(studentLabRepos.groupId, solo.id),
        ),
      );
    if (pairing?.ghRepoFullName) {
      return c.json({
        ok: true,
        groupId: solo.id,
        repo: { fullName: pairing.ghRepoFullName },
      });
    }
    const repo = await createPairRepo(c.env, access, lab, solo);
    if (repo === "name_taken") {
      return c.json({ error: "repo_name_taken" }, 409);
    }
    if (repo === "app_permissions") {
      return c.json({ error: "app_permissions" }, 409);
    }
    return c.json({
      ok: true,
      groupId: solo.id,
      repo: { fullName: repo.fullName },
    });
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
    return finish(existing);
  }

  const created = await createGroupWithTeam(
    c.env,
    access,
    access.login,
    c.get("user").id,
    { autoJoin: true },
  );
  if (!created) return c.json({ error: "solo_name_taken" }, 409);
  return finish(created);
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

  // Once the work repo exists, the pairing is a deliverable — detaching
  // would orphan it. (A teacher escape hatch can come later if it bites.)
  const [pairing] = await access.db
    .select({ ghRepoFullName: studentLabRepos.ghRepoFullName })
    .from(studentLabRepos)
    .where(
      and(
        eq(studentLabRepos.labId, lab.id),
        eq(studentLabRepos.groupId, group.id),
      ),
    );
  if (pairing?.ghRepoFullName) {
    return c.json({ error: "has_repo" }, 409);
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

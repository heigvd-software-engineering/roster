import { zValidator } from "@hono/zod-validator";
import { classMembers, type Group, groups, type Lab, labs } from "@labs/db";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { authedFactory } from "../factory";
import {
  groupInClass,
  labInClass,
  linkedUsers,
  resolveClassAccess,
} from "../lib/access";
import type { AuthedEnv } from "../lib/auth/require-auth";
import { orgRepoActivity } from "../lib/github/repo";
import {
  createGroupInLab,
  createWorkRepo,
  groupsWithRosters,
  type RepoFailure,
} from "../lib/groups";

/**
 * The lab page's group surface (per-lab model, spec 2026-07-07): groups
 * belong to ONE lab, so the list is simply THIS lab's groups — no attach,
 * no cross-lab reach. Each group carries its live roster + its own work
 * repo + push activity. Creating a group is lab-scoped and may copy a roster
 * forward from another lab. Denials are 404, like everything class-scoped.
 */

const createGroupInput = z.object({
  name: z.string().trim().min(1).max(100),
  // Copy-forward: seed this new group's roster from an existing group
  // (typically the same team on a previous lab).
  copyFromGroupId: z.string().optional(),
});

/** The lab's minimum group size (individual = a group of one). */
const labMin = (lab: Lab) =>
  lab.groupMode === "individual" ? 1 : (lab.minMembers ?? 1);

/** Map a work-repo failure to its 409 — one place, so the three creation
 *  paths never drift. */
const repoFailure = (c: Context<AuthedEnv>, f: RepoFailure) =>
  c.json({ error: f === "name_taken" ? "repo_name_taken" : f }, 409);

/** This lab's groups with live rosters + work repo + push activity, plus
 *  the class's enrolled students (the "without a group" pool) and linked
 *  SWITCH users for everyone involved. */
export const listLabGroups = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const lab = await labInClass(access, c.req.param("labId"));
  if (!lab) return c.json({ error: "not_found" }, 404);

  const rows = await access.db
    .select()
    .from(groups)
    .where(eq(groups.labId, lab.id))
    .orderBy(groups.createdAt);
  const out = await groupsWithRosters(access, rows);

  // Work-repo activity (last push vs deadline drives the status chips): ONE
  // org-repos listing covers every repo; a failure only degrades the chips
  // (activity unknown), never the roster.
  let activity = new Map<
    string,
    { pushedAt: string | null; createdAt: string | null }
  >();
  if (out.some((g) => g.repoFullName)) {
    try {
      activity = await orgRepoActivity(
        c.env,
        access.cls.installationId,
        access.org,
      );
    } catch {}
  }
  const groupsOut = out.map((g) => ({
    ...g,
    pushedAt: g.repoFullName
      ? (activity.get(g.repoFullName)?.pushedAt ?? null)
      : null,
    repoCreatedAt: g.repoFullName
      ? (activity.get(g.repoFullName)?.createdAt ?? null)
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
      ...groupsOut.flatMap((g) => g.members.map((m) => String(m.id))),
      ...students.map((s) => s.githubId),
    ]),
  ]);
  return c.json({ groups: groupsOut, users, students });
});

/**
 * The caller's groups in OTHER labs of this class — the "reuse a group"
 * sources for copy-forward. Live rosters (one call per other-lab group),
 * filtered to groups the caller is a member of.
 */
export const listReusableGroups = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const lab = await labInClass(access, c.req.param("labId"));
  if (!lab) return c.json({ error: "not_found" }, 404);

  const rows = await access.db
    .select({ group: groups, labTitle: labs.title })
    .from(groups)
    .innerJoin(labs, eq(groups.labId, labs.id))
    .where(and(eq(labs.classId, access.cls.id), ne(groups.labId, lab.id)))
    .orderBy(desc(groups.createdAt));
  const rosters = await Promise.all(
    rows.map((r) => access.team.roster(r.group.ghTeamSlug)),
  );
  const mine = rows
    .map((r, i) => ({ r, members: rosters[i] }))
    .filter(({ members }) => members?.some((m) => m.login === access.login))
    .map(({ r, members }) => ({
      id: r.group.id,
      name: r.group.name,
      labTitle: r.labTitle,
      members: members ?? [],
    }));
  return c.json({ groups: mine });
});

/**
 * Create a group IN this lab (any active member). A creating STUDENT
 * auto-joins; a teacher stays out. `copyFromGroupId` seeds the roster from
 * another group's live members — members already placed in a group OF THIS
 * lab are skipped (the one-group-per-lab invariant).
 */
export const createLabGroup = authedFactory.createHandlers(
  zValidator("json", createGroupInput),
  async (c) => {
    const access = await resolveClassAccess(c, c.req.param("id"));
    if (!access) return c.json({ error: "not_found" }, 404);
    const lab = await labInClass(access, c.req.param("labId"));
    if (!lab) return c.json({ error: "not_found" }, 404);
    const { name, copyFromGroupId } = c.req.valid("json");

    let copyFromLogins: string[] | undefined;
    if (copyFromGroupId) {
      const source = await groupInClass(access, copyFromGroupId);
      if (!source) return c.json({ error: "not_found" }, 404);
      const sourceMembers = await access.team.roster(source.ghTeamSlug);
      if (sourceMembers === null) return c.json({ error: "not_found" }, 404);
      // Skip anyone already in a group of THIS lab (invariant).
      const labGroups = await access.db
        .select()
        .from(groups)
        .where(eq(groups.labId, lab.id));
      const rosters = await Promise.all(
        labGroups.map((g) => access.team.roster(g.ghTeamSlug)),
      );
      const placed = new Set(
        rosters.flatMap((r) => r?.map((m) => m.login) ?? []),
      );
      copyFromLogins = sourceMembers
        .map((m) => m.login)
        .filter((l) => !placed.has(l));
    }

    const group = await createGroupInLab(
      c.env,
      access,
      lab,
      name,
      c.get("user").id,
      {
        autoJoin: !access.admin,
        ...(copyFromLogins ? { copyFromLogins } : {}),
      },
    );
    if (group === "name_taken") return c.json({ error: "name_taken" }, 409);
    return c.json({
      group: { id: group.id, name: group.name, slug: group.ghTeamSlug },
    });
  },
);

/**
 * Create the group's work repo — the EXPLICIT accept-completion step: any
 * group member (or a teacher) triggers it once the group meets the lab's
 * MIN size, enforced here. Idempotent: an existing repo is returned.
 */
export const createLabRepo = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const lab = await labInClass(access, c.req.param("labId"));
  const group = await groupInClass(access, c.req.param("groupId"));
  if (!lab || !group || group.labId !== lab.id) {
    return c.json({ error: "not_found" }, 404);
  }
  if (group.ghRepoFullName) {
    return c.json({ repo: { fullName: group.ghRepoFullName } });
  }

  const members = await access.team.roster(group.ghTeamSlug);
  if (members === null) return c.json({ error: "not_found" }, 404);
  if (!access.admin && !members.some((m) => m.login === access.login)) {
    return c.json({ error: "not_found" }, 404);
  }
  if (members.length < labMin(lab)) {
    return c.json({ error: "group_incomplete" }, 409);
  }

  const repo = await createWorkRepo(c.env, access, lab, group);
  if (typeof repo === "string") return repoFailure(c, repo);
  return c.json({ repo: { fullName: repo.fullName } });
});

/**
 * Batch-create every missing work repo for the lab (teacher only) — ONE
 * request instead of N create+refetch round-trips. Sequential on purpose
 * (repo-creation bursts trip GitHub's abuse limits). Per-group blockers
 * (under min, orphaned team, name collision) are skipped and reported; a
 * template/permissions failure aborts (it fails every remaining create the
 * same way — one bad template, one missing App permission).
 */
export const createMissingLabRepos = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAccess(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  if (!access.admin) return c.json({ error: "not_found" }, 404);
  const lab = await labInClass(access, c.req.param("labId"));
  if (!lab) return c.json({ error: "not_found" }, 404);

  const missing = await access.db
    .select()
    .from(groups)
    .where(and(eq(groups.labId, lab.id), isNull(groups.ghRepoFullName)));

  let created = 0;
  const skipped: {
    groupId: string;
    reason: "group_gone" | "group_incomplete" | "repo_name_taken";
  }[] = [];
  for (const group of missing) {
    const members = await access.team.roster(group.ghTeamSlug);
    if (members === null) {
      skipped.push({ groupId: group.id, reason: "group_gone" });
      continue;
    }
    if (members.length < labMin(lab)) {
      skipped.push({ groupId: group.id, reason: "group_incomplete" });
      continue;
    }
    const repo = await createWorkRepo(c.env, access, lab, group);
    if (repo === "name_taken") {
      skipped.push({ groupId: group.id, reason: "repo_name_taken" });
      continue;
    }
    // template_error / app_permissions hit every group the same way — abort.
    if (typeof repo === "string") return repoFailure(c, repo);
    created++;
  }
  return c.json({ created, skipped });
});

/**
 * One-click accept for INDIVIDUAL labs: find-or-create the caller's SOLO
 * group IN THIS LAB (a team named after their login), AND create the work
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
    if (solo.ghRepoFullName) {
      return c.json({
        ok: true,
        groupId: solo.id,
        repo: { fullName: solo.ghRepoFullName },
      });
    }
    const repo = await createWorkRepo(c.env, access, lab, solo);
    if (typeof repo === "string") return repoFailure(c, repo);
    return c.json({
      ok: true,
      groupId: solo.id,
      repo: { fullName: repo.fullName },
    });
  }

  // The solo group for THIS lab, by naming convention (name = login).
  const [existing] = await access.db
    .select()
    .from(groups)
    .where(and(eq(groups.labId, lab.id), eq(groups.name, access.login)));
  if (existing) {
    const members = await access.team.roster(existing.ghTeamSlug);
    if (members?.length !== 1 || members[0]?.login !== access.login) {
      return c.json({ error: "solo_name_taken" }, 409);
    }
    return finish(existing);
  }

  const created = await createGroupInLab(
    c.env,
    access,
    lab,
    access.login,
    c.get("user").id,
    { autoJoin: true },
  );
  if (created === "name_taken") {
    return c.json({ error: "solo_name_taken" }, 409);
  }
  return finish(created);
});

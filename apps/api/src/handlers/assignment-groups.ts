import { zValidator } from "@hono/zod-validator";
import {
  type Assignment,
  assignments,
  classMembers,
  type Group,
  groups,
} from "@roster/db";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { authedFactory } from "../factory";
import type { AuthedEnv } from "../lib/auth/require-auth";
import {
  findAssignmentInClass,
  findGroupInClass,
  resolveClassAsMember,
} from "../lib/class-scope";
import { memberUserIds } from "../lib/enrollment";
import {
  orgRepoActivity,
  type RepoFailure,
  type RepoLastCommit,
  reposLastCommit,
} from "../lib/github/repo";
import {
  cachedRoster,
  cachedRosters,
  replaceGroupMembers,
} from "../lib/group-members";
import {
  assignmentStarted,
  createGroupInAssignment,
  createWorkRepo,
  groupsWithRosters,
  regrantWorkRepo,
  resolveRepoStatuses,
  reuseBlocker,
} from "../lib/groups";
import { profilesByGithubId } from "../lib/identity";

/**
 * The assignment page's group surface (per-assignment model, spec 2026-07-07):
 * groups belong to one assignment, so the list is this assignment's groups,
 * with no attach and no cross-assignment reach. Each group carries its live
 * roster, its own work repo, and push activity. Creating a group is
 * assignment-scoped and may copy a roster forward from another assignment.
 * Denials are 404, like everything class-scoped.
 */

// AGENTS EXCEPTION (rule 6): not drizzle-zod, because nothing here derives
// from the table. `name`'s constraints are business rules (the column is plain
// text) and `copyFromGroupId` is an operation parameter, not a column, so no
// column list can drift. Revisit if this grows row-shaped fields.
const createGroupInput = z.object({
  name: z.string().trim().min(1).max(100),
  // Copy-forward: seed this new group's roster from an existing group
  // (typically the same team on a previous assignment).
  copyFromGroupId: z.string().optional(),
});

/** The assignment's minimum group size (individual = a group of one). */
const assignmentMin = (assignment: Assignment) =>
  assignment.groupMode === "individual" ? 1 : (assignment.minMembers ?? 1);

/** Logins already in a group of this assignment, the one-group-per-assignment invariant as a
 *  set (cached rosters: one query, zero GitHub calls). */
async function placedLoginsInAssignment(
  db: Parameters<typeof cachedRosters>[0],
  assignmentId: string,
): Promise<Set<string>> {
  const assignmentGroups = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.assignmentId, assignmentId));
  const rosters = await cachedRosters(
    db,
    assignmentGroups.map((g) => g.id),
  );
  return new Set([...rosters.values()].flatMap((r) => r.map((m) => m.login)));
}

/** Logins with a live class membership. `teacher` counts, since teachers are
 *  org members too; only `pending` (invited, never joined the org) is out,
 *  along with anyone whose row is gone because they left. Display cache, so
 *  GitHub stays the final arbiter when the copy runs. */
async function classLoginsSet(
  db: Parameters<typeof cachedRosters>[0],
  classId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ login: classMembers.login })
    .from(classMembers)
    .where(
      and(
        eq(classMembers.classId, classId),
        inArray(classMembers.state, ["active", "teacher"]),
      ),
    );
  return new Set(rows.flatMap((r) => (r.login === null ? [] : [r.login])));
}

/** Map a work-repo failure to its 409 in one place, so the three creation
 *  paths never drift. */
const repoFailure = (c: Context<AuthedEnv>, f: RepoFailure) =>
  c.json({ error: f === "name_taken" ? "repo_name_taken" : f }, 409);

/** This assignment's groups with live rosters, work repo, and push activity, plus the
 * class's enrolled students (the "without a group" pool) and linked SWITCH
 * users for everyone involved. It also carries the assignment row, the class
 * identity, and the caller's role: the assignment page's one request, so it
 * never re-fetches the whole class list to render its header. */
export const listAssignmentGroups = authedFactory.createHandlers(async (c) => {
  // allowPending: the student page must tell "accept your invitation first"
  // apart from "not your class", so a pending invitee gets the header data and
  // an empty roster, never a 404. They already see the assignment through the
  // enrolled list, so this reveals nothing new.
  const access = await resolveClassAsMember(c, c.req.param("id"), {
    allowPending: true,
  });
  if (!access) return c.json({ error: "not_found" }, 404);
  const assignment = await findAssignmentInClass(
    access,
    c.req.param("assignmentId"),
  );
  if (!assignment) return c.json({ error: "not_found" }, 404);

  const head = {
    assignment,
    class: { name: access.cls.name, login: access.org },
    role: access.isTeacher ? ("teacher" as const) : ("student" as const),
    membershipState: access.membershipState,
  };
  if (access.membershipState === "pending") {
    return c.json({ ...head, groups: [], users: [], students: [] });
  }
  // The start gate, list edition: a student on a not-yet-open assignment gets
  // the head (a direct URL renders "starts …", never a 404) and empty lists, so
  // pre-formed rosters stay invisible until the start. Teachers see all.
  if (!access.isTeacher && !assignmentStarted(assignment)) {
    return c.json({ ...head, groups: [], users: [], students: [] });
  }

  const rows = await access.db
    .select()
    .from(groups)
    .where(eq(groups.assignmentId, assignment.id))
    .orderBy(groups.createdAt);
  const out = await groupsWithRosters(access, rows);

  // Work-repo activity (last push vs deadline drives the status chips): one
  // org-repos listing covers every repo, and a failure only degrades the
  // chips (activity unknown), never the roster.
  let activity = new Map<
    string,
    { pushedAt: string | null; createdAt: string | null }
  >();
  let activityFetched = false;
  if (out.some((g) => g.repoFullName)) {
    try {
      activity = await orgRepoActivity(
        c.env,
        access.cls.installationId,
        access.org,
      );
      activityFetched = true;
    } catch {}
  }
  // A linked repo absent from that listing is a suspect (deleted directly on
  // GitHub, or renamed; the listing can't tell which), confirmed per suspect
  // below. Gated on the listing having succeeded: an empty `activity` from a
  // failed fetch must never read as "every repo is gone".
  const repoStatuses = activityFetched
    ? await resolveRepoStatuses(c.env, access, rows, new Set(activity.keys()))
    : new Map<string, { status: "ok" | "missing"; repoFullName: string }>();
  // The byline ("last commit by @login", message): one GraphQL batch over the
  // assignment's linked repos, after rename resolution. Same deal as the
  // activity listing: a failure only loses the byline.
  const linkedRepos = out
    .map((g) =>
      g.repoFullName
        ? (repoStatuses.get(g.id)?.repoFullName ?? g.repoFullName)
        : null,
    )
    .filter((name): name is string => name !== null);
  let lastCommits = new Map<string, RepoLastCommit>();
  if (activityFetched && linkedRepos.length > 0) {
    try {
      lastCommits = await reposLastCommit(
        c.env,
        access.cls.installationId,
        linkedRepos,
      );
    } catch {}
  }
  const groupsOut = out.map((g) => {
    const resolved = g.repoFullName ? repoStatuses.get(g.id) : undefined;
    const repoFullName = resolved?.repoFullName ?? g.repoFullName;
    return {
      ...g,
      repoFullName,
      repoStatus: resolved?.status ?? ("ok" as const),
      pushedAt: repoFullName
        ? (activity.get(repoFullName)?.pushedAt ?? null)
        : null,
      repoCreatedAt: repoFullName
        ? (activity.get(repoFullName)?.createdAt ?? null)
        : null,
      lastCommit: repoFullName ? (lastCommits.get(repoFullName) ?? null) : null,
    };
  });

  // Active students and teachers, each with their state: the "without a
  // group" strip shows only students, but the teacher's add-picker must be
  // able to (re)place anyone the server would accept. Removing a teacher from
  // a group must not make them unaddable.
  const memberRows = await access.db
    .select({
      githubId: classMembers.githubId,
      login: classMembers.login,
      avatarUrl: classMembers.avatarUrl,
      state: classMembers.state,
    })
    .from(classMembers)
    .where(
      and(
        eq(classMembers.classId, access.cls.id),
        inArray(classMembers.state, ["active", "teacher"]),
      ),
    );
  // `githubId` is nullable on the table for one case, an invitation nobody can
  // attribute to a user, which the `active`/`teacher` filter above already
  // excluded. Narrowing here rather than at the call sites keeps that
  // nullability out of the response type: the client asks about people who can
  // join a group, and every one of them has a user id.
  const students = memberRows.flatMap((m) =>
    m.githubId === null ? [] : [{ ...m, githubId: m.githubId }],
  );
  const users = await profilesByGithubId(access.db, [
    ...new Set([
      ...groupsOut.flatMap((g) => g.members.map((m) => String(m.id))),
      ...memberUserIds(students),
    ]),
  ]);
  return c.json({ ...head, groups: groupsOut, users, students });
});

/**
 * Groups in other assignments of this class: the "reuse a group" sources for
 * copy-forward, with rosters from the cache. A student sees only groups they
 * belong to (self-organising); a teacher manages groups top-down and sees
 * every group in the class.
 */
export const listReusableGroups = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsMember(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const assignment = await findAssignmentInClass(
    access,
    c.req.param("assignmentId"),
  );
  if (!assignment) return c.json({ error: "not_found" }, 404);

  const rows = await access.db
    .select({ group: groups, assignmentTitle: assignments.title })
    .from(groups)
    .innerJoin(assignments, eq(groups.assignmentId, assignments.id))
    .where(
      and(
        eq(assignments.classId, access.cls.id),
        ne(groups.assignmentId, assignment.id),
      ),
    )
    .orderBy(desc(groups.createdAt));
  // Cached rosters: one query, where this once cost one GitHub call per group.
  const rosters = await cachedRosters(
    access.db,
    rows.map((r) => r.group.id),
  );
  const withRosters = rows.map((r) => ({
    r,
    members: rosters.get(r.group.id) ?? [],
  }));
  const visible = access.isTeacher
    ? withRosters
    : withRosters.filter(({ members }) =>
        members.some((m) => m.login === access.callerLogin),
      );
  // Annotate each source with why it can't be copied (or null): the dialog
  // renders the verdict, and createAssignmentGroup re-checks as the backstop.
  const placed = await placedLoginsInAssignment(access.db, assignment.id);
  const inClass = await classLoginsSet(access.db, access.cls.id);
  const out = visible.map(({ r, members }) => ({
    id: r.group.id,
    name: r.group.name,
    assignmentTitle: r.assignmentTitle,
    members,
    blocker: reuseBlocker(assignment, members, placed, inClass),
  }));
  // Linked SWITCH identities for everyone shown, the same correlation the
  // assignment page does, so the dialog names members by the same rule
  // (personIdentity).
  const users = await profilesByGithubId(access.db, [
    ...new Set(out.flatMap((g) => g.members.map((m) => String(m.id)))),
  ]);
  return c.json({ groups: out, users });
});

/**
 * Create a group in this assignment (any active member). A creating student
 * auto-joins; a teacher stays out. `copyFromGroupId` seeds the roster from
 * another group's members, skipping anyone already placed in a group of this
 * assignment (the one-group-per-assignment invariant).
 */
export const createAssignmentGroup = authedFactory.createHandlers(
  zValidator("json", createGroupInput),
  async (c) => {
    const access = await resolveClassAsMember(c, c.req.param("id"));
    if (!access) return c.json({ error: "not_found" }, 404);
    const assignment = await findAssignmentInClass(
      access,
      c.req.param("assignmentId"),
    );
    if (!assignment) return c.json({ error: "not_found" }, 404);
    // The start gate: before the assignment opens, students change nothing (no
    // groups, no repos, no starter code). Teachers pass (escape hatch).
    if (!access.isTeacher && !assignmentStarted(assignment)) {
      return c.json({ error: "not_started" }, 409);
    }
    const { name, copyFromGroupId } = c.req.valid("json");

    let copyFromLogins: string[] | undefined;
    if (copyFromGroupId) {
      const source = await findGroupInClass(access, copyFromGroupId);
      if (!source) return c.json({ error: "not_found" }, 404);
      const sourceMembers = await cachedRoster(access.db, source.id);
      // A student reuses only their own groups. The reusable list already
      // scopes what they see; this is the backstop against a posted id,
      // without which creating-with-copy would let any student conscript
      // classmates into a team of their making. Teachers manage top-down.
      if (
        !access.isTeacher &&
        !sourceMembers.some((m) => m.login === access.callerLogin)
      ) {
        return c.json({ error: "not_found" }, 404);
      }
      // All-or-nothing reuse: any blocker refuses the whole copy. The dialog
      // greys these out and the API is the backstop (joinGroup's group_full
      // pattern), so a race (someone joins a group of this assignment between
      // dialog-open and submit) answers 409, never a partial team.
      const blocker = reuseBlocker(
        assignment,
        sourceMembers,
        await placedLoginsInAssignment(access.db, assignment.id),
        await classLoginsSet(access.db, access.cls.id),
      );
      if (blocker) return c.json({ error: blocker.reason }, 409);
      copyFromLogins = sourceMembers.map((m) => m.login);
    }

    const group = await createGroupInAssignment(
      c.env,
      access,
      assignment,
      name,
      c.get("user").id,
      {
        autoJoin: !access.isTeacher,
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
 * Create the group's work repo, the explicit accept-completion step: any group
 * member (or a teacher) triggers it once the group meets the assignment's min
 * size, enforced here. Idempotent: an existing repo is returned.
 *
 * SECURITY: creation is the group's freeze moment (membership locks), and it
 * is create-only. A name collision with any existing org repo answers
 * repo_name_taken, never adoption, so students can't capture the teacher's
 * private repos by naming their group after one (see createWorkRepo).
 */
export const createAssignmentRepo = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsMember(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const assignment = await findAssignmentInClass(
    access,
    c.req.param("assignmentId"),
  );
  const group = await findGroupInClass(access, c.req.param("groupId"));
  if (!assignment || !group || group.assignmentId !== assignment.id) {
    return c.json({ error: "not_found" }, 404);
  }
  // The start gate precedes even the idempotent return: a teacher may have
  // pre-created the repo (escape hatch), and that must not open it to students
  // early, so a pre-start student gets not_started, never the repo.
  if (!access.isTeacher && !assignmentStarted(assignment)) {
    return c.json({ error: "not_started" }, 409);
  }
  if (group.ghRepoFullName) {
    // Idempotent hit, and the heal path for a create that wrote the row and
    // died before the grant (createWorkRepo persists first, on purpose).
    await regrantWorkRepo(c.env, access, group);
    return c.json({ repo: { fullName: group.ghRepoFullName } });
  }

  // Live roster, not the cache: this authorizes (only a member or the teacher
  // may create the group's repo) and gates an irreversible create.
  const members = await access.team.roster(group.ghTeamSlug);
  if (members === null) return c.json({ error: "not_found" }, 404);
  if (
    !access.isTeacher &&
    !members.some((m) => m.login === access.callerLogin)
  ) {
    return c.json({ error: "not_found" }, 404);
  }
  if (members.length < assignmentMin(assignment)) {
    return c.json({ error: "group_incomplete" }, 409);
  }
  // We hold the live roster, so mirror it. Free, and it keeps the cache honest
  // on a path a student reaches without touching the membership endpoints.
  await replaceGroupMembers(access.db, group.id, members);

  const repo = await createWorkRepo(c.env, access, assignment, group);
  if (typeof repo === "string") return repoFailure(c, repo);
  return c.json({ repo: { fullName: repo.fullName } });
});

/**
 * Batch-create every missing work repo for the assignment (teacher only): one
 * request instead of N create+refetch round-trips. Sequential on purpose,
 * because repo-creation bursts trip GitHub's abuse limits. Per-group blockers
 * (under min, orphaned team, name collision) are skipped and reported; a
 * template or permissions failure aborts, since one bad template or one missing
 * App permission fails every remaining create the same way.
 *
 * SECURITY: create-only like every repo path. A name collision is a skip
 * (repo_name_taken), never an adoption, even on this teacher-triggered batch:
 * a maliciously named group must not capture an existing repo because the
 * teacher clicked the batch button.
 */
export const createMissingAssignmentRepos = authedFactory.createHandlers(
  async (c) => {
    const access = await resolveClassAsMember(c, c.req.param("id"));
    if (!access) return c.json({ error: "not_found" }, 404);
    if (!access.isTeacher) return c.json({ error: "not_found" }, 404);
    const assignment = await findAssignmentInClass(
      access,
      c.req.param("assignmentId"),
    );
    if (!assignment) return c.json({ error: "not_found" }, 404);

    const missing = await access.db
      .select()
      .from(groups)
      .where(
        and(
          eq(groups.assignmentId, assignment.id),
          isNull(groups.ghRepoFullName),
        ),
      );

    let created = 0;
    const skipped: {
      groupId: string;
      reason: "group_gone" | "group_incomplete" | "repo_name_taken";
    }[] = [];
    for (const group of missing) {
      // Live roster: "is the group complete" gates an irreversible repo create.
      const members = await access.team.roster(group.ghTeamSlug);
      if (members === null) {
        skipped.push({ groupId: group.id, reason: "group_gone" });
        continue;
      }
      if (members.length < assignmentMin(assignment)) {
        skipped.push({ groupId: group.id, reason: "group_incomplete" });
        continue;
      }
      await replaceGroupMembers(access.db, group.id, members);
      const repo = await createWorkRepo(c.env, access, assignment, group);
      if (repo === "name_taken") {
        skipped.push({ groupId: group.id, reason: "repo_name_taken" });
        continue;
      }
      // template_error / app_permissions hit every group the same way, so
      // abort.
      if (typeof repo === "string") return repoFailure(c, repo);
      created++;
    }
    return c.json({ created, skipped });
  },
);

/**
 * One-click accept for individual assignments: find or create the caller's solo
 * group in this assignment (a team named after their login) and create the work
 * repo. A solo group is always complete, so accept means repo in one click.
 * Group assignments refuse; their accept path is the group UI. Idempotent.
 *
 * SECURITY: same create-only rule as createAssignmentRepo. A repo-name
 * collision refuses (repo_name_taken), never adopts an existing repo.
 */
export const acceptIndividualAssignment = authedFactory.createHandlers(
  async (c) => {
    const access = await resolveClassAsMember(c, c.req.param("id"));
    if (!access) return c.json({ error: "not_found" }, 404);
    const assignment = await findAssignmentInClass(
      access,
      c.req.param("assignmentId"),
    );
    if (!assignment) return c.json({ error: "not_found" }, 404);
    if (assignment.groupMode !== "individual") {
      return c.json({ error: "group_assignment" }, 409);
    }
    if (!access.isTeacher && !assignmentStarted(assignment)) {
      return c.json({ error: "not_started" }, 409);
    }

    async function finish(solo: Group) {
      if (!access || !assignment) throw new Error("unreachable");
      if (solo.ghRepoFullName) {
        // Same heal as createAssignmentRepo: re-assert the grant on the
        // recorded repo.
        await regrantWorkRepo(c.env, access, solo);
        return c.json({
          ok: true,
          groupId: solo.id,
          repo: { fullName: solo.ghRepoFullName },
        });
      }
      const repo = await createWorkRepo(c.env, access, assignment, solo);
      if (typeof repo === "string") return repoFailure(c, repo);
      return c.json({
        ok: true,
        groupId: solo.id,
        repo: { fullName: repo.fullName },
      });
    }

    // The solo group for this assignment, by naming convention (name = login).
    const [existing] = await access.db
      .select()
      .from(groups)
      .where(
        and(
          eq(groups.assignmentId, assignment.id),
          eq(groups.name, access.callerLogin),
        ),
      );
    if (existing) {
      // Live roster: this decides whether the solo team is really the caller's.
      // Three ways it can fail, and they are not the same problem. The student
      // can act on one, and only a teacher on the others, so each answers with
      // its own code rather than one opaque conflict.
      const members = await access.team.roster(existing.ghTeamSlug);
      if (members === null) {
        // The group row points at a team GitHub no longer has. Recreating it
        // would mean writing to the org on a student's behalf, which this route
        // never does; the audit page repairs it.
        return c.json({ error: "solo_team_missing" }, 409);
      }
      if (members.length === 0) {
        // The team exists and nobody is in it. Two ways to get here, both
        // outside the student's control: they were removed from the org (which
        // drops them from every team, and rejoining does not put them back), or
        // a teacher removed them from this group. Only a teacher can put them
        // back, and adopting the team on their say-so is the capture this route
        // refuses to do.
        return c.json({ error: "solo_team_empty" }, 409);
      }
      if (members.length !== 1 || members[0]?.login !== access.callerLogin) {
        // Somebody else holds the group carrying this login, the one case that
        // is genuinely a name collision.
        return c.json({ error: "solo_name_taken" }, 409);
      }
      // Mirror it. Without this, an accept on an already-existing solo group
      // answers 200 while `group_members` stays empty, and the student's own
      // page, which finds their group by looking for themselves in its roster,
      // shows nothing.
      await replaceGroupMembers(access.db, existing.id, members);
      return finish(existing);
    }

    const created = await createGroupInAssignment(
      c.env,
      access,
      assignment,
      access.callerLogin,
      c.get("user").id,
      { autoJoin: true },
    );
    if (created === "name_taken") {
      return c.json({ error: "solo_name_taken" }, 409);
    }
    return finish(created);
  },
);

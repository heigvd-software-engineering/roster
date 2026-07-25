import { zValidator } from "@hono/zod-validator";
import { classMembers, type Group, groups, type Lab, labs } from "@roster/db";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { authedFactory } from "../factory";
import type { AuthedEnv } from "../lib/auth/require-auth";
import {
  findGroupInClass,
  findLabInClass,
  resolveClassAsMember,
} from "../lib/class-scope";
import { memberUserIds } from "../lib/enrollment";
import { orgRepoActivity, type RepoFailure } from "../lib/github/repo";
import {
  cachedRoster,
  cachedRosters,
  replaceGroupMembers,
} from "../lib/group-members";
import {
  createGroupInLab,
  createWorkRepo,
  groupsWithRosters,
  labStarted,
  regrantWorkRepo,
  resolveRepoStatuses,
  reuseBlocker,
} from "../lib/groups";
import { profilesByGithubId } from "../lib/identity";

/**
 * The lab page's group surface (per-lab model, spec 2026-07-07): groups
 * belong to ONE lab, so the list is simply THIS lab's groups — no attach,
 * no cross-lab reach. Each group carries its live roster + its own work
 * repo + push activity. Creating a group is lab-scoped and may copy a roster
 * forward from another lab. Denials are 404, like everything class-scoped.
 */

// AGENTS EXCEPTION (rule 6): not drizzle-zod — nothing here derives from the
// table. `name`'s constraints are business rules (the column is plain text)
// and `copyFromGroupId` is an operation parameter, not a column, so there is
// no column list to drift. Revisit if this grows row-shaped fields.
const createGroupInput = z.object({
  name: z.string().trim().min(1).max(100),
  // Copy-forward: seed this new group's roster from an existing group
  // (typically the same team on a previous lab).
  copyFromGroupId: z.string().optional(),
});

/** The lab's minimum group size (individual = a group of one). */
const labMin = (lab: Lab) =>
  lab.groupMode === "individual" ? 1 : (lab.minMembers ?? 1);

/** Logins already in a group OF THIS LAB — the one-group-per-lab invariant,
 *  as a set (cached rosters: one query, zero GitHub calls). */
async function placedLoginsInLab(
  db: Parameters<typeof cachedRosters>[0],
  labId: string,
): Promise<Set<string>> {
  const labGroups = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.labId, labId));
  const rosters = await cachedRosters(
    db,
    labGroups.map((g) => g.id),
  );
  return new Set([...rosters.values()].flatMap((r) => r.map((m) => m.login)));
}

/** Logins with a LIVE class membership. `teacher` counts — they're org
 *  members too; only `pending` (invited, never joined the org) is out, along
 *  with anyone whose row is gone because they left. Display-cache caveat
 *  applies: GitHub stays the final arbiter when the copy actually runs. */
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

/** Map a work-repo failure to its 409 — one place, so the three creation
 *  paths never drift. */
const repoFailure = (c: Context<AuthedEnv>, f: RepoFailure) =>
  c.json({ error: f === "name_taken" ? "repo_name_taken" : f }, 409);

/** This lab's groups with live rosters + work repo + push activity, plus
 *  the class's enrolled students (the "without a group" pool) and linked
 *  SWITCH users for everyone involved. Also carries the lab row, the class
 *  identity, and the caller's role — the lab page's ONE request, so it
 *  never re-fetches the whole class list just to render its header. */
export const listLabGroups = authedFactory.createHandlers(async (c) => {
  // allowPending: the student page must tell "accept your invitation first"
  // apart from "not your class" — a pending invitee gets the header data and
  // an empty roster, never a 404. They already see the lab through the
  // enrolled list, so this reveals nothing new.
  const access = await resolveClassAsMember(c, c.req.param("id"), {
    allowPending: true,
  });
  if (!access) return c.json({ error: "not_found" }, 404);
  const lab = await findLabInClass(access, c.req.param("labId"));
  if (!lab) return c.json({ error: "not_found" }, 404);

  const head = {
    lab,
    class: { name: access.cls.name, login: access.org },
    role: access.isTeacher ? ("teacher" as const) : ("student" as const),
    membershipState: access.membershipState,
  };
  if (access.membershipState === "pending") {
    return c.json({ ...head, groups: [], users: [], students: [] });
  }
  // The start gate, list edition: a student on a not-yet-open lab gets the
  // head (a direct URL renders "starts …", never a 404) and EMPTY lists —
  // pre-formed rosters stay invisible until the start. Teachers see all.
  if (!access.isTeacher && !labStarted(lab)) {
    return c.json({ ...head, groups: [], users: [], students: [] });
  }

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
  // A linked repo absent from that listing is a SUSPECT (deleted directly on
  // GitHub, or renamed — the listing can't tell which): confirmed per suspect
  // below. Gated on the listing itself having succeeded — an empty `activity`
  // from a failed fetch must never read as "every repo is gone".
  const repoStatuses = activityFetched
    ? await resolveRepoStatuses(c.env, access, rows, new Set(activity.keys()))
    : new Map<string, { status: "ok" | "missing"; repoFullName: string }>();
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
    };
  });

  // Active students AND teachers, each with their state: the "without a
  // group" strip shows only students, but the teacher's add-picker must be
  // able to (re)place anyone the server would accept — removing a teacher
  // from a group must not make them unaddable.
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
  // `githubId` is nullable on the table for ONE case — an invitation nobody
  // can attribute to a user — which the `active`/`teacher` filter above has
  // already excluded. Narrowing here rather than at the call sites keeps that
  // nullability out of the response type entirely: the client is asking about
  // people who can join a group, and every one of them has a user id.
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
 * Groups in OTHER labs of this class — the "reuse a group" sources for
 * copy-forward. Live rosters (one call per other-lab group). A student sees
 * only groups they're a member of (self-organising); a teacher manages groups
 * top-down and sees every group in the class.
 */
export const listReusableGroups = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsMember(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const lab = await findLabInClass(access, c.req.param("labId"));
  if (!lab) return c.json({ error: "not_found" }, 404);

  const rows = await access.db
    .select({ group: groups, labTitle: labs.title })
    .from(groups)
    .innerJoin(labs, eq(groups.labId, labs.id))
    .where(and(eq(labs.classId, access.cls.id), ne(groups.labId, lab.id)))
    .orderBy(desc(groups.createdAt));
  // Cached rosters: ONE query, where this was one GitHub call per other-lab group.
  const rosters = await cachedRosters(
    access.db,
    rows.map((r) => r.group.id),
  );
  const withRosters = rows.map((r) => ({
    r,
    members: rosters.get(r.group.id) ?? [],
  }));
  // Students reuse only their own groups; teachers can reuse any group in the class.
  const visible = access.isTeacher
    ? withRosters
    : withRosters.filter(({ members }) =>
        members.some((m) => m.login === access.callerLogin),
      );
  // Annotate each source with WHY it can't be copied (or null): the dialog
  // renders the verdict; createLabGroup re-checks it as the backstop.
  const placed = await placedLoginsInLab(access.db, lab.id);
  const inClass = await classLoginsSet(access.db, access.cls.id);
  const out = visible.map(({ r, members }) => ({
    id: r.group.id,
    name: r.group.name,
    labTitle: r.labTitle,
    members,
    blocker: reuseBlocker(lab, members, placed, inClass),
  }));
  // Linked SWITCH identities for everyone shown — same correlation the lab
  // page does, so the dialog names members by the same rule (personIdentity).
  const users = await profilesByGithubId(access.db, [
    ...new Set(out.flatMap((g) => g.members.map((m) => String(m.id)))),
  ]);
  return c.json({ groups: out, users });
});

/**
 * Create a group IN this lab (any active member). A creating STUDENT
 * auto-joins; a teacher stays out. `copyFromGroupId` seeds the roster from
 * another group's members — members already placed in a group OF THIS
 * lab are skipped (the one-group-per-lab invariant).
 */
export const createLabGroup = authedFactory.createHandlers(
  zValidator("json", createGroupInput),
  async (c) => {
    const access = await resolveClassAsMember(c, c.req.param("id"));
    if (!access) return c.json({ error: "not_found" }, 404);
    const lab = await findLabInClass(access, c.req.param("labId"));
    if (!lab) return c.json({ error: "not_found" }, 404);
    // The start gate: before the lab opens, students change nothing — no
    // groups, no repos, no starter code. Teachers pass (escape hatch).
    if (!access.isTeacher && !labStarted(lab)) {
      return c.json({ error: "not_started" }, 409);
    }
    const { name, copyFromGroupId } = c.req.valid("json");

    let copyFromLogins: string[] | undefined;
    if (copyFromGroupId) {
      const source = await findGroupInClass(access, copyFromGroupId);
      if (!source) return c.json({ error: "not_found" }, 404);
      const sourceMembers = await cachedRoster(access.db, source.id);
      // A student reuses only THEIR OWN groups (the reusable list already
      // scopes what they see; this is the backstop against a posted id) —
      // otherwise creating-with-copy would let any student conscript
      // classmates into a team of their making. Teachers manage top-down.
      if (
        !access.isTeacher &&
        !sourceMembers.some((m) => m.login === access.callerLogin)
      ) {
        return c.json({ error: "not_found" }, 404);
      }
      // All-or-nothing reuse: any blocker refuses the whole copy. The dialog
      // greys these out; the API is the backstop (joinGroup's group_full
      // pattern), so a race — someone joins a group of this lab between
      // dialog-open and submit — answers 409, never a partial team.
      const blocker = reuseBlocker(
        lab,
        sourceMembers,
        await placedLoginsInLab(access.db, lab.id),
        await classLoginsSet(access.db, access.cls.id),
      );
      if (blocker) return c.json({ error: blocker.reason }, 409);
      copyFromLogins = sourceMembers.map((m) => m.login);
    }

    const group = await createGroupInLab(
      c.env,
      access,
      lab,
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
 * Create the group's work repo — the EXPLICIT accept-completion step: any
 * group member (or a teacher) triggers it once the group meets the lab's
 * MIN size, enforced here. Idempotent: an existing repo is returned.
 *
 * SECURITY: creation is the group's freeze moment (membership locks), and it
 * is CREATE-only — a name collision with ANY existing org repo answers
 * repo_name_taken, never adoption, so students can't capture the teacher's
 * private repos by naming their group after one (see createWorkRepo).
 */
export const createLabRepo = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsMember(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const lab = await findLabInClass(access, c.req.param("labId"));
  const group = await findGroupInClass(access, c.req.param("groupId"));
  if (!lab || !group || group.labId !== lab.id) {
    return c.json({ error: "not_found" }, 404);
  }
  // The start gate precedes even the idempotent return: a teacher may have
  // pre-created the repo (escape hatch) — that must not open it to students
  // early, so a pre-start student gets not_started, never the repo.
  if (!access.isTeacher && !labStarted(lab)) {
    return c.json({ error: "not_started" }, 409);
  }
  if (group.ghRepoFullName) {
    // Idempotent hit — and the HEAL path for a create that wrote the row and
    // died before the grant (createWorkRepo persists first, on purpose).
    await regrantWorkRepo(c.env, access, group);
    return c.json({ repo: { fullName: group.ghRepoFullName } });
  }

  // LIVE roster, not the cache: this authorizes (only a member or the teacher
  // may create the group's repo) and gates an irreversible create.
  const members = await access.team.roster(group.ghTeamSlug);
  if (members === null) return c.json({ error: "not_found" }, 404);
  if (
    !access.isTeacher &&
    !members.some((m) => m.login === access.callerLogin)
  ) {
    return c.json({ error: "not_found" }, 404);
  }
  if (members.length < labMin(lab)) {
    return c.json({ error: "group_incomplete" }, 409);
  }
  // We hold the live roster; mirror it. Free, and it keeps the cache honest on a
  // path a student reaches without ever touching the membership endpoints.
  await replaceGroupMembers(access.db, group.id, members);

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
 *
 * SECURITY: CREATE-only like every repo path — a name collision is a skip
 * (repo_name_taken), never an adoption, even on this teacher-triggered
 * batch: a maliciously named group must not capture an existing repo just
 * because the teacher clicked the batch button.
 */
export const createMissingLabRepos = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsMember(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  if (!access.isTeacher) return c.json({ error: "not_found" }, 404);
  const lab = await findLabInClass(access, c.req.param("labId"));
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
    // LIVE roster: "is the group complete" gates an irreversible repo create.
    const members = await access.team.roster(group.ghTeamSlug);
    if (members === null) {
      skipped.push({ groupId: group.id, reason: "group_gone" });
      continue;
    }
    if (members.length < labMin(lab)) {
      skipped.push({ groupId: group.id, reason: "group_incomplete" });
      continue;
    }
    await replaceGroupMembers(access.db, group.id, members);
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
 *
 * SECURITY: same CREATE-only rule as createLabRepo — a repo-name collision
 * refuses (repo_name_taken), never adopts an existing repo.
 */
export const acceptIndividualLab = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsMember(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);
  const lab = await findLabInClass(access, c.req.param("labId"));
  if (!lab) return c.json({ error: "not_found" }, 404);
  if (lab.groupMode !== "individual") {
    return c.json({ error: "group_lab" }, 409);
  }
  if (!access.isTeacher && !labStarted(lab)) {
    return c.json({ error: "not_started" }, 409);
  }

  async function finish(solo: Group) {
    if (!access || !lab) throw new Error("unreachable");
    if (solo.ghRepoFullName) {
      // Same heal as createLabRepo: re-assert the grant on the recorded repo.
      await regrantWorkRepo(c.env, access, solo);
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
    .where(and(eq(groups.labId, lab.id), eq(groups.name, access.callerLogin)));
  if (existing) {
    // LIVE roster: this decides whether the solo team is really the caller's.
    // Three ways it can fail, and they are NOT the same problem — the student
    // can act on one of them and on the others only their teacher can, so they
    // answer with different codes rather than one opaque conflict.
    const members = await access.team.roster(existing.ghTeamSlug);
    if (members === null) {
      // The group row points at a team GitHub no longer has. Recreating it
      // would mean writing to the org on a student's behalf, which this route
      // deliberately never does — the audit page repairs it.
      return c.json({ error: "solo_team_missing" }, 409);
    }
    if (members.length === 0) {
      // The team exists and nobody is in it. Two ways to get here, both
      // outside the student's control: they were removed from the ORG (which
      // drops them from every team, and rejoining does not put them back), or
      // a teacher removed them from this group. Either way only a teacher can
      // put them back — and adopting the team on their say-so is exactly the
      // capture this route refuses to do, so it refuses here too.
      return c.json({ error: "solo_team_empty" }, 409);
    }
    if (members.length !== 1 || members[0]?.login !== access.callerLogin) {
      // Somebody ELSE holds the group carrying this login. The one case that is
      // genuinely a name collision.
      return c.json({ error: "solo_name_taken" }, 409);
    }
    // Mirror it. Without this an accept on an ALREADY-EXISTING solo group answers
    // 200 while `group_members` stays empty — and the student's own page, which
    // finds their group by looking for themselves in its roster, shows nothing.
    await replaceGroupMembers(access.db, existing.id, members);
    return finish(existing);
  }

  const created = await createGroupInLab(
    c.env,
    access,
    lab,
    access.callerLogin,
    c.get("user").id,
    { autoJoin: true },
  );
  if (created === "name_taken") {
    return c.json({ error: "solo_name_taken" }, 409);
  }
  return finish(created);
});

import {
  type Assignment,
  type Class,
  type Group,
  type getDb,
  groups,
} from "@roster/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { AuthEnv } from "./auth/config";
import type { ClassScope } from "./class-scope";
import {
  type CreatedRepo,
  classifyRepoFailure,
  createOrgRepo,
  generateFromTemplate,
  getOrgRepo,
  grantTeamRepo,
  type RepoFailure,
} from "./github/repo";
import { addTeamMember, createTeam } from "./github/team";
import { cachedRosters, syncGroupMembers } from "./group-members";

type Db = ReturnType<typeof getDb>;

/**
 * Group mechanics (per-assignment model, spec 2026-07-07): a group belongs to
 * one assignment and owns its GitHub Team. The one place that knows how a group
 * is born (the row plus a team named by the assignment-scoped slug), how its
 * within-assignment uniqueness is checked, and how a roster list is assembled
 * and reconciled.
 */

/** The assignment's maximum group size (an individual assignment means a group of one). */
export const assignmentMax = (assignment: Assignment) =>
  assignment.groupMode === "individual"
    ? 1
    : (assignment.maxMembers ?? Number.POSITIVE_INFINITY);

/** Whether the assignment is open to students: an unset start means "starts at
 *  creation". Teachers bypass every gate built on this, the deliberate escape
 *  hatch; the UI warns them, never blocks them. */
export const assignmentStarted = (assignment: Pick<Assignment, "startAt">) =>
  assignment.startAt === null || assignment.startAt.getTime() <= Date.now();

/**
 * Why a source group can't be copied into `assignment`, or null when it can.
 * Reuse is all or nothing: "reuse this group" means the same team on this
 * assignment, so one blocked member blocks the whole group and a partial copy
 * never happens. One rule, two consumers: the reusable list annotates rows with
 * it (the dialog greys them out) and createAssignmentGroup refuses on it (the
 * backstop, same pattern as joinGroup's group_full).
 */
export type ReuseBlocker =
  | { reason: "source_empty" }
  // `max` rides along for the UI's reason text; it is finite whenever this
  // blocker fires, since an unlimited assignment can't be exceeded.
  | { reason: "group_too_large"; max: number }
  | { reason: "member_already_placed"; logins: string[] }
  | { reason: "member_not_in_class"; logins: string[] };

export function reuseBlocker(
  assignment: Assignment,
  members: { login: string }[],
  /** Logins already in a group of this assignment (the one-group-per-assignment invariant). */
  placedLogins: ReadonlySet<string>,
  /** Logins with a live class membership (active students and teachers). */
  classLogins: ReadonlySet<string>,
): ReuseBlocker | null {
  if (members.length === 0) return { reason: "source_empty" };
  if (members.length > assignmentMax(assignment)) {
    return { reason: "group_too_large", max: assignmentMax(assignment) };
  }
  const placed = members
    .filter((m) => placedLogins.has(m.login))
    .map((m) => m.login);
  if (placed.length > 0) {
    return { reason: "member_already_placed", logins: placed };
  }
  const gone = members
    .filter((m) => !classLogins.has(m.login))
    .map((m) => m.login);
  if (gone.length > 0) return { reason: "member_not_in_class", logins: gone };
  return null;
}

/** Slug-safe: lowercase, strip diacritics, collapse to `a-z0-9-`. */
function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Create a group in an assignment: the row plus its backing secret team. The
 * assignment-scoped `slug` (`assignmentSlug-groupSlug`) names the GitHub team,
 * so it stays org-unique even when the friendly `name` repeats across
 * assignments; `name` is display-only and never sent to GitHub. `autoJoin` adds
 * the creating student, `copyFromLogins` seeds the roster (copy-forward).
 * Returns "name_taken" when the display name already exists in this assignment
 * (checked before touching GitHub, so no orphan team) or when GitHub rejects
 * the team.
 */
export async function createGroupInAssignment(
  env: AuthEnv,
  scope: { db: Db; cls: Class; org: string; callerLogin: string },
  assignment: Assignment,
  name: string,
  creatorUserId: string,
  opts: { autoJoin: boolean; copyFromLogins?: string[] },
): Promise<Group | "name_taken"> {
  // Display-name uniqueness within the assignment, checked first so a name
  // clash never orphans a GitHub team (the (assignmentId, name) index is the
  // backstop).
  const [existing] = await scope.db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.assignmentId, assignment.id), eq(groups.name, name)));
  if (existing) return "name_taken";

  const slug = `${slugify(assignment.title)}-${slugify(name)}`;
  let team: Awaited<ReturnType<typeof createTeam>>;
  try {
    team = await createTeam(env, scope.cls.installationId, scope.org, slug);
  } catch (err) {
    if ((err as { status?: number }).status === 422) return "name_taken";
    throw err;
  }

  // Seed the roster: copied members (copy-forward) and the creating student.
  const logins = new Set(opts.copyFromLogins ?? []);
  if (opts.autoJoin) logins.add(scope.callerLogin);
  for (const login of logins) {
    await addTeamMember(
      env,
      scope.cls.installationId,
      scope.org,
      team.slug,
      login,
    );
  }

  const now = new Date();
  const [group] = await scope.db
    .insert(groups)
    .values({
      id: crypto.randomUUID(),
      assignmentId: assignment.id,
      ghTeamId: team.id,
      ghTeamSlug: team.slug,
      slug,
      name,
      creatorUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!group) throw new Error("group insert returned no row");
  // Seed the roster cache from the team we just built, after the row exists
  // since group_members references it. One call, on a write path.
  await syncGroupMembers(
    scope.db,
    env,
    scope.cls.installationId,
    scope.org,
    group,
  );
  return group;
}

/**
 * Take groups down: each GitHub Team first, then every row in one statement.
 * The counterpart of `createGroupInAssignment`, and the ONE place that knows
 * the order, because both callers (`deleteGroup`, `deleteAssignment`) get it
 * wrong the same way if either drifts.
 *
 * Teams before rows, never the reverse. A team delete that throws leaves rows
 * pointing at a team that is already gone, exactly the drift the `group-teams`
 * reconciler exists to clear, and re-running the delete tolerates the teams it
 * already removed. Rows first would leak teams in the org that nothing in the
 * app can name again.
 *
 * Sequential like every other mutating GitHub loop here (see
 * `createMissingAssignmentRepos`): bursts of writes on one installation are
 * what trip GitHub's secondary rate limit, and `WorkersOctokit` carries no
 * retry plugin.
 *
 * `group_members` rows go with their group (FK ON DELETE cascade). The work
 * repos do NOT: nothing in this codebase deletes a GitHub repository.
 */
export async function deleteGroupsWithTeams(
  scope: Pick<ClassScope, "db" | "team">,
  rows: Pick<Group, "id" | "ghTeamSlug">[],
): Promise<void> {
  if (rows.length === 0) return;
  for (const group of rows) {
    try {
      await scope.team.delete(group.ghTeamSlug);
    } catch (err) {
      // Already gone on GitHub is the state we wanted.
      if ((err as { status?: number }).status !== 404) throw err;
    }
  }
  await scope.db.delete(groups).where(
    inArray(
      groups.id,
      rows.map((g) => g.id),
    ),
  );
}

/**
 * The one-group-per-student-per-assignment invariant, checked within a single
 * assignment (per-assignment model, no cross-assignment reach): is `login`
 * already in another group of `assignmentId`? `exceptGroupId` skips the group
 * being joined.
 *
 * Reads the `group_members` cache in one query, where this used to be one
 * GitHub team-roster call per group in the assignment. The cache is display
 * state and this is no authorization check: it enforces a product rule, and the
 * join it guards is itself idempotent on GitHub. Drift here can at worst let a
 * student double-book until the next reconcile.
 */
export async function alreadyInAssignmentGroup(
  access: ClassScope,
  assignmentId: string,
  login: string,
  exceptGroupId: string,
): Promise<boolean> {
  const assignmentGroups = await access.db
    .select({ id: groups.id })
    .from(groups)
    .where(
      and(eq(groups.assignmentId, assignmentId), ne(groups.id, exceptGroupId)),
    );
  const rosters = await cachedRosters(
    access.db,
    assignmentGroups.map((g) => g.id),
  );
  for (const members of rosters.values()) {
    if (members.some((m) => m.login === login)) return true;
  }
  return false;
}

/** GitHub repo names are case-insensitive; `null` never matches anything. */
export function isSameRepo(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.toLowerCase() === b.toLowerCase();
}

/**
 * Create the group's work repo: named by the group's assignment-scoped `slug`
 * (already unique, no assignment prefix to re-add), private, from the
 * assignment's template when set (else empty auto-init), recorded on the group
 * row, team granted push.
 *
 * Create only, never adopt. The slug is unique among the assignment's groups,
 * not among the org's repos, and students pick group names, so a colliding name
 * can be anyone's repo: a group named to collide with the teacher's private
 * `lab1-solution` would, under adoption, end in grantTeamRepo handing the
 * students push on the solution. A collision always refuses with `name_taken`;
 * a genuine interrupted create is recovered on the audit page, where the
 * teacher sees which repo would be linked and approves it
 * (reconcile/work-repos.ts).
 *
 * The row is written immediately after creation, before the grant, so a create
 * that dies mid-request leaves a recorded repo with a missing grant, which the
 * accept paths re-assert on the next click (regrantWorkRepo), instead of an
 * unrecorded orphan that only adoption could have recovered.
 *
 * Returns a `RepoFailure` for the conditions we can explain; anything else is
 * rethrown.
 */
export async function createWorkRepo(
  env: AuthEnv,
  scope: { db: Db; cls: Class; org: string },
  assignment: Assignment,
  group: Group,
): Promise<CreatedRepo | RepoFailure> {
  const name = group.slug;
  let repo: CreatedRepo;
  try {
    repo = assignment.templateRepoFullName
      ? await generateFromTemplate(
          env,
          scope.cls.installationId,
          assignment.templateRepoFullName,
          scope.org,
          name,
        )
      : await createOrgRepo(env, scope.cls.installationId, scope.org, name);
  } catch (err) {
    const failure = classifyRepoFailure(
      err,
      Boolean(assignment.templateRepoFullName),
    );
    if (failure) return failure;
    throw err; // unrecognized: don't invent a reason for it
  }
  await scope.db
    .update(groups)
    .set({
      ghRepoId: repo.id,
      ghRepoFullName: repo.fullName,
      updatedAt: new Date(),
    })
    .where(eq(groups.id, group.id));
  await grantTeamRepo(
    env,
    scope.cls.installationId,
    scope.org,
    group.ghTeamSlug,
    repo.fullName,
  );
  return repo;
}

/**
 * Re-assert the team's push grant on the group's recorded repo, an idempotent
 * PUT. The accept paths call this on their repo-already-exists branch, healing
 * a create that wrote the row and then died before the grant (see
 * createWorkRepo's ordering). No-op while no repo is recorded.
 *
 * Security: grants only what `groups.ghRepoFullName` already records, a column
 * written solely by a successful create of a brand-new repo or by a
 * teacher-approved audit link. Callers can never steer this at a name-matched
 * foreign repo (the teacher's solution, another group's work).
 */
export async function regrantWorkRepo(
  env: AuthEnv,
  scope: { cls: Class; org: string },
  group: Group,
): Promise<void> {
  if (!group.ghRepoFullName) return;
  await grantTeamRepo(
    env,
    scope.cls.installationId,
    scope.org,
    group.ghTeamSlug,
    group.ghRepoFullName,
  );
}

/**
 * Whether a group's work repo still exists on GitHub, checked by its original
 * name (`group.slug`, set once at creation and never changed; see
 * `createWorkRepo`). That matters for a repo renamed directly on GitHub: a GET
 * by the old name follows GitHub's rename redirect and still resolves, carrying
 * the new full name, so a rename is never mistaken for a deletion. Returns
 * `null` only on a confirmed 404 (truly deleted); any other failure (network,
 * rate limit) is rethrown rather than reported as gone.
 */
export async function checkRepoExists(
  env: AuthEnv,
  scope: { cls: Class; org: string },
  group: Pick<Group, "slug">,
): Promise<CreatedRepo | null> {
  try {
    return await getOrgRepo(
      env,
      scope.cls.installationId,
      scope.org,
      group.slug,
    );
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

/**
 * Per-group repo status for the assignment page's live org listing
 * (`orgRepoActivity`): a `ghRepoFullName` absent from that listing is a
 * suspect, not proof, because a rename also drops a repo's old full name from a
 * by-name listing, same as a deletion would. Only suspects (rare, zero in the
 * common case) cost an extra call, confirmed via `checkRepoExists`:
 *
 *   - found, same full name -> the caller's fast path handled it before this
 *     runs, so it never reaches here;
 *   - found, a different full name -> renamed, not deleted. Healed here
 *     (`ghRepoFullName` updated) rather than surfaced to anyone;
 *   - not found (404) -> "missing", and a teacher unlinks it from here (see
 *     `unlinkGroupRepo`).
 *
 * A `checkRepoExists` failure that is not a 404 propagates up rather than
 * mislabeling a group "missing" on a transient GitHub error.
 */
export async function resolveRepoStatuses(
  env: AuthEnv,
  scope: { db: Db; cls: Class; org: string },
  rows: Pick<Group, "id" | "slug" | "ghRepoFullName">[],
  knownFullNames: ReadonlySet<string>,
): Promise<Map<string, { status: "ok" | "missing"; repoFullName: string }>> {
  const out = new Map<
    string,
    { status: "ok" | "missing"; repoFullName: string }
  >();
  for (const row of rows) {
    if (!row.ghRepoFullName) continue;
    if (knownFullNames.has(row.ghRepoFullName)) {
      out.set(row.id, { status: "ok", repoFullName: row.ghRepoFullName });
      continue;
    }
    const repo = await checkRepoExists(env, scope, row);
    if (repo === null) {
      out.set(row.id, { status: "missing", repoFullName: row.ghRepoFullName });
      continue;
    }
    if (repo.fullName !== row.ghRepoFullName) {
      await scope.db
        .update(groups)
        .set({
          ghRepoId: repo.id,
          ghRepoFullName: repo.fullName,
          updatedAt: new Date(),
        })
        .where(eq(groups.id, row.id));
    }
    out.set(row.id, { status: "ok", repoFullName: repo.fullName });
  }
  return out;
}

/**
 * Rosters for group rows: one query against the `group_members` cache, where
 * this used to be one GitHub team-roster call per group.
 *
 * A team deleted on GitHub is therefore invisible from here, deliberately:
 * detecting it required the very call this removes. The `group-teams`
 * reconciler is the one place that observes a vanished team, and the teacher's
 * decision the one place it is acted on.
 */
export async function groupsWithRosters(access: ClassScope, rows: Group[]) {
  const rosters = await cachedRosters(
    access.db,
    rows.map((r) => r.id),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.ghTeamSlug,
    members: rosters.get(row.id) ?? [],
    repoFullName: row.ghRepoFullName,
  }));
}

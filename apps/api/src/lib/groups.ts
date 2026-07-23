import { type Class, type Group, type getDb, groups, type Lab } from "@labs/db";
import { and, eq, ne } from "drizzle-orm";
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
 * Group mechanics (per-lab model, spec 2026-07-07): a group belongs to ONE
 * lab and owns its GitHub Team. The one place that knows how a group is born
 * (team named by the lab-scoped slug + row), how its within-lab uniqueness
 * is checked, and how a roster list is assembled and reconciled.
 */

/** The lab's maximum group size (individual = a group of one). */
export const labMax = (lab: Lab) =>
  lab.groupMode === "individual"
    ? 1
    : (lab.maxMembers ?? Number.POSITIVE_INFINITY);

/**
 * Why a source group can't be copied into `lab` — or null when it can.
 * Reuse is ALL-OR-NOTHING: "reuse this group" means the same team on this
 * lab, so ANY blocked member blocks the whole group (never a partial copy).
 * One rule, two consumers: the reusable list annotates rows with it (the
 * dialog greys them out) and createLabGroup refuses on it (the backstop,
 * same pattern as joinGroup's group_full).
 */
export type ReuseBlocker =
  | { reason: "source_empty" }
  // `max` rides along for the UI's reason text; it is finite whenever this
  // blocker fires (an unlimited lab can't be exceeded).
  | { reason: "group_too_large"; max: number }
  | { reason: "member_already_placed"; logins: string[] }
  | { reason: "member_not_in_class"; logins: string[] };

export function reuseBlocker(
  lab: Lab,
  members: { login: string }[],
  /** Logins already in a group OF THIS LAB (the one-group-per-lab invariant). */
  placedLogins: ReadonlySet<string>,
  /** Logins with a LIVE class membership (active students + teachers). */
  classLogins: ReadonlySet<string>,
): ReuseBlocker | null {
  if (members.length === 0) return { reason: "source_empty" };
  if (members.length > labMax(lab)) {
    return { reason: "group_too_large", max: labMax(lab) };
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
 * Create a group IN a lab: its backing SECRET team + the row. The GitHub
 * team is named by the lab-scoped `slug` (`labSlug-groupSlug`) so it's
 * org-unique even when the friendly `name` repeats across labs; `name` is
 * display-only and never sent to GitHub. `autoJoin` adds the creating
 * student; `copyFromLogins` seeds the roster (copy-forward). Returns
 * "name_taken" when the display name already exists in THIS lab (checked
 * before touching GitHub, so no orphan team) or GitHub rejects the team.
 */
export async function createGroupInLab(
  env: AuthEnv,
  scope: { db: Db; cls: Class; org: string; callerLogin: string },
  lab: Lab,
  name: string,
  creatorUserId: string,
  opts: { autoJoin: boolean; copyFromLogins?: string[] },
): Promise<Group | "name_taken"> {
  // Display-name uniqueness within the lab — check first so we never orphan
  // a GitHub team on a name clash (the (labId, name) index is the backstop).
  const [existing] = await scope.db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.labId, lab.id), eq(groups.name, name)));
  if (existing) return "name_taken";

  const slug = `${slugify(lab.title)}-${slugify(name)}`;
  let team: Awaited<ReturnType<typeof createTeam>>;
  try {
    team = await createTeam(env, scope.cls.installationId, scope.org, slug);
  } catch (err) {
    if ((err as { status?: number }).status === 422) return "name_taken";
    throw err;
  }

  // Seed the roster: copied members (copy-forward) + the creating student.
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
      labId: lab.id,
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
  // Seed the roster cache from the team we just built — after the row exists,
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
 * The one-group-per-student-per-LAB invariant, checked within a SINGLE lab
 * (per-lab model — no cross-lab reach): is `login` already in another group
 * of `labId`? `exceptGroupId` skips the group being joined itself.
 *
 * Reads the `group_members` cache: ONE query, where this used to be one GitHub
 * team-roster call per group in the lab. The cache is display state, and this
 * is not an authorization check — it enforces a product rule, and the join it
 * guards is itself idempotent on GitHub. Drift here can at worst let a student
 * double-book until the next reconcile.
 */
export async function alreadyInLabGroup(
  access: ClassScope,
  labId: string,
  login: string,
  exceptGroupId: string,
): Promise<boolean> {
  const labGroups = await access.db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.labId, labId), ne(groups.id, exceptGroupId)));
  const rosters = await cachedRosters(
    access.db,
    labGroups.map((g) => g.id),
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
 * Create the group's WORK REPO: named by the group's lab-scoped `slug`
 * (already unique — no lab prefix to re-add), private, from the lab's template
 * when set (else empty auto-init), recorded on the group row, team granted
 * push.
 *
 * CREATE only, NEVER adopt. The slug is unique among the LAB's groups, not
 * among the org's repos — and students pick group names, so a colliding name
 * can be anyone's repo: a group named to collide with the teacher's private
 * `lab1-solution` would, under adoption, end in grantTeamRepo handing the
 * students push on the solution. A collision always refuses with
 * `name_taken`; a genuine interrupted create is recovered on the audit page,
 * where the TEACHER sees exactly which repo would be linked and approves it
 * (reconcile/work-repos.ts).
 *
 * The row is written IMMEDIATELY after creation, BEFORE the grant: a create
 * that dies mid-request leaves a recorded repo with a missing grant — which
 * the accept paths re-assert on the next click (regrantWorkRepo) — instead
 * of an unrecorded orphan that only adoption could have recovered.
 *
 * Returns a `RepoFailure` for the conditions we can explain; anything else
 * is rethrown.
 */
export async function createWorkRepo(
  env: AuthEnv,
  scope: { db: Db; cls: Class; org: string },
  lab: Lab,
  group: Group,
): Promise<CreatedRepo | RepoFailure> {
  const name = group.slug;
  let repo: CreatedRepo;
  try {
    repo = lab.templateRepoFullName
      ? await generateFromTemplate(
          env,
          scope.cls.installationId,
          lab.templateRepoFullName,
          scope.org,
          name,
        )
      : await createOrgRepo(env, scope.cls.installationId, scope.org, name);
  } catch (err) {
    const failure = classifyRepoFailure(err, Boolean(lab.templateRepoFullName));
    if (failure) return failure;
    throw err; // unrecognized — don't invent a reason for it
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
 * Re-assert the team's PUSH grant on the group's RECORDED repo — an
 * idempotent PUT. The accept paths call this on their repo-already-exists
 * branch, healing a create that wrote the row and then died before the
 * grant (see createWorkRepo's ordering). No-op while no repo is recorded.
 *
 * SECURITY: grants only what `groups.ghRepoFullName` already records — a
 * column written solely by a successful create of a BRAND-NEW repo or by a
 * teacher-approved audit link. Callers can never steer this at a
 * name-matched foreign repo (the teacher's solution, another group's work).
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
 * Whether a group's work repo still exists on GitHub, checked by its
 * ORIGINAL name (`group.slug` — set once at creation, never changed; see
 * `createWorkRepo`). That matters for a repo renamed directly on GitHub:
 * a GET by the old name follows GitHub's rename redirect and still resolves,
 * carrying the NEW full name, so a rename is never mistaken for a deletion.
 * Returns `null` only on a confirmed 404 (truly deleted); any other failure
 * (network, rate limit) is rethrown rather than silently reported as gone.
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
 * Per-group repo status for the lab page's live org listing
 * (`orgRepoActivity`): a `ghRepoFullName` absent from that listing is a
 * SUSPECT, not proof — a rename also drops a repo's OLD full name from a
 * by-name listing, same as a deletion would. Only suspects (rare — zero in
 * the common case) cost an extra call, confirmed via `checkRepoExists`:
 *
 *   - found, same full name      -> already handled by the caller's fast
 *     path before this runs, never reaches here;
 *   - found, a DIFFERENT full name -> renamed, not deleted. Healed here
 *     (`ghRepoFullName` updated) rather than surfaced to anyone;
 *   - not found (404)            -> "missing" — a teacher unlinks it from
 *     here (see `unlinkGroupRepo`).
 *
 * A `checkRepoExists` failure that ISN'T a 404 propagates up rather than
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
 * Rosters for group rows — ONE query against the `group_members` cache, where
 * this used to be one GitHub team-roster call per group.
 *
 * A team deleted on GitHub is therefore no longer visible from here, and that is
 * deliberate: detecting it required the very call this removes. The `group-teams`
 * reconciler is the one place that observes a vanished team, and the teacher's
 * decision is the one place it is acted on.
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

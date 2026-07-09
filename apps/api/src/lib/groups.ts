import { type Class, type Group, type getDb, groups, type Lab } from "@labs/db";
import { and, eq, ne } from "drizzle-orm";
import type { ClassAccess } from "./access";
import type { AuthEnv } from "./auth/config";
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
  scope: { db: Db; cls: Class; org: string; login: string },
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
  if (opts.autoJoin) logins.add(scope.login);
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
  access: ClassAccess,
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
 * when set (else empty auto-init), team granted push, recorded on the group row.
 *
 * FIND-or-create: if the repo already exists in the org we adopt it. The only
 * way that happens is an earlier attempt that created the repo and then failed
 * to record it — and without adoption that group could never accept the lab
 * again. The remaining steps (grant, row write) are idempotent, so adoption
 * re-runs them safely. The lab's own template is never adopted.
 *
 * Returns a `RepoFailure` for the three conditions we can explain; anything
 * else is rethrown.
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
    if (failure !== "name_taken") {
      if (failure) return failure;
      throw err; // unrecognized — don't invent a reason for it
    }
    // NEVER adopt the lab's own template. Adoption ends in grantTeamRepo, so a
    // group whose slug collides with the template's name (same org) would hand
    // the students PUSH on the starter code.
    if (isSameRepo(lab.templateRepoFullName, `${scope.org}/${name}`)) {
      return "name_taken";
    }
    // The repo is already there. That means an earlier attempt created it and
    // died before recording it (the grant or the row write failed), leaving the
    // group permanently unable to accept the lab. The slug is lab-scoped and
    // unique, so this repo IS this group's — adopt it and fall through to the
    // grant + row write, which are both idempotent.
    try {
      repo = await getOrgRepo(env, scope.cls.installationId, scope.org, name);
    } catch (readErr) {
      const status = (readErr as { status?: number }).status;
      // 404/403: it exists but we can't see it (App not installed on it, or the
      // name belongs to someone else). Now the sentinel is honest. Anything
      // else — a 500, a network fault — is NOT a naming problem: rethrow it
      // rather than blame the student's repo name.
      if (status === 404 || status === 403) return "name_taken";
      throw readErr;
    }
  }
  await grantTeamRepo(
    env,
    scope.cls.installationId,
    scope.org,
    group.ghTeamSlug,
    repo.fullName,
  );
  await scope.db
    .update(groups)
    .set({
      ghRepoId: repo.id,
      ghRepoFullName: repo.fullName,
      updatedAt: new Date(),
    })
    .where(eq(groups.id, group.id));
  return repo;
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
export async function groupsWithRosters(access: ClassAccess, rows: Group[]) {
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

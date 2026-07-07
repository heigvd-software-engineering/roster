import { type Class, type Group, type getDb, groups, type Lab } from "@labs/db";
import { and, eq, ne } from "drizzle-orm";
import type { AuthEnv } from "./auth/config";
import {
  type CreatedRepo,
  createOrgRepo,
  generateFromTemplate,
  grantTeamRepo,
} from "./github/repo";
import { addTeamMember, createTeam, teamMembers } from "./github/team";

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
  return group;
}

/**
 * The one-group-per-student-per-LAB invariant, checked within a SINGLE lab
 * (per-lab model — no cross-lab reach): is `login` already in another group
 * of `labId`? Live rosters, in parallel. `exceptGroupId` skips the group
 * being joined itself.
 */
export async function alreadyInLabGroup(
  env: AuthEnv,
  scope: { db: Db; cls: Class },
  org: string,
  labId: string,
  login: string,
  exceptGroupId: string,
): Promise<boolean> {
  const labGroups = await scope.db
    .select()
    .from(groups)
    .where(and(eq(groups.labId, labId), ne(groups.id, exceptGroupId)));
  const rosters = await Promise.all(
    labGroups.map((g) =>
      teamMembers(env, scope.cls.installationId, org, g.ghTeamSlug),
    ),
  );
  return rosters.some(
    (roster) => roster?.some((m) => m.login === login) ?? false,
  );
}

/**
 * Create the group's WORK REPO: named by the group's lab-scoped `slug`
 * (already unique — no lab prefix to re-add), private, from the lab's
 * template when set (else empty auto-init), team granted push, recorded on
 * the group row. Failure sentinels: "name_taken" (repo name already in the
 * org), "template_error" (the /generate call refused — usually the template
 * repo is EMPTY or gone; the name 422 and this one are BOTH 422 but mean
 * opposite things, so we read the message), "app_permissions" (App lacks
 * Repository write).
 */
export type RepoFailure = "name_taken" | "template_error" | "app_permissions";
export async function createPairRepo(
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
    const e = err as {
      status?: number;
      response?: { data?: { message?: string } };
      message?: string;
    };
    if (e.status === 422) {
      // A 422 means either the name is taken OR the template can't be used
      // (empty/gone). Only the message tells them apart.
      const msg = e.response?.data?.message ?? e.message ?? "";
      return /already exists/i.test(msg) ? "name_taken" : "template_error";
    }
    // "Resource not accessible by integration": the App installation lacks
    // Repository Administration/Contents write — an admin problem, surface
    // it instead of 500ing.
    if (e.status === 403) return "app_permissions";
    throw err;
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
 * Live rosters for group rows — one GitHub call per team, in PARALLEL. A
 * team gone on GitHub reconciles HERE: its row is dropped. Returns the
 * group's display data + live members + its work repo (folded onto the row).
 */
export async function groupsWithRosters(
  env: AuthEnv,
  scope: { db: Db; cls: Class; org: string },
  rows: Group[],
) {
  const rosters = await Promise.all(
    rows.map((row) =>
      teamMembers(env, scope.cls.installationId, scope.org, row.ghTeamSlug),
    ),
  );
  const out = [];
  for (const [i, members] of rosters.entries()) {
    const row = rows[i];
    if (!row) continue;
    if (members === null) {
      await scope.db.delete(groups).where(eq(groups.id, row.id));
      continue;
    }
    out.push({
      id: row.id,
      name: row.name,
      slug: row.ghTeamSlug,
      members,
      repoFullName: row.ghRepoFullName,
    });
  }
  return out;
}

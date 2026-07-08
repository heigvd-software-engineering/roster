import { type Class, type Group, type getDb, groups, type Lab } from "@labs/db";
import { and, eq, ne } from "drizzle-orm";
import type { ClassAccess } from "./access";
import type { AuthEnv } from "./auth/config";
import {
  type CreatedRepo,
  createOrgRepo,
  generateFromTemplate,
  getOrgRepo,
  grantTeamRepo,
} from "./github/repo";
import { addTeamMember, createTeam } from "./github/team";

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
  access: ClassAccess,
  labId: string,
  login: string,
  exceptGroupId: string,
): Promise<boolean> {
  const labGroups = await access.db
    .select()
    .from(groups)
    .where(and(eq(groups.labId, labId), ne(groups.id, exceptGroupId)));
  const rosters = await Promise.all(
    labGroups.map((g) => access.team.roster(g.ghTeamSlug)),
  );
  return rosters.some(
    (roster) => roster?.some((m) => m.login === login) ?? false,
  );
}

/**
 * Why a work repo couldn't be created. "name_taken" = the repo exists but we
 * can't read it back; "template_error" = the /generate call refused (the
 * template repo is EMPTY or gone) and is ONLY ever returned when the lab has a
 * template; "app_permissions" = the App lacks Repository write.
 */
export type RepoFailure = "name_taken" | "template_error" | "app_permissions";

/** Everything GitHub said about a failure. A 422 body carries a GENERIC
 *  summary ("Repository creation failed.") plus the actual reason in
 *  `errors[]` ("name already exists on this account") — so reading `message`
 *  alone tells you nothing. Octokit flattens both into `err.message`; we join
 *  every source rather than depend on which. */
function githubErrorText(err: unknown): string {
  const e = err as {
    message?: string;
    response?: { data?: { message?: string; errors?: { message?: string }[] } };
  };
  const data = e.response?.data;
  return [
    e.message ?? "",
    data?.message ?? "",
    ...(data?.errors ?? []).map((x) => x.message ?? ""),
  ].join(" ");
}

/** GitHub repo names are case-insensitive; `null` never matches anything. */
export function isSameRepo(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.toLowerCase() === b.toLowerCase();
}

/**
 * Turn a GitHub repo-creation error into one of our sentinels, or `null` when
 * we don't recognize it (the caller rethrows — a 500 with the real error beats
 * a friendly lie). `usedTemplate` matters: a lab with no template calls
 * `POST /orgs/{org}/repos`, where a template error is impossible by
 * construction, so we must never blame one.
 */
export function classifyRepoFailure(
  err: unknown,
  usedTemplate: boolean,
): RepoFailure | null {
  const status = (err as { status?: number }).status;
  // "Resource not accessible by integration": the App installation lacks
  // Repository Administration/Contents write — an admin problem, surface it.
  if (status === 403) return "app_permissions";
  if (status !== 422) return null;
  if (/already exists/i.test(githubErrorText(err))) return "name_taken";
  return usedTemplate ? "template_error" : null;
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
 * Live rosters for group rows — one GitHub call per team, in PARALLEL. A
 * team gone on GitHub reconciles HERE: its row is dropped. Returns the
 * group's display data + live members + its work repo (folded onto the row).
 */
export async function groupsWithRosters(access: ClassAccess, rows: Group[]) {
  const rosters = await Promise.all(
    rows.map((row) => access.team.roster(row.ghTeamSlug)),
  );
  const out = [];
  for (const [i, members] of rosters.entries()) {
    const row = rows[i];
    if (!row) continue;
    if (members === null) {
      await access.db.delete(groups).where(eq(groups.id, row.id));
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

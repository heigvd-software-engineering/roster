import {
  type Class,
  type Group,
  type getDb,
  groups,
  type Lab,
  studentLabRepos,
} from "@labs/db";
import { and, eq, inArray, ne } from "drizzle-orm";
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
 * Group mechanics shared by the class-groups and lab-groups handlers — the
 * one place that knows how a group is born (secret team + row), how it
 * pairs with a lab, and how a roster list is assembled and reconciled.
 */

/** Create a group: its backing SECRET team + the thin row. `autoJoin` puts
 *  the creating student in it (that's why they create one); teachers stay
 *  out. Null on a taken name (GitHub 422) — routes answer 409. */
export async function createGroupWithTeam(
  env: AuthEnv,
  scope: { db: Db; cls: Class; org: string; login: string },
  name: string,
  creatorUserId: string,
  opts: { autoJoin: boolean },
): Promise<Group | null> {
  let team: Awaited<ReturnType<typeof createTeam>>;
  try {
    team = await createTeam(env, scope.cls.installationId, scope.org, name);
  } catch (err) {
    if ((err as { status?: number }).status === 422) {
      return null;
    }
    throw err;
  }
  if (opts.autoJoin) {
    await addTeamMember(
      env,
      scope.cls.installationId,
      scope.org,
      team.slug,
      scope.login,
    );
  }

  const now = new Date();
  const [group] = await scope.db
    .insert(groups)
    .values({
      id: crypto.randomUUID(),
      classId: scope.cls.id,
      ghTeamId: team.id,
      ghTeamSlug: team.slug,
      name: team.name,
      creatorUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!group) {
    throw new Error("group insert returned no row");
  }
  return group;
}

/**
 * The one-group-per-student-per-LAB invariant, from the membership side:
 * would putting `login` into `group` double-book a lab this group already
 * participates in (because another attached group has them)? Attach-time
 * checks the same invariant from the pairing side — together they close
 * both doors. Live rosters, in parallel.
 */
export async function wouldDoubleParticipate(
  env: AuthEnv,
  scope: { db: Db; cls: Class },
  org: string,
  group: Group,
  login: string,
): Promise<boolean> {
  const attachedLabs = await scope.db
    .select({ labId: studentLabRepos.labId })
    .from(studentLabRepos)
    .where(eq(studentLabRepos.groupId, group.id));
  if (attachedLabs.length === 0) return false;

  const others = await scope.db
    .selectDistinct({ group: groups })
    .from(studentLabRepos)
    .innerJoin(groups, eq(studentLabRepos.groupId, groups.id))
    .where(
      and(
        inArray(
          studentLabRepos.labId,
          attachedLabs.map((a) => a.labId),
        ),
        ne(studentLabRepos.groupId, group.id),
      ),
    );
  const rosters = await Promise.all(
    others.map(({ group: other }) =>
      teamMembers(env, scope.cls.installationId, org, other.ghTeamSlug),
    ),
  );
  return rosters.some(
    (roster) => roster?.some((m) => m.login === login) ?? false,
  );
}

/** Repo-name-safe slug (the team slug part is GitHub-made already). */
function slugify(text: string) {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      // Strip combining diacritics (U+0300–U+036F) left by NFKD.
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
  );
}

/**
 * Create the pairing's WORK REPO (F8): `lab-slug-team-slug`, private, from
 * the lab's template when set (else empty auto-init), team granted push,
 * recorded on the student_lab_repos row. "name_taken" when the org already
 * has that repo name (e.g. a leftover from a deleted pairing).
 */
export async function createPairRepo(
  env: AuthEnv,
  scope: { db: Db; cls: Class; org: string },
  lab: Lab,
  group: Group,
): Promise<CreatedRepo | "name_taken" | "app_permissions"> {
  const name = `${slugify(lab.title)}-${group.ghTeamSlug}`;
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
    const status = (err as { status?: number }).status;
    if (status === 422) {
      return "name_taken";
    }
    // "Resource not accessible by integration": the App installation lacks
    // Repository Administration/Contents write — an admin problem, not a
    // student one; surface it instead of 500ing.
    if (status === 403) {
      return "app_permissions";
    }
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
    .update(studentLabRepos)
    .set({
      ghRepoId: repo.id,
      ghRepoFullName: repo.fullName,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(studentLabRepos.labId, lab.id),
        eq(studentLabRepos.groupId, group.id),
      ),
    );
  return repo;
}

/** Idempotently record the group↔lab pairing (the attachment). */
export async function attachPair(db: Db, labId: string, groupId: string) {
  const now = new Date();
  await db
    .insert(studentLabRepos)
    .values({
      id: crypto.randomUUID(),
      labId,
      groupId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [studentLabRepos.labId, studentLabRepos.groupId],
    });
}

/**
 * Live rosters for group rows — one GitHub call per team, in PARALLEL. A
 * team gone on GitHub reconciles HERE, whichever list noticed: its lab
 * attachments and row are dropped (single decision point, no drift between
 * lists).
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
      await scope.db
        .delete(studentLabRepos)
        .where(eq(studentLabRepos.groupId, row.id));
      await scope.db.delete(groups).where(eq(groups.id, row.id));
      continue;
    }
    out.push({
      id: row.id,
      name: row.name,
      slug: row.ghTeamSlug,
      members,
    });
  }
  return out;
}

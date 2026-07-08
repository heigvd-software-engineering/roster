import {
  account,
  type Class,
  classes,
  type Group,
  getDb,
  groups,
  labs,
  user,
} from "@labs/db";
import { and, eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import type { AuthEnv } from "./auth/config";
import { githubAccessToken } from "./auth/github-token";
import type { AuthedEnv } from "./auth/require-auth";
import { orgLogin } from "./github/app";
import { isOrgAdmin, type OrgPerson, orgMembership } from "./github/org";
import {
  addTeamMember,
  deleteTeam,
  removeTeamMember,
  teamMembers,
} from "./github/team";
import { fetchGithubProfile } from "./github/user";
import { syncGroupMembers } from "./group-members";

/**
 * Class-scoped access resolution — the ONE home for "who is the caller to
 * this class" (previously spread across three handler files). Two variants,
 * deliberately different mechanisms:
 *
 * - `resolveClassAccess` — routes where the caller acts as THEMSELVES
 *   (join/leave a group): needs their GitHub LOGIN, so it spends their
 *   OAuth token on a profile fetch and reads membership + role from one
 *   live orgMembership call. Active members only.
 * - `resolveClassAsTeacher` — teacher-only routes: stored account id + the
 *   org's live admin list; NO user-token dependence, so a teacher with an
 *   expired OAuth link can still manage labs/classes.
 *
 * Both deny with null → routes answer 404, never confirming that a class
 * exists to someone outside it. Authorization is always live GitHub state,
 * never the class_members display cache.
 */

type Db = ReturnType<typeof getDb>;

/**
 * The caller's GitHub identity, both forms. `account.accountId` is TEXT: for the
 * `github` provider it holds a numeric id, and a non-numeric value is as good as
 * absent. Callers need the number (GitHub APIs) and the string
 * (`class_members.githubId` comparisons).
 */
export async function callerGithub(
  db: Db,
  userId: string,
): Promise<{ ghId: number; githubId: string } | null> {
  const row = await db.query.account.findFirst({
    where: (a, op) =>
      op.and(op.eq(a.userId, userId), op.eq(a.providerId, "github")),
    columns: { accountId: true },
  });
  if (!row) return null;
  const ghId = Number(row.accountId);
  return Number.isFinite(ghId) ? { ghId, githubId: row.accountId } : null;
}

/** The class org's GitHub Team API, pre-bound to this class's installation +
 *  org — so handlers call `access.team.add(slug, login)` instead of threading
 *  `(env, cls.installationId, org, …)` through every call.
 *
 *  `roster` is the LIVE team. Display reads take the `group_members` cache
 *  (`lib/group-members.ts`) instead — that is the whole point of the cache. Use
 *  `roster` only where the answer AUTHORIZES or gates an irreversible write:
 *  "is the caller in this group", "does this team still exist", "is the group
 *  complete enough to get a repo". A cache may never decide those. */
export type ClassTeam = {
  roster: (slug: string) => ReturnType<typeof teamMembers>;
  add: (slug: string, login: string) => Promise<void>;
  remove: (slug: string, login: string) => Promise<void>;
  delete: (slug: string) => Promise<void>;
  /** Mirror ONE team's live roster into `group_members`. Null = team gone. */
  syncMembers: (
    group: Pick<Group, "id" | "ghTeamSlug">,
  ) => Promise<OrgPerson[] | null>;
};

export type ClassAccess = {
  db: Db;
  cls: Class;
  org: string;
  /** The caller's GitHub login — self join/leave acts on it. */
  login: string;
  /** Live org Owner (teacher). */
  admin: boolean;
  /** This class's GitHub Team API, pre-bound to its installation + org. */
  team: ClassTeam;
};

function classTeam(
  db: Db,
  env: AuthEnv,
  installationId: number,
  org: string,
): ClassTeam {
  return {
    roster: (slug) => teamMembers(env, installationId, org, slug),
    add: (slug, login) => addTeamMember(env, installationId, org, slug, login),
    remove: (slug, login) =>
      removeTeamMember(env, installationId, org, slug, login),
    delete: (slug) => deleteTeam(env, installationId, org, slug),
    syncMembers: (group) =>
      syncGroupMembers(db, env, installationId, org, group),
  };
}

export async function resolveClassAccess(
  c: Context<AuthedEnv>,
  classId: string | undefined,
): Promise<ClassAccess | null> {
  if (!classId) return null;
  const db = getDb(c.env.DB);
  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  if (!cls) return null;

  const token = await githubAccessToken(c.env, c.get("user").id);
  if (!token) return null;

  try {
    // Independent lookups — one round trip instead of two.
    const [profile, org] = await Promise.all([
      fetchGithubProfile(token),
      orgLogin(c.env, cls.installationId),
    ]);
    if (!profile) return null;
    const membership = await orgMembership(
      c.env,
      cls.installationId,
      org,
      profile.login,
    );
    // Pending invitees can't act yet — active members only.
    if (membership?.state !== "active") return null;
    return {
      db,
      cls,
      org,
      login: profile.login,
      admin: membership.role === "admin",
      team: classTeam(db, c.env, cls.installationId, org),
    };
  } catch {
    // Dead installation — the class effectively doesn't exist.
    return null;
  }
}

export async function resolveClassAsTeacher(
  c: Context<AuthedEnv>,
  classId: string | undefined,
): Promise<{ db: Db; cls: Class; org: string } | null> {
  if (!classId) return null;
  const db = getDb(c.env.DB);
  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  if (!cls) return null;

  const caller = await callerGithub(db, c.get("user").id);
  if (!caller) return null;

  try {
    const org = await orgLogin(c.env, cls.installationId);
    if (!(await isOrgAdmin(c.env, cls.installationId, org, caller.ghId)))
      return null;
    return { db, cls, org };
  } catch {
    return null;
  }
}

/** The group row, only if it belongs to the class — class is DERIVED via
 *  the group's lab (per-lab model: groups own a lab, not a class). */
export async function groupInClass(
  scope: { db: Db; cls: Class },
  groupId: string | undefined,
) {
  if (!groupId) return null;
  const [row] = await scope.db
    .select({ group: groups, labClassId: labs.classId })
    .from(groups)
    .innerJoin(labs, eq(groups.labId, labs.id))
    .where(eq(groups.id, groupId));
  return row && row.labClassId === scope.cls.id ? row.group : null;
}

/** The lab row, only if it belongs to the class. */
export async function labInClass(
  scope: { db: Db; cls: Class },
  labId: string | undefined,
) {
  if (!labId) return null;
  const [row] = await scope.db.select().from(labs).where(eq(labs.id, labId));
  return row && row.classId === scope.cls.id ? row : null;
}

/** SWITCH users linked to GitHub accounts — raw query rows; clients
 *  correlate them by github id (one query for any people/roster list). */
export async function linkedUsers(db: Db, githubIds: string[]) {
  if (githubIds.length === 0) return [];
  return db
    .select({ githubId: account.accountId, user })
    .from(account)
    .innerJoin(user, eq(account.userId, user.id))
    .where(
      and(
        eq(account.providerId, "github"),
        inArray(account.accountId, githubIds),
      ),
    );
}

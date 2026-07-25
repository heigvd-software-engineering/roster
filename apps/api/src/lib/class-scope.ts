import {
  type Class,
  classes,
  classMembers,
  type Group,
  getDb,
  groups,
  labs,
} from "@roster/db";
import { and, eq } from "drizzle-orm";
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
import { fetchGithubProfile, GithubUnavailableError } from "./github/user";
import { syncGroupMembers } from "./group-members";
import { githubIdsForUser } from "./identity";

/**
 * Turn "a request about class X" into a SCOPE: the class row, its org, who the
 * caller is to it, and the pre-bound Team API — having first proven, against
 * live GitHub, that they may be there at all. Every class-scoped route starts
 * with one of these and works inside what it returns; `findGroupInClass` /
 * `findLabInClass` then keep child lookups inside the same boundary, so a valid
 * group id from ANOTHER class still resolves to nothing.
 *
 * The ONE home for "who is the caller to this class" (previously spread across
 * three handler files). Two variants, deliberately different mechanisms:
 *
 * - `resolveClassAsMember` — routes where the caller acts as THEMSELVES
 *   (join/leave a group): needs their GitHub LOGIN. The login normally
 *   comes from the class's own member cache (`class_members`, keyed by the
 *   stored GitHub id) — zero calls; their OAuth token is spent on a live
 *   profile fetch only when the cache has no row or the membership check
 *   misses (renamed login). Membership + role stay one live orgMembership
 *   call. Active members only.
 * - `resolveClassAsTeacher` — teacher-only routes: stored account id + the
 *   org's live admin list; NO user-token dependence, so a teacher with an
 *   expired OAuth link can still manage labs/classes.
 *
 * Both read the ORG's login from the class row's identity cache
 * (`classes.login`, kept true by setup.ts + the identity reconciler) and
 * fall back to a live `orgLogin` when it's unfilled or proven stale — so
 * the hot path costs ONE GitHub call: the authorization itself.
 *
 * Both deny with null → routes answer 404, never confirming that a class
 * exists to someone outside it. Authorization is always live GitHub state,
 * never the class_members display cache.
 */

type Db = ReturnType<typeof getDb>;

/** The class org's GitHub Team API, pre-bound to this class's installation +
 *  org — so handlers call `access.team.add(slug, login)` instead of threading
 *  `(env, cls.installationId, org, …)` through every call.
 *
 *  `roster` is the LIVE team. Display reads take the `group_members` cache
 *  (`lib/group-members.ts`) instead — that is the whole point of the cache. Use
 *  `roster` only where the answer AUTHORIZES or gates an irreversible write:
 *  "is the caller in this group", "does this team still exist", "is the group
 *  complete enough to get a repo". A cache may never decide those. */
type ClassTeam = {
  roster: (slug: string) => ReturnType<typeof teamMembers>;
  add: (slug: string, login: string) => Promise<void>;
  remove: (slug: string, login: string) => Promise<void>;
  delete: (slug: string) => Promise<void>;
  /** Mirror ONE team's live roster into `group_members`. Null = team gone. */
  syncMembers: (
    group: Pick<Group, "id" | "ghTeamSlug">,
  ) => Promise<OrgPerson[] | null>;
};

export type ClassScope = {
  db: Db;
  cls: Class;
  /** The ORG's login (the class's GitHub organization). */
  org: string;
  /** The CALLER's login — named apart from `org` because the two sat side by
   *  side as `org`/`login` and nothing said which was whose. Self join/leave
   *  acts on this one. */
  callerLogin: string;
  /** Live org Owner — i.e. a teacher of this class. Named for the app's role,
   *  not GitHub's `admin`, since every caller reads it as "may they manage
   *  this class". */
  isTeacher: boolean;
  /** Live org membership state. "pending" only ever reaches the callers
   *  that opted in via `allowPending` — everyone else never sees it. */
  membershipState: "active" | "pending";
  /** This class's GitHub Team API, pre-bound to its installation + org. */
  team: ClassTeam;
};

/** Build the `ClassTeam` above by closing over this class's installation and
 *  org, so every call site drops four arguments it would otherwise thread. */
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

/**
 * Resolve the caller as a MEMBER of the class — the entry point for routes
 * where they act as themselves (join a group, leave a group, view their lab).
 *
 * Returns everything such a route needs and nothing it doesn't: the class row,
 * the org login, the caller's own GitHub login (what team writes act on),
 * whether they are a teacher, their live membership state, and the class's
 * Team API pre-bound to this installation.
 *
 * `null` means "no access", for every reason — unknown class, no linked GitHub
 * account, not a member, dead installation. Routes turn that into 404 rather
 * than 403 so the answer never reveals that a class exists to an outsider.
 *
 * Authorization is ALWAYS the live `orgMembership` call. Caches (the class's
 * `login`, the member row's `login`) only propose NAMES to ask about, and a
 * miss retries once with freshly derived names before believing it.
 */
export async function resolveClassAsMember(
  c: Context<AuthedEnv>,
  classId: string | undefined,
  opts?: {
    /** Also resolve a PENDING invitee (read-only surfaces that must tell
     *  "accept your invitation first" apart from "not your class"). The
     *  default stays active-only: a pending member can't act. */
    allowPending?: boolean;
  },
): Promise<ClassScope | null> {
  if (!classId) return null;
  const db = getDb(c.env.DB);
  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  if (!cls) return null;

  const caller = await githubIdsForUser(db, c.get("user").id);
  if (!caller) return null;

  /** The caller's CURRENT login, straight from GitHub — the fallback when
   *  the cache can't answer (no row, or a renamed login). */
  const liveLogin = async () => {
    const token = await githubAccessToken(c.env, c.get("user").id);
    if (!token) return null;
    return (await fetchGithubProfile(token))?.login ?? null;
  };

  try {
    // Both names from caches — ZERO calls on the hot path. The caller's
    // login from the class's member cache; the ORG's login from the class
    // row's identity cache (kept true by setup.ts + the identity
    // reconciler). Caches only PROPOSE names; the live orgMembership call
    // below is still what authorizes.
    const [cached] = await db
      .select({ login: classMembers.login })
      .from(classMembers)
      .where(
        and(
          eq(classMembers.classId, cls.id),
          eq(classMembers.githubId, caller.githubId),
        ),
      );

    const orgFromCache = cls.login !== null;
    let org = cls.login ?? (await orgLogin(c.env, cls.installationId));

    let login = cached?.login ?? null;
    const loginFromCache = login !== null;
    if (!login) login = await liveLogin();
    if (!login) return null;

    let membership = await orgMembership(c.env, cls.installationId, org, login);
    // A membership miss may be a STALE cache — the org renamed, the caller
    // renamed, or both. Re-derive whatever came from a cache and retry
    // ONCE. A real non-member still ends at null.
    if (!membership && (orgFromCache || loginFromCache)) {
      const freshOrg = orgFromCache
        ? await orgLogin(c.env, cls.installationId)
        : org;
      const freshLogin = loginFromCache
        ? ((await liveLogin()) ?? login)
        : login;
      if (freshOrg !== org || freshLogin !== login) {
        org = freshOrg;
        login = freshLogin;
        membership = await orgMembership(c.env, cls.installationId, org, login);
      }
    }
    // Pending invitees can't act yet — active members only, unless the
    // caller explicitly asked to see the pending state.
    const state = membership?.state;
    if (state !== "active" && !(opts?.allowPending && state === "pending")) {
      return null;
    }
    return {
      db,
      cls,
      org,
      callerLogin: login,
      // Owner = live ACTIVE admin — a pending Owner invite is not an Owner.
      isTeacher: state === "active" && membership?.role === "admin",
      membershipState: state,
      team: classTeam(db, c.env, cls.installationId, org),
    };
  } catch (err) {
    // GitHub being unreachable is NOT "this class doesn't exist" — let the
    // 503 translator (on-error.ts) answer honestly instead of a 404.
    if (err instanceof GithubUnavailableError) throw err;
    // Dead installation — the class effectively doesn't exist.
    return null;
  }
}

/**
 * Resolve the caller as a TEACHER of the class — the gate on every route that
 * manages the class itself (create labs, invite teachers, reconcile).
 *
 * Deliberately a different mechanism from `resolveClassAsMember`, not a stricter
 * version of it: this asks the ORG whether the caller's stored account id is an
 * Owner, using the installation token. It never touches the caller's OAuth
 * token, so a teacher whose GitHub link has expired can still run the class —
 * they only lose the routes that act AS them.
 *
 * Returns the narrow scope those routes need (`db`, `cls`, `org`); `null` is
 * "not a teacher of this class", answered as 404 like above.
 */
export async function resolveClassAsTeacher(
  c: Context<AuthedEnv>,
  classId: string | undefined,
): Promise<{ db: Db; cls: Class; org: string } | null> {
  if (!classId) return null;
  const db = getDb(c.env.DB);
  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  if (!cls) return null;

  const caller = await githubIdsForUser(db, c.get("user").id);
  if (!caller) return null;

  try {
    // Org login from the class row's identity cache — zero calls; live only
    // when unfilled. A STALE cached login (org renamed) makes the members
    // listing THROW (404) — that, and only that, warrants re-deriving it
    // live and retrying once. `false` is a real non-admin: no retry.
    let org = cls.login ?? (await orgLogin(c.env, cls.installationId));
    let admin: boolean;
    try {
      admin = await isOrgAdmin(c.env, cls.installationId, org, caller.ghId);
    } catch (err) {
      if (cls.login === null) throw err; // already live — nothing fresher
      const fresh = await orgLogin(c.env, cls.installationId);
      if (fresh === org) throw err;
      org = fresh;
      admin = await isOrgAdmin(c.env, cls.installationId, org, caller.ghId);
    }
    if (!admin) return null;
    return { db, cls, org };
  } catch {
    return null;
  }
}

/** The group row, only if it belongs to the class — class is DERIVED via
 *  the group's lab (per-lab model: groups own a lab, not a class). */
export async function findGroupInClass(
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
export async function findLabInClass(
  scope: { db: Db; cls: Class },
  labId: string | undefined,
) {
  if (!labId) return null;
  const [row] = await scope.db.select().from(labs).where(eq(labs.id, labId));
  return row && row.classId === scope.cls.id ? row : null;
}

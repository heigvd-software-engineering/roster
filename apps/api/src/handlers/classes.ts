import { account, classes, getDb, type Lab, labs, user } from "@labs/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { authedFactory } from "../factory";
import { githubAccessToken } from "../lib/auth/github-token";
import { orgLogin } from "../lib/github/app";
import {
  basePermission,
  isOrgAdmin,
  type OrgPerson,
  orgInfo,
  orgPeople,
  setBasePermissionNone,
} from "../lib/github/org";
import { userInstallationsByOrgId } from "../lib/github/user";

/** Teacher-only: lock the class org's base repository permission to "none"
 *  and verify it took. */
export const confirmClass = authedFactory.createHandlers(async (c) => {
  // Outside the route chain the path literal is unknown, so params type as
  // string | undefined — guard explicitly (also correct at runtime).
  const id = c.req.param("id");
  if (!id) return c.json({ error: "not_found" }, 404);

  const db = getDb(c.env.DB);
  const [cls] = await db.select().from(classes).where(eq(classes.id, id));
  if (!cls) return c.json({ error: "not_found" }, 404);

  const login = await orgLogin(c.env, cls.installationId);

  // Teacher check: live org Owner, keyed on the stored github account id
  // (no user-token dependence). 404 (not 403) — don't confirm existence of
  // a class the caller can't see. `connectedByUserId` is provenance only.
  const ghAccount = await db.query.account.findFirst({
    where: (a, op) =>
      op.and(op.eq(a.userId, c.get("user").id), op.eq(a.providerId, "github")),
    columns: { accountId: true },
  });
  const ghId = Number(ghAccount?.accountId);
  if (
    !Number.isFinite(ghId) ||
    !(await isOrgAdmin(c.env, cls.installationId, login, ghId))
  ) {
    return c.json({ error: "not_found" }, 404);
  }

  await setBasePermissionNone(c.env, cls.installationId, login);
  const verified = await basePermission(c.env, cls.installationId, login);
  return c.json({
    ok: verified === "none",
    org: { login },
  });
});

/** The teacher hub's data: the caller's classes (live org Owner check),
 *  each with live people, linked labs users, and its labs. */
export const listClasses = authedFactory.createHandlers(async (c) => {
  const db = getDb(c.env.DB);
  const caller = c.get("user");

  // Identity first: the caller's github id (teacher check) and a usable
  // OAuth token (installations call, refreshed if expired) — either missing
  // means there's nothing to list.
  const ghAccount = await db.query.account.findFirst({
    where: (a, op) =>
      op.and(op.eq(a.userId, caller.id), op.eq(a.providerId, "github")),
    columns: { accountId: true },
  });
  const ghId = Number(ghAccount?.accountId);
  const token = await githubAccessToken(c.env, caller.id);
  if (!Number.isFinite(ghId) || !token) return c.json({ classes: [] });

  // Reconcile against the user's LIVE installations — the installationId we
  // stored can go stale on reinstall, and an org the user uninstalled the
  // App from must be dropped (its class row is skipped, not deleted).
  const byOrgId = await userInstallationsByOrgId(token);
  const orgIds = [...byOrgId.keys()];

  const rows =
    orgIds.length === 0
      ? []
      : await db
          .select()
          .from(classes)
          .where(inArray(classes.orgId, orgIds))
          // Newest class first — the response keeps this order (the loop
          // below pushes in row order).
          .orderBy(desc(classes.createdAt));

  // One query for every candidate class's labs; emitted per class below
  // (labs of classes the caller can't see are never pushed).
  const labRows =
    rows.length === 0
      ? []
      : await db
          .select()
          .from(labs)
          .where(
            inArray(
              labs.classId,
              rows.map((r) => r.id),
            ),
          )
          // Latest deadline first — the per-class filter below keeps this
          // order in the response.
          .orderBy(desc(labs.deadline));

  // TODO: discuss this transformation and propose the move the transformation to frontend
  const out: Array<{
    id: string;
    orgId: number;
    /** The client groups classes into semesters by creation date. */
    createdAt: Date;
    login: string;
    name: string | null;
    avatarUrl: string;
    joinToken: string;
    teachers: OrgPerson[];
    students: OrgPerson[];
    pending: OrgPerson[];
    /** Labs users linked to the members' GitHub accounts — raw query rows;
     *  the client correlates them with the people lists by github id. */
    users: Array<{ githubId: string; user: typeof user.$inferSelect }>;
    labs: Lab[];
  }> = [];
  for (const cls of rows) {
    const live = byOrgId.get(cls.orgId);
    if (!live) continue; // App uninstalled from this org — skip.
    try {
      // One people fetch serves both the teacher check (F5a: only live org
      // Owners see the class) and the card's people chips.
      const people = await orgPeople(c.env, live.installationId, live.login);
      if (!people.teachers.some((t) => t.id === ghId)) {
        continue;
      }
      if (live.installationId !== cls.installationId) {
        await db
          .update(classes)
          .set({ installationId: live.installationId, updatedAt: new Date() })
          .where(eq(classes.orgId, cls.orgId));
      }
      const org = await orgInfo(c.env, live.installationId, live.login);
      // SWITCH users linked to the members' GitHub accounts. Teachers are
      // never empty (the caller is one), so inArray is safe. Pending
      // invitees carry an invitation id, not a user id — never looked up.
      const users = await db
        .select({ githubId: account.accountId, user })
        .from(account)
        .innerJoin(user, eq(account.userId, user.id))
        .where(
          and(
            eq(account.providerId, "github"),
            inArray(
              account.accountId,
              [...people.teachers, ...people.students].map((p) => String(p.id)),
            ),
          ),
        );
      out.push({
        id: cls.id,
        orgId: cls.orgId,
        createdAt: cls.createdAt,
        joinToken: cls.joinToken,
        login: org.login,
        name: org.name,
        avatarUrl: org.avatarUrl,
        teachers: people.teachers,
        students: people.students,
        pending: people.pending,
        users,
        labs: labRows.filter((l) => l.classId === cls.id),
      });
    } catch {
      // One org's failure (rate limit, revoked install, admin-check error)
      // must not 500 the whole list — skip this class, keep going.
    }
  }
  return c.json({ classes: out });
});

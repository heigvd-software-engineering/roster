import {
  account,
  type Class,
  classes,
  classMembers,
  getDb,
  type Lab,
  labs,
  user,
} from "@labs/db";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { authedFactory } from "../factory";
import {
  callerGithub,
  linkedUsers,
  resolveClassAsTeacher,
} from "../lib/access";
import { githubAccessToken } from "../lib/auth/github-token";
import { syncRoster } from "../lib/enrollment";
import {
  basePermission,
  type OrgPerson,
  orgPeople,
  setBasePermissionNone,
} from "../lib/github/org";
import { userInstallationsByOrgId } from "../lib/github/user";

/** Syncs the enrollment display cache from the live roster — the ONE cache write
 *  still on this read path. The `classes` row is no longer touched here: the
 *  installation pointer belongs to `setup.ts` and the `installation` reconciler,
 *  and the org identity cache to the `identity` reconciler. Both are behind the
 *  teacher's explicit Reconcile action now.
 *
 *  Still a pure cache (data-model spec §2: drift self-heals, it never gates
 *  access), so callers treat it as fail-open — log and continue, never let it
 *  remove a class the caller is demonstrably a teacher of. F4 removes this too. */
async function refreshCaches(
  db: ReturnType<typeof getDb>,
  cls: Class,
  people: Awaited<ReturnType<typeof orgPeople>>,
) {
  const observed = (p: OrgPerson) => ({
    githubId: String(p.id),
    login: p.login,
    avatarUrl: p.avatarUrl,
  });
  await syncRoster(db, cls.id, {
    active: people.students.map(observed),
    pending: people.pending.map(observed),
    teacher: people.teachers.map(observed),
  });
}

/** Teacher-only: lock the class org's base repository permission to "none"
 *  and verify it took. */
export const confirmClass = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsTeacher(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);

  await setBasePermissionNone(c.env, access.cls.installationId, access.org);
  const verified = await basePermission(
    c.env,
    access.cls.installationId,
    access.org,
  );
  return c.json({
    ok: verified === "none",
    org: { login: access.org },
  });
});

/** The teacher hub's data: the caller's classes (live org Owner check),
 *  each with live people, linked labs users, and its labs. `?from=<iso>`
 *  windows the list by class creation date BEFORE any live GitHub work —
 *  the hub loads only the current semester and pages older ones on demand;
 *  `hasOlder` (pure DB) tells the client whether "Load more" has anything
 *  left to fetch. */
export const listClasses = authedFactory.createHandlers(async (c) => {
  const db = getDb(c.env.DB);
  const callerUser = c.get("user");
  const fromParam = c.req.query("from");
  const from = fromParam ? new Date(fromParam) : null;
  if (from && Number.isNaN(from.getTime())) {
    return c.json({ error: "bad_from" }, 400);
  }

  // Identity first: the caller's github id (teacher check) and a usable
  // OAuth token (installations call, refreshed if expired) — either missing
  // means there's nothing to list.
  const caller = await callerGithub(db, callerUser.id);
  const token = await githubAccessToken(c.env, callerUser.id);
  if (!caller || !token) {
    return c.json({ classes: [], enrolled: [], hasOlder: false });
  }

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
          .where(
            and(
              inArray(classes.orgId, orgIds),
              ...(from ? [gte(classes.createdAt, from)] : []),
            ),
          )
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

    // ONLY the GitHub fetch is skippable. An org can rate-limit, revoke its
    // installation, or vanish; that is this class's problem. Everything below
    // is ours, and a failure there is a bug, not org state.
    let people: Awaited<ReturnType<typeof orgPeople>>;
    try {
      // Serves both the teacher check (F5a: only live org Owners see the
      // class) and the card's people chips. No `orgInfo` call: `login` and
      // `avatarUrl` ride on the `/user/installations` payload we already have,
      // and `name` comes from the cached row until a reconcile refreshes it.
      people = await orgPeople(c.env, live.installationId, live.login);
    } catch {
      continue;
    }

    // F5a: only live org Owners see the class. Never the cache.
    if (!people.teachers.some((t) => t.id === caller.ghId)) continue;

    // Best-effort cache refresh (data-model spec §2: drift self-heals, and
    // never affects access control). A failure must not remove a class the
    // caller is demonstrably a teacher of. F4 removes this write too.
    await refreshCaches(db, cls, people).catch((err) => {
      console.warn("class roster cache refresh failed", {
        classId: cls.id,
        err,
      });
    });

    // SWITCH users linked to the members' GitHub accounts — raw rows, the
    // client correlates. Pending invitees carry an invitation id, not a
    // user id — never looked up.
    const users = await linkedUsers(
      db,
      [...people.teachers, ...people.students].map((p) => String(p.id)),
    );
    out.push({
      id: cls.id,
      orgId: cls.orgId,
      createdAt: cls.createdAt,
      joinToken: cls.joinToken,
      // Live, and free: already fetched to find the caller's orgs.
      login: live.login,
      avatarUrl: live.avatarUrl,
      // NOT on the /user/installations payload. Cached until Reconcile.
      name: cls.name,
      teachers: people.teachers,
      students: people.students,
      pending: people.pending,
      users,
      labs: labRows.filter((l) => l.classId === cls.id),
    });
  }

  // The caller's own enrollments — the student side of the hub. Pure DB
  // read (enrollment display cache ⋈ org identity cache ⋈ labs): zero
  // GitHub calls. Classes the caller teaches never double as enrolled, and
  // a cached `teacher` state is not an enrollment.
  const teachingIds = new Set(out.map((o) => o.id));
  const memberships = (
    await db
      .select({ state: classMembers.state, cls: classes })
      .from(classMembers)
      .innerJoin(classes, eq(classMembers.classId, classes.id))
      .where(
        and(
          eq(classMembers.githubId, caller.githubId),
          inArray(classMembers.state, ["pending", "active"]),
          ...(from ? [gte(classes.createdAt, from)] : []),
        ),
      )
      .orderBy(desc(classes.createdAt))
  ).filter((m) => !teachingIds.has(m.cls.id));
  const enrolledIds = memberships.map((m) => m.cls.id);
  const enrolledLabs =
    enrolledIds.length === 0
      ? []
      : await db
          .select()
          .from(labs)
          .where(inArray(labs.classId, enrolledIds))
          .orderBy(desc(labs.deadline));
  // The classes' teachers from the same cache (+ linked SWITCH identity),
  // for the card's people popover. LEFT join: a teacher who never signed
  // in to labs still shows with their GitHub identity.
  const enrolledTeachers =
    enrolledIds.length === 0
      ? []
      : await db
          .select({
            classId: classMembers.classId,
            githubId: classMembers.githubId,
            login: classMembers.login,
            avatarUrl: classMembers.avatarUrl,
            user,
          })
          .from(classMembers)
          .leftJoin(
            account,
            and(
              eq(account.providerId, "github"),
              eq(account.accountId, classMembers.githubId),
            ),
          )
          .leftJoin(user, eq(account.userId, user.id))
          .where(
            and(
              inArray(classMembers.classId, enrolledIds),
              eq(classMembers.state, "teacher"),
            ),
          );
  const enrolled = memberships.map((m) => ({
    id: m.cls.id,
    createdAt: m.cls.createdAt,
    login: m.cls.login,
    name: m.cls.name,
    avatarUrl: m.cls.avatarUrl,
    state: m.state,
    teachers: enrolledTeachers.filter((t) => t.classId === m.cls.id),
    labs: enrolledLabs.filter((l) => l.classId === m.cls.id),
  }));

  // Anything visible-ish OLDER than the window? Pure DB — a teaching
  // candidate (class in one of the caller's installations) or an enrollment
  // created before `from`. Drives the hub's "Load more".
  let hasOlder = false;
  if (from) {
    const olderTeaching =
      orgIds.length === 0
        ? []
        : await db
            .select({ id: classes.id })
            .from(classes)
            .where(
              and(inArray(classes.orgId, orgIds), lt(classes.createdAt, from)),
            )
            .limit(1);
    const olderEnrolled = await db
      .select({ id: classes.id })
      .from(classMembers)
      .innerJoin(classes, eq(classMembers.classId, classes.id))
      .where(
        and(
          eq(classMembers.githubId, caller.githubId),
          inArray(classMembers.state, ["pending", "active"]),
          lt(classes.createdAt, from),
        ),
      )
      .limit(1);
    hasOlder = olderTeaching.length > 0 || olderEnrolled.length > 0;
  }

  return c.json({ classes: out, enrolled, hasOlder });
});

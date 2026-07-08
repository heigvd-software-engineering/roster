import {
  account,
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
import {
  basePermission,
  type OrgPerson,
  orgMembership,
  setBasePermissionNone,
} from "../lib/github/org";
import {
  fetchGithubProfile,
  userInstallationsByOrgId,
} from "../lib/github/user";

/** A cached member as the client already expects to see them. `class_members` is
 *  a DISPLAY cache — it may never authorize, and it does not here: the teacher
 *  check below is a live GitHub call. */
const person = (m: typeof classMembers.$inferSelect): OrgPerson => ({
  id: Number(m.githubId),
  login: m.login ?? "unknown",
  avatarUrl: m.avatarUrl,
});

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

  // The caller's LIVE installations. An org the user uninstalled the App from
  // must be dropped (its class row is skipped, not deleted) — without an
  // installation token there is no way to authorize them against it at all.
  // NOTE: this lists installations the caller can ACCESS, not ones they own — a
  // student with push on a work repo appears here — so it decides nothing on its
  // own. The per-class Owner check below is what grants the class.
  const byOrgId = await userInstallationsByOrgId(token);
  const orgIds = [...byOrgId.keys()];

  // One profile fetch for the whole request; orgMembership is keyed on login.
  const profile = orgIds.length === 0 ? null : await fetchGithubProfile(token);
  if (orgIds.length > 0 && !profile) {
    return c.json({ classes: [], enrolled: [], hasOlder: false });
  }

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

  // The people, from the enrollment DISPLAY cache — one query for every
  // candidate class. Reconcile is what keeps it true; this read never writes.
  const memberRows =
    rows.length === 0
      ? []
      : await db
          .select()
          .from(classMembers)
          .where(
            inArray(
              classMembers.classId,
              rows.map((r) => r.id),
            ),
          );

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
    let membership: Awaited<ReturnType<typeof orgMembership>>;
    try {
      // F5a: only live org Owners see the class. ONE request — `class_members`
      // may never authorize, and a cached `teacher` row is a display fact, not
      // a role. No `orgPeople` (three paginated calls) and no `orgInfo`: the
      // chips come from the cache, `login`/`avatarUrl` ride on the
      // /user/installations payload, and `name` waits for a reconcile.
      membership = await orgMembership(
        c.env,
        live.installationId,
        live.login,
        profile?.login ?? "",
      );
    } catch {
      continue;
    }
    if (membership?.role !== "admin") continue;

    const members = memberRows.filter((m) => m.classId === cls.id);
    const teachers = members.filter((m) => m.state === "teacher").map(person);
    const students = members.filter((m) => m.state === "active").map(person);
    const pending = members.filter((m) => m.state === "pending").map(person);

    // SWITCH users linked to the members' GitHub accounts — raw rows, the
    // client correlates. Pending invitees carry an invitation id, not a
    // user id — never looked up.
    const users = await linkedUsers(
      db,
      [...teachers, ...students].map((p) => String(p.id)),
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
      teachers,
      students,
      pending,
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

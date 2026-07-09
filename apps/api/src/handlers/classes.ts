import { account, classes, classMembers, getDb, labs, user } from "@labs/db";
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
  setBasePermissionNone,
} from "../lib/github/org";
import {
  userInstallationsByOrgId,
  userOrgMemberships,
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

  // The caller's LIVE reach in TWO bulk GitHub calls — a fixed cost however
  // many classes there are (fan-out spec 2026-07-08). Independent questions,
  // so they run in parallel:
  //
  // - `userInstallationsByOrgId` (GET /user/installations) — which orgs the
  //   App can still reach FOR THIS CALLER. An org the user uninstalled the
  //   App from is dropped (its class row is skipped, not deleted): without
  //   an installation token there is no way to authorize anyone against it.
  //   It lists orgs the caller can ACCESS, not ones they own — a student
  //   with push on a work repo appears here too — so it decides nothing on
  //   its own. Its payload also carries each org's login/avatar, which the
  //   class cards render for free.
  //
  // - `userOrgMemberships` (GET /user/memberships/orgs) — the caller's role
  //   and state in EVERY org they belong to, answered at once. Implicitly
  //   scoped to the token's user, so no profile fetch to learn the login.
  //
  // The Owner check is their intersection (the `visible` filter below): the
  // org is in both maps AND the membership says admin + active. As live as
  // the old per-class check — same question, 2 calls instead of 2 + N.
  const [byOrgId, membershipByLogin] = await Promise.all([
    userInstallationsByOrgId(token),
    userOrgMemberships(token),
  ]);
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

  // F5a: only live org Owners see the class — `class_members` may never
  // authorize, and a cached `teacher` row is a display fact, not a role. The
  // check is the intersection of the two bulk maps: the App still reaches the
  // org AND the caller is an active admin in it. An org that answered neither
  // call (rate-limited, revoked, vanished) is simply absent — skipped, never
  // shown. No `orgPeople` (three paginated calls) and no `orgInfo`: the chips
  // come from the cache, `login`/`avatarUrl` ride on the /user/installations
  // payload, and `name` waits for a reconcile.
  const visible = rows.flatMap((cls) => {
    const live = byOrgId.get(cls.orgId);
    if (!live) return []; // App uninstalled from this org — skip.
    const membership = membershipByLogin.get(live.login.toLowerCase());
    // An invited-but-pending Owner is not an Owner yet.
    if (membership?.role !== "admin" || membership.state !== "active")
      return [];
    return [{ cls, live }];
  });

  // SWITCH users linked to the visible members' GitHub accounts — ONE query
  // for all classes; raw rows, the client correlates by github id. Pending
  // invitees carry an invitation id, not a user id — never looked up.
  const visibleIds = new Set(visible.map((v) => v.cls.id));
  const activeMembers = memberRows.filter(
    (m) => visibleIds.has(m.classId) && m.state !== "pending",
  );
  const allLinked = await linkedUsers(db, [
    ...new Set(activeMembers.map((m) => m.githubId)),
  ]);

  const out = visible.map(({ cls, live }) => {
    const members = memberRows.filter((m) => m.classId === cls.id);
    const memberIds = new Set(
      members.filter((m) => m.state !== "pending").map((m) => m.githubId),
    );
    return {
      id: cls.id,
      orgId: cls.orgId,
      /** The client groups classes into semesters by creation date. */
      createdAt: cls.createdAt,
      joinToken: cls.joinToken,
      // Live, and free: already fetched to find the caller's orgs.
      login: live.login,
      avatarUrl: live.avatarUrl,
      // NOT on the /user/installations payload. Cached until Reconcile.
      name: cls.name,
      teachers: members.filter((m) => m.state === "teacher").map(person),
      students: members.filter((m) => m.state === "active").map(person),
      pending: members.filter((m) => m.state === "pending").map(person),
      users: allLinked.filter((u) => memberIds.has(u.githubId)),
      labs: labRows.filter((l) => l.classId === cls.id),
    };
  });

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

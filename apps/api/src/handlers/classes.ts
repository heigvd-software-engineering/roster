import { zValidator } from "@hono/zod-validator";
import {
  account,
  assignments,
  classes,
  classMembers,
  getDb,
  user,
} from "@roster/db";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { authedFactory } from "../factory";
import { githubAccessToken } from "../lib/auth/github-token";
import { resolveClassAsTeacher } from "../lib/class-scope";
import {
  forgetMember,
  isInvited,
  memberUserIds,
  observeMember,
} from "../lib/enrollment";
import {
  enforceOrgPolicy,
  inviteOrgAdmin,
  lookupUser,
  type OrgPerson,
  orgMembership,
  orgPolicy,
  promoteToOrgAdmin,
} from "../lib/github/org";
import {
  userInstallationsByOrgId,
  userOrgMemberships,
} from "../lib/github/user";
import { githubIdsForUser, profilesByGithubId } from "../lib/identity";
import { mintJoinToken } from "../lib/join-token";

/** A cached member in the shape the client expects. `class_members` is a
 *  display cache and may never authorize; the teacher check below is a live
 *  GitHub call.
 *
 *  `id` prefers the user id and falls back to the invitation id, all an
 *  unattributable invite has. The client keys the list on it and looks up a
 *  linked SWITCH user; the fallback finds none, which is right, since nobody
 *  knows who that invite belongs to. Falling back to 0 would collide every
 *  such invite on one id. */
const person = (m: typeof classMembers.$inferSelect): OrgPerson => ({
  id: Number(m.githubId ?? m.invitationId ?? 0),
  login: m.login ?? "unknown",
  avatarUrl: m.avatarUrl,
});

/** Teacher-only: lock the class org to roster's policy (base repository
 *  permission "none" and no member repo creation), then verify both took. */
export const confirmClass = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsTeacher(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);

  await enforceOrgPolicy(c.env, access.cls.installationId, access.org);
  const verified = await orgPolicy(
    c.env,
    access.cls.installationId,
    access.org,
  );
  return c.json({
    ok: verified.basePermission === "none" && !verified.membersCanCreateRepos,
    org: { login: access.org },
  });
});

/**
 * Teacher-only: mint a new join link for the class, retiring the old one.
 *
 * The join token is the enrollment gate: possession of the link is the whole
 * check (see handlers/join.ts), so a link that leaks outside the cohort is
 * standing permission for any signed-in roster user to be invited into the
 * GitHub org. Rotating is the only answer to that.
 *
 * Nothing else moves. Enrolled students hold org membership, which is what
 * every later check reads; the token only ever gated getting in. Safe to click
 * on suspicion alone: the cost is reissuing the link to the cohort, never
 * anyone's access.
 */
export const rotateJoinToken = authedFactory.createHandlers(async (c) => {
  const access = await resolveClassAsTeacher(c, c.req.param("id"));
  if (!access) return c.json({ error: "not_found" }, 404);

  const joinToken = mintJoinToken();
  await access.db
    .update(classes)
    .set({ joinToken, updatedAt: new Date() })
    .where(eq(classes.id, access.cls.id));
  return c.json({ joinToken });
});

/** GitHub usernames: 1–39 chars, alphanumeric or single hyphens. The API
 *  lookup is the real validator; this refuses garbage early. */
const teacherInput = z.object({
  username: z.string().trim().min(1).max(39),
});

/**
 * Teacher-only: make someone a teacher (org Owner). An active member is
 * promoted in place; a non-member gets an Owner invitation and stays
 * `pending` until they accept on GitHub. Either way this writes to the
 * `class_members` display cache (data-model spec §2): the app observes its own
 * change, so reconcile stays the repair path for out-of-band changes.
 */
export const inviteTeacher = authedFactory.createHandlers(
  zValidator("json", teacherInput),
  async (c) => {
    const access = await resolveClassAsTeacher(c, c.req.param("id"));
    if (!access) return c.json({ error: "not_found" }, 404);
    const { db, cls, org } = access;
    const { username } = c.req.valid("json");

    const ghUser = await lookupUser(c.env, cls.installationId, username);
    if (!ghUser) return c.json({ error: "no_such_user" }, 404);

    const membership = await orgMembership(
      c.env,
      cls.installationId,
      org,
      ghUser.login,
    );
    // Order matters: a pending invite of any role reads as "already invited",
    // and GitHub refuses a second invitation anyway.
    if (membership?.state === "pending") {
      return c.json({ error: "already_invited" }, 409);
    }
    if (membership?.role === "admin") {
      return c.json({ error: "already_teacher" }, 409);
    }

    if (membership) {
      // An active member (a student): promoted in place, teacher instantly.
      await promoteToOrgAdmin(c.env, cls.installationId, org, ghUser.login);
      await observeMember(
        db,
        cls.id,
        {
          githubId: String(ghUser.id),
          login: ghUser.login,
          avatarUrl: ghUser.avatarUrl,
        },
        "teacher",
      );
      return c.json({ state: "teacher" as const });
    }

    // Not in the org, so an Owner invitation. Record both ids: the invitation
    // id because the live roster reports pending people by it (so the
    // reconciler sees no drift), and the user id because we chose the invitee
    // and know it. The user id lets them find their own stale row when they
    // accept, with no login scan.
    const invitationId = await inviteOrgAdmin(
      c.env,
      cls.installationId,
      org,
      ghUser.id,
    );
    // They are not in the org (checked above), so a row still keyed by their
    // user id is stale, and would collide with the unique (classId, githubId)
    // on insert. Dropping it first is the same lazy repair used elsewhere.
    await forgetMember(db, cls.id, { githubId: String(ghUser.id) });
    await observeMember(
      db,
      cls.id,
      {
        githubId: String(ghUser.id),
        invitationId: String(invitationId),
        login: ghUser.login,
        // The invitations API returns no avatar, so `orgPeople` reports
        // pending people without one. We looked this invitee up ourselves, so
        // storing it shows a face while they are pending and leaves nothing
        // for the heal to blank later.
        avatarUrl: ghUser.avatarUrl,
      },
      // An Owner invite: `pending` alone would list them among the students.
      "pending_teacher",
    );
    return c.json({ state: "pending" as const });
  },
);

type Db = ReturnType<typeof getDb>;

/** Which classes the caller sees as a teacher: live reach ∩ ownership, nothing
 *  else. Returns the visible classes with their live org identity, plus this
 *  side's paging answer (`hasOlder`: does the same reach hold classes older
 *  than the window?). */
async function visibleTeachingClasses(
  db: Db,
  token: string,
  from: Date | null,
) {
  // The caller's live reach in two bulk GitHub calls, a fixed cost however
  // many classes there are (fan-out spec 2026-07-08). Independent questions,
  // so they run in parallel:
  //
  // - `userInstallationsByOrgId` (GET /user/installations): which orgs the App
  //   still reaches for this caller. An org the user uninstalled the App from
  //   is dropped and its class row skipped, not deleted: without an
  //   installation token nobody can be authorized against it. It lists orgs
  //   the caller can access, not ones they own (a student with push on a work
  //   repo appears too), so it decides nothing on its own. Its payload also
  //   carries each org's login and avatar, which the class cards render.
  //
  // - `userOrgMemberships` (GET /user/memberships/orgs): the caller's role and
  //   state in every org they belong to, at once. Implicitly scoped to the
  //   token's user, so no profile fetch to learn the login.
  //
  // The Owner check is their intersection (the `visible` filter below): the
  // org is in both maps and the membership says admin + active. 2 calls
  // instead of the old 2 + N, and just as live.
  const [byOrgId, orgRoles] = await Promise.all([
    userInstallationsByOrgId(token),
    userOrgMemberships(token),
  ]);
  const membershipByLogin = orgRoles.byLogin;
  const orgIds = [...byOrgId.keys()];

  // Candidates: class rows in orgs the App still reaches for this caller.
  // Reach only; the ownership half of the check comes next.
  const candidateClasses =
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
          // Newest class first; the map below emits in row order, so the
          // response keeps it.
          .orderBy(desc(classes.createdAt));

  // F5a: only live org Owners see the class. `class_members` may never
  // authorize, and a cached `teacher` row is a display fact, not a role. The
  // check intersects the two bulk maps: the App still reaches the org and the
  // caller is an active admin in it. An org missing from either call
  // (rate-limited, revoked, vanished) is skipped, never shown. No `orgPeople`
  // (three paginated calls) and no `orgInfo`: the chips come from the cache,
  // `login`/`avatarUrl` ride on the /user/installations payload, and `name`
  // waits for a reconcile.
  const visible = candidateClasses.flatMap((cls) => {
    const live = byOrgId.get(cls.orgId);
    if (!live) return []; // App uninstalled from this org.
    const membership = membershipByLogin.get(live.login.toLowerCase());
    // An invited-but-pending Owner is not an Owner yet.
    if (membership?.role !== "admin" || membership.state !== "active")
      return [];
    return [{ cls, live }];
  });

  // This side's paging: any class in the caller's reach older than the
  // window? Same reach as visibility, so the probe lives here. Pure DB,
  // limit 1.
  const hasOlder =
    from === null || orgIds.length === 0
      ? false
      : (
          await db
            .select({ id: classes.id })
            .from(classes)
            .where(
              and(inArray(classes.orgId, orgIds), lt(classes.createdAt, from)),
            )
            .limit(1)
        ).length > 0;

  return { visible, hasOlder };
}

/** The teaching side of the hub: decide visibility
 * (`visibleTeachingClasses`), then dress each visible class with its
 * assignments, cached people, and linked SWITCH users. The cache reads are
 * scoped to visible classes by construction. */
async function teachingClasses(db: Db, token: string, from: Date | null) {
  const { visible, hasOlder } = await visibleTeachingClasses(db, token, from);
  const visibleIds = visible.map((v) => v.cls.id);

  // One query for every visible class's assignments; emitted per class below.
  const assignmentRows =
    visibleIds.length === 0
      ? []
      : await db
          .select()
          .from(assignments)
          .where(inArray(assignments.classId, visibleIds))
          // Course order: effective start (startAt, else createdAt)
          // ascending, the same order the timeline draws. Deadline breaks
          // same-instant ties. The per-class filter below keeps this order.
          .orderBy(
            asc(
              sql`coalesce(${assignments.startAt}, ${assignments.createdAt})`,
            ),
            asc(assignments.deadline),
          );

  // The people, from the enrollment display cache: one query for every
  // visible class. Reconcile keeps it true, and a teacher's own accepted
  // invitation resolves when the session is read (see
  // `lib/auth/accepted-invitation-heal`). This read writes nothing.
  const memberRows =
    visibleIds.length === 0
      ? []
      : await db
          .select()
          .from(classMembers)
          .where(inArray(classMembers.classId, visibleIds));

  // SWITCH users linked to the members' GitHub accounts: one query for all
  // classes, raw rows, and the client correlates by github id. `githubId`
  // means exactly one thing, so matching it against `account.accountId` is
  // always sound; no id-space guard, only the state filter the display wants.
  const activeMembers = memberRows.filter((m) => !isInvited(m.state));
  const allLinked = await profilesByGithubId(db, memberUserIds(activeMembers));

  const teaching = visible.map(({ cls, live }) => {
    const members = memberRows.filter((m) => m.classId === cls.id);
    const memberIds = new Set(
      members.filter((m) => !isInvited(m.state)).map((m) => m.githubId),
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
      // Not on the /user/installations payload. Cached until reconcile.
      name: cls.name,
      teachers: members.filter((m) => m.state === "teacher").map(person),
      students: members.filter((m) => m.state === "active").map(person),
      // Open invitations sit beside the role they were invited to: an invited
      // teacher belongs with the teachers, not among the students.
      pending: members.filter((m) => m.state === "pending").map(person),
      pendingTeachers: members
        .filter((m) => m.state === "pending_teacher")
        .map(person),
      users: allLinked.filter((u) => memberIds.has(u.githubId)),
      assignments: assignmentRows.filter((l) => l.classId === cls.id),
    };
  });
  return { teaching, hasOlder };
}

/** The enrolled side of the hub: the caller's own enrollments, plus this
 *  side's paging answer (`hasOlder`). Pure DB read (enrollment display cache ⋈
 *  org identity cache ⋈ assignments), zero GitHub calls, and no dependency on
 *  the teaching side; the handler owns "teaching wins" de-duplication.
 *
 *  A cached `teacher` state is not an enrollment, and `pending_teacher` stays
 *  out on purpose: someone invited to teach is enrolled in nothing, and
 *  listing them would render a student card with a "pending" badge, the wrong
 *  role at the moment they form their first impression of the job. Until they
 *  accept they have no membership, and access comes from live GitHub state,
 *  never from this cache. */
async function enrolledClasses(
  db: Db,
  callerGithubId: string,
  from: Date | null,
) {
  const memberships = await db
    .select({ state: classMembers.state, cls: classes })
    .from(classMembers)
    .innerJoin(classes, eq(classMembers.classId, classes.id))
    .where(
      and(
        eq(classMembers.githubId, callerGithubId),
        inArray(classMembers.state, ["pending", "active"]),
        ...(from ? [gte(classes.createdAt, from)] : []),
      ),
    )
    .orderBy(desc(classes.createdAt));
  const enrolledIds = memberships.map((m) => m.cls.id);
  const enrolledAssignments =
    enrolledIds.length === 0
      ? []
      : await db
          .select()
          .from(assignments)
          .where(inArray(assignments.classId, enrolledIds))
          // Same course order as the teaching hub above.
          .orderBy(
            asc(
              sql`coalesce(${assignments.startAt}, ${assignments.createdAt})`,
            ),
            asc(assignments.deadline),
          );
  // The classes' teachers from the same cache, with linked SWITCH identity,
  // for the card's people popover. Left join, so a teacher who never signed in
  // still shows their GitHub identity. Same shape as profilesByGithubId: name
  // fields plus the professional email (`user.email`, HES-SO audience). This
  // payload goes to students.
  const enrolledTeacherRows =
    enrolledIds.length === 0
      ? []
      : await db
          .select({
            classId: classMembers.classId,
            githubId: classMembers.githubId,
            login: classMembers.login,
            avatarUrl: classMembers.avatarUrl,
            userId: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            userName: user.name,
            userEmail: user.email,
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
  const enrolledTeachers = enrolledTeacherRows.map(
    ({ userId, firstName, lastName, userName, userEmail, ...member }) => ({
      ...member,
      // The email guard is for the type only: `user.email` is NOT NULL, so a
      // joined user row always carries one. The null arm is the left join's.
      user:
        userId !== null && userName !== null && userEmail !== null
          ? {
              firstName,
              lastName,
              name: userName,
              email: userEmail,
            }
          : null,
    }),
  );
  const enrolled = memberships.map((m) => ({
    id: m.cls.id,
    createdAt: m.cls.createdAt,
    login: m.cls.login,
    name: m.cls.name,
    avatarUrl: m.cls.avatarUrl,
    state: m.state,
    teachers: enrolledTeachers.filter((t) => t.classId === m.cls.id),
    assignments: enrolledAssignments.filter((l) => l.classId === m.cls.id),
  }));

  // This side's paging: any enrollment older than the window? Same shape as
  // the teaching probe, pure DB, limit 1.
  const hasOlder =
    from === null
      ? false
      : (
          await db
            .select({ id: classes.id })
            .from(classMembers)
            .innerJoin(classes, eq(classMembers.classId, classes.id))
            .where(
              and(
                eq(classMembers.githubId, callerGithubId),
                inArray(classMembers.state, ["pending", "active"]),
                lt(classes.createdAt, from),
              ),
            )
            .limit(1)
        ).length > 0;

  return { enrolled, hasOlder };
}

/** The teacher hub's data: the caller's classes (live org Owner check), each
 *  with live people, linked roster users, and its assignments. `?from=<iso>`
 *  windows the list by class creation date before any live GitHub work, so the
 *  hub loads the current semester and pages older ones on demand; each side
 *  reports its own `hasOlder` (pure DB), OR-ed here for "Load more".
 *
 *  This handler parses, resolves identity, and composes
 *  `visibleTeachingClasses` (who may see what), `teachingClasses` (dress the
 *  visible), and `enrolledClasses`. It also owns the "teaching wins"
 *  de-duplication: the cache can hold a stale student row for someone who now
 *  teaches the class (a promoted student), and without the exclusion the class
 *  would render twice. */
export const listClasses = authedFactory.createHandlers(async (c) => {
  const db = getDb(c.env.DB);
  const callerUser = c.get("user");
  const fromParam = c.req.query("from");
  const from = fromParam ? new Date(fromParam) : null;
  if (from && Number.isNaN(from.getTime())) {
    return c.json({ error: "bad_from" }, 400);
  }

  // Identity first: the caller's github id (teacher check) and a usable OAuth
  // token (installations call, refreshed if expired). Either one missing means
  // there is nothing to list.
  const caller = await githubIdsForUser(db, callerUser.id);
  const token = await githubAccessToken(c.env, callerUser.id);
  if (!caller || !token) {
    return c.json({ classes: [], enrolled: [], hasOlder: false });
  }

  // Independent sides: the enrolled one is pure DB and need not wait for the
  // teaching side's GitHub round-trips.
  const [teachingSide, enrolledSide] = await Promise.all([
    teachingClasses(db, token, from),
    enrolledClasses(db, caller.githubId, from),
  ]);
  const teachingIds = new Set(teachingSide.teaching.map((t) => t.id));
  const enrolled = enrolledSide.enrolled.filter((e) => !teachingIds.has(e.id));

  return c.json({
    classes: teachingSide.teaching,
    enrolled,
    hasOlder: teachingSide.hasOlder || enrolledSide.hasOlder,
  });
});

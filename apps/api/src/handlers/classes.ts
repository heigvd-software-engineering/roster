import { zValidator } from "@hono/zod-validator";
import { account, classes, classMembers, getDb, labs, user } from "@roster/db";
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

/** A cached member as the client already expects to see them. `class_members` is
 *  a DISPLAY cache — it may never authorize, and it does not here: the teacher
 *  check below is a live GitHub call.
 *
 *  `id` prefers the USER id and falls back to the invitation id, which is what
 *  an unattributable invite has instead of one. The client uses it to key the
 *  list and to look up a linked SWITCH user; the fallback finds no user, which
 *  is correct — nobody knows who that invite belongs to. Falling back to 0
 *  would instead make every such invite collide on one id. */
const person = (m: typeof classMembers.$inferSelect): OrgPerson => ({
  id: Number(m.githubId ?? m.invitationId ?? 0),
  login: m.login ?? "unknown",
  avatarUrl: m.avatarUrl,
});

/** Teacher-only: lock the class org to roster's policy — base repository
 *  permission "none" AND no member repo creation — and verify both took. */
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

/** GitHub usernames: 1–39 chars, alphanumeric or single hyphens. The API
 *  lookup is the real validator; this just refuses garbage early. */
const teacherInput = z.object({
  username: z.string().trim().min(1).max(39),
});

/**
 * Teacher-only: make someone a teacher (org Owner). An active member is
 * promoted in place; a non-member gets an Owner invitation and stays
 * `pending` until they accept on GitHub. Either way this is a WRITE POINT
 * for the `class_members` display cache (data-model spec §2): the app
 * observes its own change, so no reconcile run is needed — that stays the
 * repair path for out-of-band changes only.
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
    // Order matters: a pending invite (whatever its role) reads as "already
    // invited" — GitHub refuses a second invitation anyway.
    if (membership?.state === "pending") {
      return c.json({ error: "already_invited" }, 409);
    }
    if (membership?.role === "admin") {
      return c.json({ error: "already_teacher" }, 409);
    }

    if (membership) {
      // An active member (a student) — promoted in place, teacher instantly.
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

    // Not in the org — an Owner invitation. We record BOTH ids: the invitation
    // id because that is how the live roster reports pending people (so the
    // reconciler sees no drift), and the user id because WE chose the invitee
    // and therefore know it. That second one is what lets them find their own
    // stale row by id when they accept, with no login scan.
    const invitationId = await inviteOrgAdmin(
      c.env,
      cls.installationId,
      org,
      ghUser.id,
    );
    // They are NOT in the org (checked above), so any row still keyed by their
    // user id is stale — and would collide with the unique (classId, githubId)
    // on insert. Dropping it first is the same lazy repair as everywhere else.
    await forgetMember(db, cls.id, { githubId: String(ghUser.id) });
    await observeMember(
      db,
      cls.id,
      {
        githubId: String(ghUser.id),
        invitationId: String(invitationId),
        login: ghUser.login,
        // The invitations API returns no avatar, so `orgPeople` reports pending
        // people without one — but that is GitHub's limit, not ours: WE chose
        // this invitee and looked them up. Storing it shows a face while they
        // are pending, and leaves nothing for the heal to blank later.
        avatarUrl: ghUser.avatarUrl,
      },
      // An OWNER invite — `pending` alone would read as an invited student and
      // list them among the students.
      "pending_teacher",
    );
    return c.json({ state: "pending" as const });
  },
);

type Db = ReturnType<typeof getDb>;

/** WHICH classes can the caller see as a teacher? Live reach ∩ ownership,
 *  nothing else — returns the visible classes with their live org identity,
 *  plus this side's paging answer (`hasOlder`: does the same reach hold
 *  classes older than the window?). */
async function visibleTeachingClasses(
  db: Db,
  token: string,
  from: Date | null,
) {
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
  const [byOrgId, orgRoles] = await Promise.all([
    userInstallationsByOrgId(token),
    userOrgMemberships(token),
  ]);
  const membershipByLogin = orgRoles.byLogin;
  const orgIds = [...byOrgId.keys()];

  // Candidates: class rows in orgs the App still reaches for this caller —
  // reach alone, the ownership half of the check comes next.
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
          // Newest class first — the response keeps this order (the map
          // below emits in row order).
          .orderBy(desc(classes.createdAt));

  // F5a: only live org Owners see the class — `class_members` may never
  // authorize, and a cached `teacher` row is a display fact, not a role. The
  // check is the intersection of the two bulk maps: the App still reaches the
  // org AND the caller is an active admin in it. An org that answered neither
  // call (rate-limited, revoked, vanished) is simply absent — skipped, never
  // shown. No `orgPeople` (three paginated calls) and no `orgInfo`: the chips
  // come from the cache, `login`/`avatarUrl` ride on the /user/installations
  // payload, and `name` waits for a reconcile.
  const visible = candidateClasses.flatMap((cls) => {
    const live = byOrgId.get(cls.orgId);
    if (!live) return []; // App uninstalled from this org — skip.
    const membership = membershipByLogin.get(live.login.toLowerCase());
    // An invited-but-pending Owner is not an Owner yet.
    if (membership?.role !== "admin" || membership.state !== "active")
      return [];
    return [{ cls, live }];
  });

  // This side's paging: any class in the caller's reach OLDER than the
  // window? Visibility and paging ask about the same reach, so the probe
  // lives here — pure DB, limit 1.
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

/** The TEACHING side of the hub: decide visibility
 *  (`visibleTeachingClasses`), then DRESS each visible class — its labs,
 *  cached people, and linked SWITCH users. The cache reads are scoped to
 *  visible classes by construction. */
async function teachingClasses(db: Db, token: string, from: Date | null) {
  const { visible, hasOlder } = await visibleTeachingClasses(db, token, from);
  const visibleIds = visible.map((v) => v.cls.id);

  // One query for every visible class's labs; emitted per class below.
  const labRows =
    visibleIds.length === 0
      ? []
      : await db
          .select()
          .from(labs)
          .where(inArray(labs.classId, visibleIds))
          // Course order: effective start (startAt, else createdAt) ASC —
          // the first lab worked on comes first, same order the timeline
          // draws. Deadline breaks same-instant ties. The per-class filter
          // below keeps this order in the response.
          .orderBy(
            asc(sql`coalesce(${labs.startAt}, ${labs.createdAt})`),
            asc(labs.deadline),
          );

  // The people, from the enrollment DISPLAY cache — one query for every
  // visible class. Reconcile is what keeps it true; a teacher's own accepted
  // invitation is resolved when the SESSION is read (see
  // `lib/auth/accepted-invitation-heal`), never here — this is a read that
  // writes nothing.
  const memberRows =
    visibleIds.length === 0
      ? []
      : await db
          .select()
          .from(classMembers)
          .where(inArray(classMembers.classId, visibleIds));

  // SWITCH users linked to the members' GitHub accounts — ONE query for all
  // classes; raw rows, the client correlates by github id. `githubId` means
  // exactly one thing, so matching it against `account.accountId` is always
  // sound — no id-space guard needed, only the state filter the display
  // already wants.
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
      // NOT on the /user/installations payload. Cached until Reconcile.
      name: cls.name,
      teachers: members.filter((m) => m.state === "teacher").map(person),
      students: members.filter((m) => m.state === "active").map(person),
      // Open invitations, kept beside the role they were invited to: an
      // invited teacher belongs with the teachers, not among the students.
      pending: members.filter((m) => m.state === "pending").map(person),
      pendingTeachers: members
        .filter((m) => m.state === "pending_teacher")
        .map(person),
      users: allLinked.filter((u) => memberIds.has(u.githubId)),
      labs: labRows.filter((l) => l.classId === cls.id),
    };
  });
  return { teaching, hasOlder };
}

/** The ENROLLED side of the hub — the caller's own enrollments, plus this
 *  side's paging answer (`hasOlder`). Pure DB read (enrollment display
 *  cache ⋈ org identity cache ⋈ labs): zero GitHub calls, no dependency on
 *  the teaching side — "teaching wins" de-duplication is the HANDLER's job.
 *
 *  A cached `teacher` state is not an enrollment, and `pending_teacher` is
 *  NOT here on purpose. Someone invited to teach is not enrolled in
 *  anything, and listing them would render a student card with a "pending"
 *  badge — the wrong role at the one moment they are forming an impression
 *  of what they've been asked to do. They see nothing until they accept,
 *  which is also the truth: until then they have no membership, and access
 *  comes from live GitHub state, never from this cache. */
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
  const enrolledLabs =
    enrolledIds.length === 0
      ? []
      : await db
          .select()
          .from(labs)
          .where(inArray(labs.classId, enrolledIds))
          // Same course order as the teaching hub above.
          .orderBy(
            asc(sql`coalesce(${labs.startAt}, ${labs.createdAt})`),
            asc(labs.deadline),
          );
  // The classes' teachers from the same cache (+ linked SWITCH identity),
  // for the card's people popover. LEFT join: a teacher who never signed
  // in to labs still shows with their GitHub identity. Same shape as
  // profilesByGithubId — name fields + the professional email (`user.email`,
  // HES-SO audience): this payload goes to STUDENTS.
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
      // The email guard is for the TYPE only — `user.email` is NOT NULL, so a
      // joined user row always carries one; the null arm is the left join's.
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
    labs: enrolledLabs.filter((l) => l.classId === m.cls.id),
  }));

  // This side's paging: any enrollment OLDER than the window? Same shape as
  // the teaching probe — pure DB, limit 1.
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

/** The teacher hub's data: the caller's classes (live org Owner check),
 *  each with live people, linked roster users, and its labs. `?from=<iso>`
 *  windows the list by class creation date BEFORE any live GitHub work —
 *  the hub loads only the current semester and pages older ones on demand;
 *  each side reports its own `hasOlder` (pure DB), OR-ed here for the
 *  client's "Load more". The sections are `visibleTeachingClasses` (who may
 *  see what), `teachingClasses` (dress the visible), and `enrolledClasses`;
 *  this handler only parses, resolves identity, composes — and owns the
 *  "teaching wins" de-duplication (the cache can hold a stale student row
 *  for someone who NOW teaches that class, e.g. a promoted student; without
 *  the exclusion the class would render twice). */
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
  const caller = await githubIdsForUser(db, callerUser.id);
  const token = await githubAccessToken(c.env, callerUser.id);
  if (!caller || !token) {
    return c.json({ classes: [], enrolled: [], hasOlder: false });
  }

  // Independent sides — the enrolled one is pure DB and need not wait for
  // the teaching side's GitHub round-trips.
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

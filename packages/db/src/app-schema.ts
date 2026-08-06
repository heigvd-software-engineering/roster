// Hand-owned app tables. Add new feature tables here, never in auth-schema.ts,
// which the Better Auth CLI overwrites on regeneration.
import {
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

/** A connected class: a thin anchor to a GitHub org App installation (F3). */
export const classes = sqliteTable("classes", {
  id: text("id").primaryKey(),
  // The real key: the org account id survives a reinstall.
  orgId: integer("org_id").notNull().unique(),
  // Refreshable: changes on reinstall (reconciled on read).
  installationId: integer("installation_id").notNull(),
  connectedByUserId: text("connected_by_user_id")
    .notNull()
    .references(() => user.id),
  // Join-link capability token (F4): holding the link is the only enrollment
  // gate. Drizzle enforces NOT NULL, but the SQLite column is nullable (ADD
  // COLUMN limit), so every insert path must mint one.
  joinToken: text("join_token").notNull().unique(),
  status: text("status", { enum: ["active", "archived"] })
    .notNull()
    .default("active"),
  // Org identity cache so the student class list is a pure DB read, refreshed
  // whenever a teacher path fetches orgInfo live (data-model spec §2).
  // Nullable: backfilled on the next teacher visit.
  login: text("login"),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/** An assignment: deadline and group settings (F6). Students see it on
 *  creation; the deadline controls timing. Accept (F8) consumes the template
 *  columns. */
export const assignments = sqliteTable(
  "assignments",
  {
    id: text("id").primaryKey(),
    classId: text("class_id")
      .notNull()
      .references(() => classes.id),
    title: text("title").notNull(),
    // Optional starter code (F8): a template repo in the class org. Work repos
    // are created from it via /generate; null gives an empty auto-init repo.
    templateRepoId: integer("template_repo_id"),
    templateRepoFullName: text("template_repo_full_name"),
    deadline: integer("deadline", { mode: "timestamp" }).notNull(),
    // Start gate: before this moment students see the assignment but cannot act
    // on it, so no groups, no repos, no starter code. Null starts it at
    // creation. Ranges of different assignments may overlap.
    startAt: integer("start_at", { mode: "timestamp" }),
    // `individual` = a group of one (min=max=1); `group` uses min/maxMembers.
    groupMode: text("group_mode", { enum: ["individual", "group"] })
      .notNull()
      .default("individual"),
    minMembers: integer("min_members"),
    maxMembers: integer("max_members"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  // A group's slug, and therefore its work repo name, is
  // slugify(assignment.title)-slugify(group.name). Without this constraint two
  // assignments in one class share a repo namespace: their groups compute the
  // same repo name in the same org, so the work-repos reconciler could adopt
  // one assignment's student work into another assignment's group.
  (t) => [unique().on(t.classId, t.title)],
);

/**
 * A student group: a GitHub Team owning exactly one assignment. Groups are
 * copied per assignment, never shared across them. Three identifiers,
 * deliberately distinct:
 *   - `name`       display label ("Team Alpha"), never sent to GitHub. Unique
 *                  per (assignmentId, name), so friendly names reuse across
 *                  assignments.
 *   - `slug`       `assignmentSlug-groupSlug`, org-unique by construction;
 *                  this is what we hand GitHub as the team's name.
 *   - `ghTeamSlug` GitHub's returned slug, the source of truth for API paths
 *                  and the repo name; equals `slug` unless GitHub deduped.
 * The work repo folds in here, since one assignment per group makes the group
 * the participation. The roster stays the team's live member list.
 * `creatorUserId` records provenance only. The class comes from
 * assignments.classId.
 */
export const groups = sqliteTable(
  "groups",
  {
    id: text("id").primaryKey(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id),
    // The real key: slugs change on rename.
    ghTeamId: integer("gh_team_id").notNull().unique(),
    ghTeamSlug: text("gh_team_slug").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    // Created once the group meets the assignment's min size; null while still
    // forming. The team gets push on it.
    ghRepoId: integer("gh_repo_id").unique(),
    ghRepoFullName: text("gh_repo_full_name"),
    creatorUserId: text("creator_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique().on(t.assignmentId, t.name),
    unique().on(t.assignmentId, t.slug),
  ],
);

/**
 * Display cache of the backing GitHub Team's member list, which GitHub owns.
 * `syncGroupMembers` rewrites it after every membership mutation by re-reading
 * the one team it changed; the `group-members` reconciler catches drift from
 * edits made on GitHub directly.
 *
 * Invariant: never authorize from this table. Team membership grants push on
 * the group's work repo, so a stale row here would be a stale grant, the same
 * hazard `class_members` carries. Push comes from the team.
 *
 * A team GitHub 404s is unknowable, not empty: sync leaves the rows alone
 * rather than delete a roster it merely failed to read.
 */
export const groupMembers = sqliteTable(
  "group_members",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      // The group row IS the group; a deleted group has no roster to cache.
      .references(() => groups.id, { onDelete: "cascade" }),
    // GitHub user account id, stable across login renames, like class_members.
    githubId: text("github_id").notNull(),
    // Identity cache; the GitHub Team API takes `login` for add and remove.
    login: text("login").notNull(),
    avatarUrl: text("avatar_url"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [unique().on(t.groupId, t.githubId)],
);

/**
 * Display cache of org membership, which GitHub owns (data-model spec §2).
 * Written where the app already observes it (join flow, the teacher hub's
 * roster fetch) and repaired lazily. Invariant: never authorize from this
 * table. A stale row may show a dead class card; it must never grant access.
 */
export const classMembers = sqliteTable(
  "class_members",
  {
    id: text("id").primaryKey(),
    classId: text("class_id")
      .notNull()
      .references(() => classes.id),
    // GitHub user account id, matching `account.accountId`. Webhooks, the API
    // and orgPeople carry GitHub ids, not app user ids; resolve to an app user
    // through the `account` table rather than storing a userId here.
    //
    // Null only for a `pending` row read from the live roster:
    // `GET /orgs/{org}/invitations` returns the invitation id, login and email
    // but not the invitee's user id, so an invite made on GitHub directly (or
    // by email) has none to record. Our own invites fill it (inviteTeacher
    // knows `ghUser.id`), which lets an accepting teacher find their own stale
    // row by id alone.
    githubId: text("github_id"),
    // The open GitHub invitation's id, set on every `pending` row. It keeps its
    // own column so `githubId` means one thing: the live roster reports pending
    // people under this id, so the reconciler diffs them without inventing a
    // user id.
    invitationId: text("invitation_id"),
    // Where this person stands with the org, role included. `teacher` and
    // `active` are the same membership state and differ only by role, and the
    // two pending values mirror that for an unanswered invitation. This one
    // axis is what tells an invited teacher from an invited student; a separate
    // role column would repeat it, for pending rows only. `teacher` is cached
    // so the student class card can name its teachers without a GitHub call.
    // Display only, like the rest.
    state: text("state", {
      enum: ["pending", "pending_teacher", "active", "teacher"],
    }).notNull(),
    // Identity cache; both write points know it when they observe the
    // membership (orgPeople rows, the joiner's profile).
    login: text("login"),
    avatarUrl: text("avatar_url"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  // One row per person per class, but "person" spans two id spaces, so it takes
  // two constraints instead of one. Neither needs `WHERE ... IS NOT NULL`:
  // SQLite treats NULLs as distinct in a unique index, so each already
  // constrains only the rows where its column is set. Both stay non-partial on
  // purpose, since a partial index is an upsert target only if the ON CONFLICT
  // clause repeats its predicate, and `observeMember` upserts on both.
  (t) => [
    unique().on(t.classId, t.invitationId),
    unique().on(t.classId, t.githubId),
    // "Which classes has this person been invited to?" runs at every sign-in,
    // for every user, across all classes. The unique index above leads with
    // `classId`, so it cannot answer a github-id-only lookup, and without this
    // the question scans every membership row in the system.
    index("class_members_github_id_idx").on(t.githubId),
  ],
);

/**
 * Class-creation capability: the row's presence is the grant, so no boolean can
 * drift. A super admin grants and revokes it; super admins come from
 * config-listed emails, never from this table (see the API's
 * lib/auth/super-admin.ts). It gates only the setup callback's create path, so
 * grant and revoke leave existing classes and per-class roles alone.
 */
export const classCreators = sqliteTable("class_creators", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

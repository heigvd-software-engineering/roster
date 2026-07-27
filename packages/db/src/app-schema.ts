// App-domain tables — HAND-OWNED. Add new feature tables here (labs, groups,
// group_members, …); never in auth-schema.ts, which the Better Auth CLI
// overwrites on regeneration.
import {
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

/** A connected class = a thin anchor to a GitHub org App installation (F3). */
export const classes = sqliteTable("classes", {
  id: text("id").primaryKey(),
  // Stable GitHub org account id — the real key (survives reinstall).
  orgId: integer("org_id").notNull().unique(),
  // Refreshable: changes on reinstall (reconciled on read).
  installationId: integer("installation_id").notNull(),
  connectedByUserId: text("connected_by_user_id")
    .notNull()
    .references(() => user.id),
  // Join-link capability token (F4): possession of the link is the only
  // enrollment gate. NOT NULL at the app level; the SQLite column is
  // nullable (ADD COLUMN limitation) — every insert path mints one.
  joinToken: text("join_token").notNull().unique(),
  status: text("status", { enum: ["active", "archived"] })
    .notNull()
    .default("active"),
  // Org identity cache so the STUDENT class list is a pure DB read (zero
  // GitHub calls) — refreshed whenever a teacher path fetches orgInfo live
  // (data-model spec §2). Nullable: backfilled on the next teacher visit.
  login: text("login"),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/** An assignment: deadline + group settings (F6). Visible to students on
 *  creation; the deadline controls timing. Template columns arrive with
 *  accept (F8), which is what consumes them. */
export const labs = sqliteTable(
  "labs",
  {
    id: text("id").primaryKey(),
    classId: text("class_id")
      .notNull()
      .references(() => classes.id),
    title: text("title").notNull(),
    // Optional starter code (F8): a template repo in the class org — repos
    // are created via /generate from it; empty (auto-init) when null.
    templateRepoId: integer("template_repo_id"),
    templateRepoFullName: text("template_repo_full_name"),
    deadline: integer("deadline", { mode: "timestamp" }).notNull(),
    // Optional start gate: before this moment students see the lab but can't
    // act on it — no groups, no repos, and so no starter code. NULL = starts
    // at creation. Start–deadline ranges of DIFFERENT labs may overlap.
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
  // A group's slug — and therefore its WORK REPO NAME — is
  // slugify(lab.title)-slugify(group.name). Without this, two labs in one class
  // share a repo namespace: their groups compute the same repo name in the same
  // org, so the work-repos reconciler could adopt one lab's student work into
  // another lab's group.
  (t) => [unique().on(t.classId, t.title)],
);

/**
 * A student group = a GitHub Team, now **per-lab** (owns exactly one lab —
 * groups are copied per lab, never shared across them; see spec
 * `2026-07-07-per-lab-groups-design.md`). Three identifiers, deliberately
 * distinct:
 *   - `name`     display label ("Team Alpha"). NEVER sent to GitHub. Unique
 *                per (labId, name) — friendly names reuse freely across labs.
 *   - `slug`     `labSlug-groupSlug`, org-unique by construction; this is
 *                what we HAND GitHub as the team's name.
 *   - `ghTeamSlug` GitHub's returned slug (source of truth for API paths /
 *                the repo name; equals `slug` unless GitHub deduped).
 * The WORK REPO is folded in (one lab per group → group IS the
 * participation). The ROSTER stays the team's live member list.
 * `creatorUserId` is provenance only. Class is DERIVED via labs.classId.
 */
export const groups = sqliteTable(
  "groups",
  {
    id: text("id").primaryKey(),
    labId: text("lab_id")
      .notNull()
      .references(() => labs.id),
    // Stable GitHub Team id — the real key (slugs change on rename).
    ghTeamId: integer("gh_team_id").notNull().unique(),
    // GitHub's returned slug; cached for API paths + the repo name.
    ghTeamSlug: text("gh_team_slug").notNull(),
    // Our computed lab-scoped slug (what we send GitHub as the team name).
    slug: text("slug").notNull(),
    // Display label — reusable across labs, never sent to GitHub.
    name: text("name").notNull(),
    // The group's WORK REPO — created once the group meets the lab's min
    // size (where min is enforced); null while still forming. Team gets push.
    ghRepoId: integer("gh_repo_id").unique(),
    ghRepoFullName: text("gh_repo_full_name"),
    creatorUserId: text("creator_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [unique().on(t.labId, t.name), unique().on(t.labId, t.slug)],
);

/**
 * Group-roster DISPLAY CACHE — a cache of what GitHub owns (the backing Team's
 * member list). Written by `syncGroupMembers` after every membership mutation,
 * which re-reads the one team it just changed; drift from out-of-band GitHub
 * edits is caught by the `group-members` reconciler.
 *
 * INVARIANT: never used to authorize anything. Team membership grants PUSH on
 * the group's work repo, so a stale row here would be a stale grant — the same
 * hazard `class_members` carries, and the same rule. Push comes from the team,
 * never from this table.
 *
 * A team GitHub 404s is UNKNOWABLE, not empty: sync leaves the rows alone
 * rather than deleting a roster we merely failed to read.
 */
export const groupMembers = sqliteTable(
  "group_members",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      // The group row IS the group; a deleted group has no roster to cache.
      .references(() => groups.id, { onDelete: "cascade" }),
    // GitHub USER account id — stable across login renames, like class_members.
    githubId: text("github_id").notNull(),
    // Identity cache. `login` is what the GitHub Team API takes for add/remove.
    login: text("login").notNull(),
    avatarUrl: text("avatar_url"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [unique().on(t.groupId, t.githubId)],
);

/**
 * Enrollment DISPLAY CACHE (data-model spec §2) — a cache of what GitHub
 * owns (org membership), written where the app already observes it (join
 * flow, the teacher hub's roster fetch) and lazily repaired. INVARIANT:
 * never used to authorize anything — a stale row may show a dead class
 * card; it must never grant access.
 */
export const classMembers = sqliteTable(
  "class_members",
  {
    id: text("id").primaryKey(),
    classId: text("class_id")
      .notNull()
      .references(() => classes.id),
    // GitHub USER account id (matches `account.accountId`) — webhook/API
    // payloads and orgPeople carry GitHub ids, not app user ids; resolve to
    // an app user via the `account` table, never store a userId here.
    //
    // NULL only for a `pending` row we learned about from the live roster:
    // `GET /orgs/{org}/invitations` returns the invitation id, login and
    // email — never the invitee's user id — so an invite made on GitHub
    // directly (or by email) has no user id to record. Our own invites DO
    // fill it (inviteTeacher knows `ghUser.id`), which is what lets an
    // accepting teacher find their own stale row by id alone.
    githubId: text("github_id"),
    // Set on every `pending` row: the open GitHub invitation's id. Kept in
    // its OWN column so `githubId` means exactly one thing — the live
    // roster reports pending people under this id, so the reconciler still
    // diffs them without inventing a user id.
    invitationId: text("invitation_id"),
    // WHERE this person stands with the org, ROLE INCLUDED — `teacher` and
    // `active` are the same membership state and differ only by role, and the
    // two pending values mirror that for an invitation that has not been
    // answered yet. Keeping role on this one axis is why an invited teacher
    // can be told apart from an invited student at all; a separate role column
    // would say the same thing a second way, for pending rows only.
    // `teacher` is cached so the STUDENT class card can name its teachers with
    // zero GitHub calls. Display only, like the rest.
    state: text("state", {
      enum: ["pending", "pending_teacher", "active", "teacher"],
    }).notNull(),
    // GitHub identity cache (login/avatar) — both write points know it when
    // they observe the membership (orgPeople rows, the joiner's profile).
    login: text("login"),
    avatarUrl: text("avatar_url"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  // One row per person per class — but "person" is now two id spaces, so it
  // takes two constraints instead of one. No `WHERE ... IS NOT NULL` needed:
  // SQLite treats NULLs as DISTINCT in a unique index, so each of these already
  // constrains only the rows where its column is set and ignores the rest.
  // Both are plain (non-partial) on purpose — a partial index can only be an
  // upsert target if the ON CONFLICT clause repeats its predicate, and
  // `observeMember` upserts on both of these.
  (t) => [
    unique().on(t.classId, t.invitationId),
    unique().on(t.classId, t.githubId),
    // "Which classes has THIS person been invited to?" — asked at sign-in, for
    // every user, across all classes. The unique index above leads with
    // `classId`, so it cannot answer a github-id-only lookup; without this the
    // question is a full scan of every membership row in the system.
    index("class_members_github_id_idx").on(t.githubId),
  ],
);

/**
 * CLASS-CREATION capability — row presence IS the grant (no boolean to
 * drift). Granted/revoked by a super admin (config-listed emails, never
 * stored here — see the API's lib/auth/super-admin.ts). Gates ONLY the
 * setup callback's CREATE path: existing classes and per-class roles are
 * untouched by grant or revoke.
 */
export const classCreators = sqliteTable("class_creators", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

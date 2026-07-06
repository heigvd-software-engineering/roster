// App-domain tables — HAND-OWNED. Add new feature tables here (labs, groups,
// student_lab_repos, …); never in auth-schema.ts, which the Better Auth CLI
// overwrites on regeneration.
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
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
export const labs = sqliteTable("labs", {
  id: text("id").primaryKey(),
  classId: text("class_id")
    .notNull()
    .references(() => classes.id),
  title: text("title").notNull(),
  deadline: integer("deadline", { mode: "timestamp" }).notNull(),
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
});

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
    githubId: text("github_id").notNull(),
    state: text("state", { enum: ["pending", "active"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [unique().on(t.classId, t.githubId)],
);

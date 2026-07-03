// App-domain tables — HAND-OWNED. Add new feature tables here (labs, groups,
// student_lab_repos, …); never in auth-schema.ts, which the Better Auth CLI
// overwrites on regeneration.
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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

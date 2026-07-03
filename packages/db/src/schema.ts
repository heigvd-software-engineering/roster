// Combined DB schema (the barrel). This file is hand-owned and safe to edit.
//
// - Auth tables (user/session/account/verification) are CLI-GENERATED in
//   ./auth-schema.ts — never edit that file; regenerate it via
//   `pnpm --filter @labs/api run auth:schema`.
// - App-domain tables (classes, labs, groups, student_lab_repos, …) are added
//   per feature in their own sibling files (e.g. ./app-schema.ts) and
//   re-exported here, so regenerating the auth schema never touches them.

export * from "./auth-schema";

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

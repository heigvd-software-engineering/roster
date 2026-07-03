// @labs/db = the SCHEMA layer, nothing more: Drizzle table models, inferred
// entity types, and `getDb`. There is deliberately NO query-helper layer —
// endpoints write their Drizzle queries inline (decided 2026-07-03: the db
// itself is the abstraction). See README.md.
import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export * from "./schema";

export type User = typeof schema.user.$inferSelect;
export type Account = typeof schema.account.$inferSelect;
export type Class = typeof schema.classes.$inferSelect;

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

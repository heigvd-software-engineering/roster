import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export * from "./classes";
export * from "./schema";

export type User = typeof schema.user.$inferSelect;

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

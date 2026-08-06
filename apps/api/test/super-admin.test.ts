import { env } from "cloudflare:test";
import { classCreators, getDb, user } from "@roster/db";
import { beforeEach, expect, test } from "vitest";
import { userCanCreateClasses } from "../src/lib/auth/super-admin";

/**
 * The class-creation grant is a `class_creators` row and nothing else. These
 * tests pin the fail-closed contract of the lookup itself, including how "no
 * row" arrives: the answer must be false for both `undefined` (Drizzle's
 * current contract) and `null` (any future ORM or driver change), because the
 * other failure mode is everyone becoming a creator.
 */

const db = getDb(env.DB);

beforeEach(async () => {
  await db.delete(classCreators);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "Uma", email: "uma@x.ch" });
});

test("no grant row → false", async () => {
  expect(await userCanCreateClasses(db, { id: "u1" })).toBe(false);
});

test("a grant row → true", async () => {
  await db
    .insert(classCreators)
    .values({ userId: "u1", createdAt: new Date() });
  expect(await userCanCreateClasses(db, { id: "u1" })).toBe(true);
});

test("another user's grant is not mine", async () => {
  await db
    .insert(classCreators)
    .values({ userId: "u1", createdAt: new Date() });
  expect(await userCanCreateClasses(db, { id: "u2" })).toBe(false);
});

test("a null 'no row' answer stays false — fail closed", async () => {
  const nullDb = {
    query: { classCreators: { findFirst: async () => null } },
  } as unknown as ReturnType<typeof getDb>;
  expect(await userCanCreateClasses(nullDb, { id: "u1" })).toBe(false);
});

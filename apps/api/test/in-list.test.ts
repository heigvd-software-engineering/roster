import { env } from "cloudflare:test";
import { classes, getDb, user } from "@roster/db";
import { inArray, type SQL } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { inList } from "../src/lib/in-list";

const db = getDb(env.DB);
const now = new Date(0);

beforeEach(async () => {
  await db.delete(classes);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "U", email: "u@x.ch" });
  for (const n of [1, 2, 3]) {
    await db.insert(classes).values({
      id: `c${n}`,
      orgId: n,
      installationId: 100 + n,
      connectedByUserId: "u1",
      joinToken: `tok-${n}`,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }
});

const idsWhere = async (where: SQL) =>
  (await db.select({ id: classes.id }).from(classes).where(where))
    .map((r) => r.id)
    .sort();

test("matches a text column", async () => {
  expect(await idsWhere(inList(classes.id, ["c1", "c3", "nope"]))).toEqual([
    "c1",
    "c3",
  ]);
});

test("matches an integer column", async () => {
  expect(await idsWhere(inList(classes.orgId, [2, 3, 99]))).toEqual([
    "c2",
    "c3",
  ]);
});

test("an empty list matches nothing", async () => {
  expect(await idsWhere(inList(classes.id, []))).toEqual([]);
});

test("a list longer than D1's 100 bound parameters still runs", async () => {
  const many = Array.from({ length: 500 }, (_, i) => `x${i}`);
  // The limit this helper exists for: one parameter per value is refused.
  await expect(idsWhere(inArray(classes.id, many))).rejects.toThrow();
  expect(await idsWhere(inList(classes.id, [...many, "c2"]))).toEqual(["c2"]);
});

test("works as the condition of a delete", async () => {
  await db.delete(classes).where(inList(classes.id, ["c1", "c2"]));
  expect(await idsWhere(inList(classes.id, ["c1", "c2", "c3"]))).toEqual([
    "c3",
  ]);
});

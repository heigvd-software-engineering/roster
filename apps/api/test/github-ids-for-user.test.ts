import { env } from "cloudflare:test";
import { account, getDb, user } from "@roster/db";
import { beforeEach, expect, test } from "vitest";
import { githubIdsForUser } from "../src/lib/identity";

const db = getDb(env.DB);
const now = new Date();

beforeEach(async () => {
  await db.delete(account);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "U1", email: "u1@x.ch" });
});

const link = (accountId: string) =>
  db.insert(account).values({
    id: `a-${accountId}`,
    userId: "u1",
    issuer: "local:oauth:github",
    providerId: "github",
    accountId,
    createdAt: now,
    updatedAt: now,
  });

test("returns both forms of the id", async () => {
  await link("61272178");
  expect(await githubIdsForUser(db, "u1")).toEqual({
    ghId: 61272178,
    githubId: "61272178",
  });
});

test("returns null when GitHub is not linked", async () => {
  expect(await githubIdsForUser(db, "u1")).toBeNull();
});

test("returns null when accountId is not numeric", async () => {
  // accountId is a TEXT column; a non-numeric value is as good as absent.
  await link("not-a-number");
  expect(await githubIdsForUser(db, "u1")).toBeNull();
});

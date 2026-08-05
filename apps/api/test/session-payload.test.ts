import { env } from "cloudflare:test";
import { account, getDb, user } from "@roster/db";
import { beforeEach, expect, test, vi } from "vitest";
import type { AuthEnv } from "../src/lib/auth/config";

// What every session read does. accepted-invitation-heal.test.ts covers the heal
// itself; what matters here is the wiring: reading a session triggers it, and
// the onboarding flag is right. Without this, deleting the heal call would leave
// the whole suite green.

const state = vi.hoisted(() => ({ healedFor: [] as string[] }));

vi.mock("../src/lib/auth/accepted-invitation-heal", () => ({
  healAcceptedInvitations: async (_env: unknown, userId: string) => {
    state.healedFor.push(userId);
  },
}));

const { buildSessionPayload } = await import("../src/lib/auth/session-payload");

const db = getDb(env.DB);
const now = new Date(0);
const authEnv = { ...env } as AuthEnv;

beforeEach(async () => {
  state.healedFor = [];
  await db.delete(account);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "Prof", email: "p@x.ch" });
});

test("reading a session runs the invited-teacher heal for that user", async () => {
  await buildSessionPayload(authEnv, { id: "u1" }, { id: "s1" });

  expect(state.healedFor).toEqual(["u1"]);
});

test("githubLinked is true once a github account exists", async () => {
  await db.insert(account).values({
    id: "a1",
    userId: "u1",
    providerId: "github",
    accountId: "111",
    createdAt: now,
    updatedAt: now,
  });

  const payload = await buildSessionPayload(
    authEnv,
    { id: "u1" },
    { id: "s1" },
  );

  expect(payload.githubLinked).toBe(true);
});

test("githubLinked is false with only a SWITCH account — the onboarding gate", async () => {
  // Every user has this one: signing in creates it. Onboarding waits for the
  // GitHub link alone.
  await db.insert(account).values({
    id: "a-switch",
    userId: "u1",
    providerId: "switch",
    accountId: "edu-1",
    createdAt: now,
    updatedAt: now,
  });

  const payload = await buildSessionPayload(
    authEnv,
    { id: "u1" },
    { id: "s1" },
  );

  expect(payload.githubLinked).toBe(false);
});

test("another user's github account does not link this one", async () => {
  await db.insert(user).values({ id: "u2", name: "Other", email: "o@x.ch" });
  await db.insert(account).values({
    id: "a2",
    userId: "u2",
    providerId: "github",
    accountId: "222",
    createdAt: now,
    updatedAt: now,
  });

  const payload = await buildSessionPayload(
    authEnv,
    { id: "u1" },
    { id: "s1" },
  );

  expect(payload.githubLinked).toBe(false);
});

test("user and session pass through untouched", async () => {
  // The SPA infers the session shape from this return, so anything dropped here
  // disappears from every client that reads the session.
  const u = { id: "u1", name: "Prof", firstName: "Bob" };
  const s = { id: "s1", token: "t", expiresAt: now };

  const payload = await buildSessionPayload(authEnv, u, s);

  expect(payload.user).toEqual(u);
  expect(payload.session).toEqual(s);
});

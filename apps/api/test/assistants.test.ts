import { env } from "cloudflare:test";
import { getDb, oauthClient, oauthConsent, user } from "@roster/db";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

// GET /api/assistants (plan 1.7a): the join behind the Connected assistants
// menu group. What matters: scoped to the session user, name passed through
// nullable, scopes normalized, 401 without a session.

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
}));

vi.mock("../src/lib/auth/config", () => ({
  createAuth: () => ({
    api: { getSession: async () => state.session },
  }),
}));

const { assistantsRoutes } = await import("../src/routes/assistants");
const { apiOnError } = await import("../src/on-error");

const app = new Hono<import("../src/env").Env>()
  .route("/api", assistantsRoutes)
  .onError(apiOnError);
const db = getDb(env.DB);
const now = new Date("2026-08-28T10:00:00Z");
const later = new Date("2026-08-30T10:00:00Z");

const call = () => app.request("/api/assistants", {}, env);

beforeEach(async () => {
  state.session = { user: { id: "u1" } };
  await db.delete(oauthConsent);
  await db.delete(oauthClient);
  await db.delete(user);
  await db.insert(user).values([
    { id: "u1", name: "Prof One", email: "one@heig-vd.ch" },
    { id: "u2", name: "Prof Two", email: "two@heig-vd.ch" },
  ]);
  await db.insert(oauthClient).values([
    {
      id: "row-named",
      clientId: "client-named",
      name: "Claude Code",
      redirectUris: ["http://127.0.0.1:33418/callback"],
    },
    {
      id: "row-nameless",
      clientId: "client-nameless",
      name: null,
      redirectUris: ["http://127.0.0.1:1234/cb"],
    },
  ]);
  await db.insert(oauthConsent).values([
    {
      id: "consent-1",
      clientId: "client-named",
      userId: "u1",
      scopes: ["roster:read"],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "consent-2",
      clientId: "client-nameless",
      userId: "u1",
      scopes: ["roster:read", "roster:write"],
      createdAt: later,
      updatedAt: later,
    },
    // Another teacher's grant on the same client: must stay invisible.
    {
      id: "consent-other",
      clientId: "client-named",
      userId: "u2",
      scopes: ["roster:read"],
      createdAt: now,
      updatedAt: now,
    },
  ]);
});

test("lists the caller's grants with the client's name joined in, oldest first", async () => {
  const res = await call();
  expect(res.status).toBe(200);
  const { assistants } = (await res.json()) as {
    assistants: {
      id: string;
      name: string | null;
      scopes: string[];
      createdAt: string;
    }[];
  };
  expect(assistants).toEqual([
    {
      id: "consent-1",
      name: "Claude Code",
      scopes: ["roster:read"],
      createdAt: now.toISOString(),
    },
    {
      id: "consent-2",
      name: null, // the SPA renders "An assistant"
      scopes: ["roster:read", "roster:write"],
      createdAt: later.toISOString(),
    },
  ]);
});

test("another teacher's consents are invisible", async () => {
  state.session = { user: { id: "u2" } };
  const res = await call();
  const { assistants } = (await res.json()) as { assistants: { id: string }[] };
  expect(assistants.map((a) => a.id)).toEqual(["consent-other"]);
});

test("401 without a session", async () => {
  state.session = null;
  expect((await call()).status).toBe(401);
});

test("no grants is an empty list, not an error", async () => {
  await db.delete(oauthConsent);
  const res = await call();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ assistants: [] });
});

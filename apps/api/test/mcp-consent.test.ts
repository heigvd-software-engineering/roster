import { env } from "cloudflare:test";
import { getDb, oauthClient, oauthConsent, user } from "@roster/db";
import { beforeEach, expect, test, vi } from "vitest";
import type { AppBindings } from "../src/env";
import type { AuthEnv } from "../src/lib/auth/config";

// Board row R10 (decision #12): withdrawing consent stops the NEXT tool call —
// the token may verify for its whole seven days, the consent row is the
// standing grant. Token verification (lib/mcp/verify) is mocked to hand the
// lane the claims a verified JWT would carry — its own checks are covered at
// the wire and live by 9.10; the consent re-read and actor resolution under
// test are real, against real D1.

const state = vi.hoisted(() => ({
  claims: {} as Record<string, unknown>,
}));

vi.mock("../src/lib/mcp/verify", async (importOriginal) => ({
  // READ_SCOPE and the challenge stay real; only token verification is
  // replaced, handing the lane the claims a verified JWT would carry.
  ...(await importOriginal<typeof import("../src/lib/mcp/verify")>()),
  verifyMcpBearer: async () => ({ claims: state.claims }),
}));

const { default: app } = await import("../src/index");

const authEnv = {
  ...env,
  BETTER_AUTH_URL: "http://localhost:8787",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
  EDUID_ISSUER: "https://login.eduid.example",
  EDUID_CLIENT_ID: "eduid",
  EDUID_CLIENT_SECRET: "eduid-secret",
  GITHUB_CLIENT_ID: "Iv23test",
  GITHUB_CLIENT_SECRET: "gh-secret",
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: "unused",
  GITHUB_APP_SLUG: "roster",
} as AuthEnv as AppBindings;

const db = getDb(env.DB);

const call = () =>
  app.request(
    "http://localhost/mcp",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        host: "localhost",
        authorization: "Bearer verified-by-the-mock",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "probe", version: "0.0.0" },
        },
      }),
    },
    authEnv,
  );

beforeEach(async () => {
  state.claims = {
    sub: "u-teacher",
    client_id: "client-abc",
    scope: "roster:read",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  await db.delete(oauthConsent);
  await db.delete(oauthClient);
  await db.delete(user);
  await db.insert(user).values({
    id: "u-teacher",
    name: "Prof Switch",
    email: "prof@heig-vd.ch",
  });
  await db.insert(oauthClient).values({
    id: "row-1",
    clientId: "client-abc",
    redirectUris: ["http://127.0.0.1:33418/callback"],
  });
  await db.insert(oauthConsent).values({
    id: "consent-1",
    clientId: "client-abc",
    userId: "u-teacher",
    scopes: ["roster:read"],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

test("with the consent row standing, the call reaches the MCP server", async () => {
  const res = await call();
  expect(res.status).toBe(200);
});

test("deleting the consent row answers the very next call with 401", async () => {
  expect((await call()).status).toBe(200);
  await db.delete(oauthConsent);
  const res = await call();
  expect(res.status).toBe(401);
  expect(res.headers.get("WWW-Authenticate")).toContain("invalid_token");
});

test("a consent that no longer carries roster:read is as gone as no consent", async () => {
  await db.update(oauthConsent).set({ scopes: ["something:else"] });
  expect((await call()).status).toBe(401);
});

test("a consent for a different client does not cover this one", async () => {
  state.claims = { ...state.claims, client_id: "client-OTHER" };
  expect((await call()).status).toBe(401);
});

test("a deleted account stops its assistant with it", async () => {
  await db.delete(oauthConsent);
  await db.delete(user); // cascades in prod; explicit here
  await db.insert(oauthConsent).values({
    id: "consent-2",
    clientId: "client-abc",
    userId: null,
    scopes: ["roster:read"],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  expect((await call()).status).toBe(401);
});

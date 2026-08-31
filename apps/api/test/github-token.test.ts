import { env } from "cloudflare:test";
import { account, getDb, user } from "@roster/db";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AuthEnv } from "../src/lib/auth/config";
import { githubAccessToken } from "../src/lib/auth/github-token";

// Real better-auth and real D1: these tests exercise the actual
// `auth.api.getAccessToken` refresh path with only GitHub's token endpoint
// faked through a global fetch stub, since the pool has no fetchMock.
// Everything but the DB is a dummy value; the refresh flow reads
// GITHUB_CLIENT_ID/SECRET and nothing else.
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
} as AuthEnv;

const db = getDb(env.DB);

/** When set, the fetch stub answers GitHub's token endpoint with this. */
let refreshReply: { status: number; body: Record<string, unknown> } | null =
  null;

beforeEach(async () => {
  refreshReply = null;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (
        url === "https://github.com/login/oauth/access_token" &&
        refreshReply
      ) {
        return new Response(JSON.stringify(refreshReply.body), {
          status: refreshReply.status,
          headers: { "content-type": "application/json" },
        });
      }
      // Any other outbound call is a bug in the code under test.
      throw new Error(`unexpected outbound fetch: ${url}`);
    },
  );
  await db.delete(account);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "U1", email: "u1@x.ch" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function seedGithubAccount(overrides: Partial<typeof account.$inferInsert>) {
  return db.insert(account).values({
    id: "a1",
    userId: "u1",
    issuer: "local:oauth:github",
    providerId: "github",
    accountId: "111",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  });
}

test("returns null when no github account is linked", async () => {
  expect(await githubAccessToken(authEnv, "u1")).toBeNull();
});

test("returns the stored token while it is still valid", async () => {
  await seedGithubAccount({
    accessToken: "live-token",
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    refreshToken: "rt-1",
  });
  expect(await githubAccessToken(authEnv, "u1")).toBe("live-token");
});

test("refreshes an expired token and persists the new tokens", async () => {
  await seedGithubAccount({
    accessToken: "stale-token",
    accessTokenExpiresAt: new Date(Date.now() - 1000),
    refreshToken: "rt-1",
  });
  // GitHub App user tokens: 8h access token, ~6 month refresh token.
  refreshReply = {
    status: 200,
    body: {
      access_token: "fresh-token",
      expires_in: 28800,
      refresh_token: "rt-2",
      refresh_token_expires_in: 15897600,
      token_type: "bearer",
    },
  };

  expect(await githubAccessToken(authEnv, "u1")).toBe("fresh-token");

  // The refreshed tokens must be persisted so the next caller reuses them
  // instead of refreshing again.
  const [row] = await db.select().from(account);
  expect(row).toMatchObject({
    accessToken: "fresh-token",
    refreshToken: "rt-2",
  });
  expect(row?.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now());
});

test("returns null when GitHub rejects the refresh", async () => {
  await seedGithubAccount({
    accessToken: "stale-token",
    accessTokenExpiresAt: new Date(Date.now() - 1000),
    refreshToken: "rt-revoked",
  });
  refreshReply = { status: 401, body: { error: "bad_refresh_token" } };

  expect(await githubAccessToken(authEnv, "u1")).toBeNull();
});

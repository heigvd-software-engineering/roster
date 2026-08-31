import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import type { AppBindings } from "../src/env";
import app from "../src/index";
import type { AuthEnv } from "../src/lib/auth/config";

// The /mcp mount, at the wire (board test 9.3 plus the host guard). Real app,
// real better-auth: no token is minted here — what this file proves is the
// negative space. The full flow with a real token is board 9.10, on demo.

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

const initialize = {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    host: "localhost",
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
};

test("unauthenticated /mcp answers 401 with the RFC 9728 challenge", async () => {
  const res = await app.request("http://localhost/mcp", initialize, authEnv);
  expect(res.status).toBe(401);
  const challenge = res.headers.get("WWW-Authenticate") ?? "";
  expect(challenge).toMatch(/^Bearer /);
  expect(challenge).toContain("resource_metadata=");
});

test("a garbage bearer token is refused the same way", async () => {
  const res = await app.request(
    "http://localhost/mcp",
    {
      ...initialize,
      headers: { ...initialize.headers, authorization: "Bearer not-a-jwt" },
    },
    authEnv,
  );
  expect(res.status).toBe(401);
  expect(res.headers.get("WWW-Authenticate")).toMatch(/^Bearer /);
});

test("a mismatched Host never reaches the auth layer — 403, DNS rebinding", async () => {
  const res = await app.request(
    "http://localhost/mcp",
    {
      ...initialize,
      headers: { ...initialize.headers, host: "evil.example" },
    },
    authEnv,
  );
  expect(res.status).toBe(403);
  // The refusal is the adapter's JSON-RPC shape, not a challenge: a rebound
  // request must not be invited to authorize.
  expect(res.headers.get("WWW-Authenticate")).toBeNull();
});

test("/api/* still behaves as before the lane existed", async () => {
  const res = await app.request("http://localhost/api/health", {}, authEnv);
  expect(res.status).toBe(200);
});

// Board test 9.2 (R3): an MCP bearer token presented to /api/* is not a
// session. The web lane and the MCP lane never blur: /api/* answers to the
// session cookie alone, whatever rides in the Authorization header.
test("a bearer token against /api/* is answered 401", async () => {
  const res = await app.request(
    "http://localhost/api/classes",
    {
      headers: {
        host: "localhost",
        authorization:
          "Bearer eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1LXRlYWNoZXIifQ.signature",
      },
    },
    authEnv,
  );
  expect(res.status).toBe(401);
});

// Found by 9.10's first real client (Claude Code): RFC 8414 puts a
// path-bearing issuer's metadata at the path-INSERTED well-known, the only
// OAuth URL the MCP SDK tries. Without it, discovery fails and the SDK's
// fallback registration POST lands in the assets layer as a 405.
test("the RFC 8414 path-insertion metadata answers, and names the endpoints", async () => {
  const res = await app.request(
    "http://localhost/.well-known/oauth-authorization-server/api/auth",
    { headers: { host: "localhost" } },
    authEnv,
  );
  expect(res.status).toBe(200);
  const metadata = (await res.json()) as {
    issuer: string;
    registration_endpoint: string;
    token_endpoint: string;
  };
  expect(metadata.issuer).toBe("http://localhost:8787/api/auth");
  expect(metadata.registration_endpoint).toContain("/api/auth/oauth2/register");
  expect(metadata.token_endpoint).toContain("/api/auth/oauth2/token");
});

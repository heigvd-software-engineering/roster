import { env } from "cloudflare:test";
import type { User } from "@roster/db";
import { Hono } from "hono";
import { expect, test } from "vitest";
import type { AppBindings } from "../src/env";
import type { AuthEnv } from "../src/lib/auth/config";
import { requireAuth } from "../src/lib/auth/require-auth";

// Board test 9.1 (R4), written before the mechanism it proves. The MCP lane
// authenticates a request by placing the resolved teacher into the env of an
// internal `app.request` call — `MCP_ACTOR` — and `requireAuth` honours that
// actor. The property the whole design rests on: NOTHING a caller puts in a
// request can reach that slot. Real better-auth, real D1, no mocks — a mocked
// getSession could hide exactly the hole this test exists to rule out.

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

// Mounted exactly as src/index.ts guards the API: requireAuth ahead of the
// route, the route echoing who it believes is calling.
const app = new Hono<{ Bindings: AppBindings; Variables: { user: User } }>()
  .use("/api/*", requireAuth)
  .all("/api/whoami", (c) => c.json({ id: c.get("user").id }));

const actor = { id: "u-injected" } as User;
const actorJson = JSON.stringify(actor);

test("an actor in a header does not authenticate", async () => {
  const res = await app.request(
    "/api/whoami",
    { headers: { MCP_ACTOR: actorJson, "x-mcp-actor": actorJson } },
    authEnv,
  );
  expect(res.status).toBe(401);
});

test("an actor in the query string does not authenticate", async () => {
  const res = await app.request(
    `/api/whoami?MCP_ACTOR=${encodeURIComponent(actorJson)}`,
    {},
    authEnv,
  );
  expect(res.status).toBe(401);
});

test("an actor in the body does not authenticate", async () => {
  const res = await app.request(
    "/api/whoami",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ MCP_ACTOR: actor, user: actor }),
    },
    authEnv,
  );
  expect(res.status).toBe(401);
});

test("an actor in a cookie does not authenticate", async () => {
  const res = await app.request(
    "/api/whoami",
    { headers: { cookie: `MCP_ACTOR=${encodeURIComponent(actorJson)}` } },
    authEnv,
  );
  expect(res.status).toBe(401);
});

test("all four channels at once still do not authenticate", async () => {
  const res = await app.request(
    `/api/whoami?MCP_ACTOR=${encodeURIComponent(actorJson)}`,
    {
      method: "POST",
      headers: {
        MCP_ACTOR: actorJson,
        cookie: `MCP_ACTOR=${encodeURIComponent(actorJson)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ MCP_ACTOR: actor }),
    },
    authEnv,
  );
  expect(res.status).toBe(401);
});

// The one door that exists: the env of an internal call, which no external
// request can reach — a Worker's env comes from the runtime, and ours is only
// ever spread by the MCP lane itself.
test("an actor injected through the env authenticates as that user", async () => {
  const res = await app.request(
    "/api/whoami",
    {},
    { ...authEnv, MCP_ACTOR: actor },
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: "u-injected" });
});

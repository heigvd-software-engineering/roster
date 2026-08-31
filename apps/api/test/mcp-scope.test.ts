import { env } from "cloudflare:test";
import { account, classes, getDb, type User, user } from "@roster/db";
import { beforeEach, expect, test, vi } from "vitest";
import type { AppBindings } from "../src/env";
import type { AuthEnv } from "../src/lib/auth/config";

// Board test 9.6 (R6): a teacher's actor against ANOTHER teacher's class is
// refused — and the refusal is byte-identical to "no such class", because
// class-scoped denials are 404 by design and an assistant must not be able to
// probe which class ids exist. GitHub is mocked to answer "not a member";
// everything else is real.

vi.mock("../src/lib/auth/github-token", () => ({
  githubAccessToken: async () => "tok",
}));
vi.mock("../src/lib/github/user", () => ({
  fetchGithubProfile: async () => ({
    login: "stranger",
    id: 999,
    name: "S. Tranger",
    avatarUrl: "http://s",
  }),
}));
vi.mock("../src/lib/github/app", () => ({
  orgLogin: async () => "acme",
}));
vi.mock("../src/lib/github/org", () => ({
  orgMembership: async () => null, // not a member of THIS class's org
}));

const { default: app } = await import("../src/index");
const { runTool } = await import("../src/lib/mcp/lane");
const { mcpTools } = await import("../src/mcp/tools");

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
const now = new Date();
const stranger = { id: "u-stranger" } as User;
const asStranger = { ...authEnv, MCP_ACTOR: stranger };

const groupsTool = mcpTools.find((t) => t.name === "list_assignment_groups");
if (!groupsTool) throw new Error("tool table lost list_assignment_groups");

beforeEach(async () => {
  await db.delete(account);
  await db.delete(classes);
  await db.delete(user);
  await db.insert(user).values([
    { id: "u-owner", name: "Prof Owner", email: "owner@heig-vd.ch" },
    { id: "u-stranger", name: "Prof Stranger", email: "stranger@heig-vd.ch" },
  ]);
  await db.insert(account).values({
    id: "a-stranger",
    userId: "u-stranger",
    issuer: "local:oauth:github",
    providerId: "github",
    accountId: "999",
    accessToken: "tok",
    createdAt: now,
    updatedAt: now,
  });
  // The class the stranger's assistant will probe: real, and someone else's.
  await db.insert(classes).values({
    id: "c-owned",
    orgId: 42,
    installationId: 100,
    connectedByUserId: "u-owner",
    joinToken: "tok-c1",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
});

test("another teacher's class refuses exactly like a class that does not exist", async () => {
  const real = await runTool(app, asStranger, undefined, groupsTool, {
    classId: "c-owned",
    assignmentId: "a1",
  });
  const ghost = await runTool(app, asStranger, undefined, groupsTool, {
    classId: "no-such-class",
    assignmentId: "a1",
  });
  expect(real.isError).toBe(true);
  expect(real.content[0]?.text).toContain("HTTP 404");
  // Indistinguishable: the refusal leaks nothing about the id being real.
  expect(real.content[0]?.text).toBe(ghost.content[0]?.text);
});

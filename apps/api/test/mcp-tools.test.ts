import { env } from "cloudflare:test";
import { getDb, type User, user } from "@roster/db";
import { beforeEach, expect, test } from "vitest";
import type { AppBindings } from "../src/env";
import app from "../src/index";
import type { AuthEnv } from "../src/lib/auth/config";
import { runTool } from "../src/lib/mcp/lane";
import { mcpTools } from "../src/mcp/tools";

// Board test 9.5 (R5): a tool is a projection — its result equals a direct
// endpoint call as the same actor, failure case included. And 1.6: the failure
// is an MCP tool error carrying the endpoint's own error code, never plain
// content a model would narrate as an answer.

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

const actor = { id: "u-teacher" } as User;
const asActor = { ...authEnv, MCP_ACTOR: actor };
const db = getDb(env.DB);

const toolByName = (name: string) => {
  const tool = mcpTools.find((t) => t.name === name);
  if (!tool) throw new Error(`no such tool: ${name}`);
  return tool;
};

beforeEach(async () => {
  await db.delete(user);
  await db.insert(user).values({
    id: "u-teacher",
    name: "Prof Switch",
    email: "prof@heig-vd.ch",
  });
});

test("list_classes equals a direct GET /api/classes as the same actor", async () => {
  const direct = await app.request("/api/classes", {}, asActor);
  expect(direct.status).toBe(200);
  const result = await runTool(
    app,
    asActor,
    undefined,
    toolByName("list_classes"),
    {},
  );
  expect(result.isError).toBeUndefined();
  expect(result.content[0]?.text).toBe(await direct.text());
});

test("a refused endpoint becomes a tool ERROR carrying the endpoint's code", async () => {
  const input = { classId: "no-such-class", assignmentId: "nope" };
  const tool = toolByName("list_assignment_groups");
  const direct = await app.request(tool.path(input), {}, asActor);
  expect(direct.status).toBe(404); // class-scoped denial, by design
  const result = await runTool(app, asActor, undefined, tool, input);
  expect(result.isError).toBe(true);
  const text = result.content[0]?.text ?? "";
  expect(text).toContain("HTTP 404");
  expect(text).toContain(await direct.text()); // the endpoint's own error code
});

test("the two tools project exactly the endpoints the plan names", () => {
  expect(mcpTools.map((t) => t.name).sort()).toEqual([
    "list_assignment_groups",
    "list_classes",
  ]);
  expect(toolByName("list_classes").path({})).toBe("/api/classes");
  expect(
    toolByName("list_assignment_groups").path({
      classId: "c1",
      assignmentId: "a2",
    }),
  ).toBe("/api/classes/c1/assignments/a2/groups");
  for (const tool of mcpTools) {
    expect(tool.scope).toBe("roster:read"); // phase 1 reads, nothing else
    expect(tool.method).toBe("GET");
  }
});

import { env } from "cloudflare:test";
import { account, classCreators, getDb, user } from "@roster/db";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

/**
 * /api/me's `githubState` contract (unavailability fix, 2026-07-09):
 * "linked" = the profile was READ with a working token; "unlinked" = no
 * token, or GitHub answered 401 (proven-dead — the only re-link signal);
 * "unknown" = GitHub couldn't answer. /api/me is the SPA's boot fetch, so
 * an outage must still be a 200 — with "unknown", never "unlinked".
 */

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  githubToken: "tok" as string | null,
  profile: { login: "alice", id: 7, name: "Alice", avatarUrl: "http://p" } as {
    login: string;
    id: number;
    name: string | null;
    avatarUrl: string;
  } | null,
  githubDown: false,
}));

vi.mock("../src/lib/auth/config", () => ({
  createAuth: () => ({
    api: { getSession: async () => state.session },
  }),
}));

vi.mock("../src/lib/auth/github-token", () => ({
  githubAccessToken: async () => state.githubToken,
}));

vi.mock("../src/lib/github/user", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/github/user")>();
  return {
    ...actual,
    fetchGithubProfile: async () => {
      if (state.githubDown) {
        throw new actual.GithubUnavailableError("simulated outage");
      }
      return state.profile;
    },
  };
});

const { meRoutes } = await import("../src/routes/me");
const { apiOnError } = await import("../src/on-error");

const app = new Hono<import("../src/lib/auth/config").Env>()
  .route("/api", meRoutes)
  .onError(apiOnError);
const db = getDb(env.DB);

beforeEach(async () => {
  state.session = { user: { id: "u1" } };
  state.githubToken = "tok";
  state.profile = {
    login: "alice",
    id: 7,
    name: "Alice",
    avatarUrl: "http://p",
  };
  state.githubDown = false;

  await db.delete(account);
  await db.delete(classCreators);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "U1", email: "u1@x.ch" });
});

async function me(envOverride: Record<string, unknown> = {}) {
  const res = await app.request("/api/me", {}, { ...env, ...envOverride });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    user: { id: string } | null;
    github: { login: string } | null;
    githubState: string;
    isSuperAdmin: boolean;
    canCreateClasses: boolean;
  };
}

test("a readable profile is 'linked'", async () => {
  const body = await me();
  expect(body.githubState).toBe("linked");
  expect(body.github?.login).toBe("alice");
});

test("a proven-dead token (401 → null profile) is 'unlinked'", async () => {
  state.profile = null;
  const body = await me();
  expect(body.githubState).toBe("unlinked");
  expect(body.github).toBeNull();
});

test("no usable token is 'unlinked'", async () => {
  state.githubToken = null;
  const body = await me();
  expect(body.githubState).toBe("unlinked");
});

test("a GitHub outage is a 200 with 'unknown' — never 'unlinked'", async () => {
  // "unknown" is what keeps the gate from bouncing a healthy link through
  // onboarding during an outage (the SPA fails open on it).
  state.githubDown = true;
  const body = await me();
  expect(body.githubState).toBe("unknown");
  expect(body.github).toBeNull();
  expect(body.user?.id).toBe("u1");
});

test("signed out stays 'unlinked' with no user", async () => {
  state.session = null;
  const body = await me();
  expect(body.user).toBeNull();
  expect(body.githubState).toBe("unlinked");
  expect(body.isSuperAdmin).toBe(false);
  expect(body.canCreateClasses).toBe(false);
});

test("capabilities default to false — no config match, no grant row", async () => {
  const body = await me();
  expect(body.isSuperAdmin).toBe(false);
  expect(body.canCreateClasses).toBe(false);
});

test("a class_creators row grants canCreateClasses, not admin", async () => {
  await db
    .insert(classCreators)
    .values({ userId: "u1", createdAt: new Date(0) });
  const body = await me();
  expect(body.isSuperAdmin).toBe(false);
  expect(body.canCreateClasses).toBe(true);
});

test("a config-listed email is admin but does NOT create without the row", async () => {
  // Case-insensitive, whitespace-tolerant match — and ONE condition for
  // creation: even an admin needs the explicit grant.
  const body = await me({ SUPER_ADMIN_EMAILS: " Other@y.ch , U1@X.CH " });
  expect(body.isSuperAdmin).toBe(true);
  expect(body.canCreateClasses).toBe(false);
});

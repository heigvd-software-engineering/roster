import { env } from "cloudflare:test";
import { assignments, classes, getDb, groups, user } from "@roster/db";
import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import type { AuthEnv } from "../src/lib/auth/config";

const state = vi.hoisted(() => ({
  /** Team slugs that still exist on GitHub. Anything else 404s (null). */
  liveTeams: new Set<string>(),
  /** Repo full names that exist in the org. */
  orgRepos: new Set<string>(),
  getOrgRepoThrows: false,
}));

vi.mock("../src/lib/github/org", () => ({
  orgInfo: vi.fn(async () => ({
    login: "acme",
    name: "Acme",
    avatarUrl: "http://a",
  })),
  orgPeople: vi.fn(async () => ({ teachers: [], students: [], pending: [] })),
  orgPolicy: vi.fn(async () => ({
    basePermission: "none",
    membersCanCreateRepos: false,
  })),
}));

vi.mock("../src/lib/github/team", () => ({
  teamMembers: vi.fn(async (_e, _i, _o, slug: string) =>
    state.liveTeams.has(slug) ? [] : null,
  ),
  createTeam: vi.fn(),
  addTeamMember: vi.fn(),
}));

vi.mock("../src/lib/github/repo", () => ({
  orgRepoActivity: vi.fn(
    async () =>
      new Map(
        [...state.orgRepos].map((n) => [
          n,
          { pushedAt: null, createdAt: null },
        ]),
      ),
  ),
  getOrgRepo: vi.fn(async (_e, _i, org: string, name: string) => {
    if (state.getOrgRepoThrows) throw new Error("Not Found");
    return { id: 777, fullName: `${org}/${name}` };
  }),
  grantTeamRepo: vi.fn(async () => {}),
  createOrgRepo: vi.fn(),
  generateFromTemplate: vi.fn(),
}));

const { buildContext } = await import("../src/lib/reconcile/context");
const { groupTeams } = await import("../src/lib/reconcile/group-teams");
const { workRepos } = await import("../src/lib/reconcile/work-repos");
const { getOrgRepo, grantTeamRepo } = await import("../src/lib/github/repo");

const db = getDb(env.DB);
const now = new Date(0);

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

async function ctx() {
  const [cls] = await db.select().from(classes).where(eq(classes.id, "cls"));
  if (!cls) throw new Error("no class");
  return buildContext(authEnv, db, cls, {
    installationId: 200,
    login: "acme",
  });
}

async function seedAssignment(
  id: string,
  title: string,
  template: string | null,
) {
  await db.insert(assignments).values({
    id,
    classId: "cls",
    title,
    templateRepoFullName: template,
    deadline: now,
    createdByUserId: "u1",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedGroup(
  id: string,
  assignmentId: string,
  slug: string,
  repo: string | null,
) {
  await db.insert(groups).values({
    id,
    assignmentId,
    ghTeamId: Math.abs(
      id.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7),
    ),
    ghTeamSlug: slug,
    slug,
    name: id,
    ghRepoId: repo ? Math.floor(Math.random() * 1e6) + 1 : null,
    ghRepoFullName: repo,
    creatorUserId: "u1",
    createdAt: now,
    updatedAt: now,
  });
}

const groupIds = async () =>
  (await db.select().from(groups)).map((g) => g.id).sort();

beforeEach(async () => {
  state.liveTeams = new Set();
  state.orgRepos = new Set();
  state.getOrgRepoThrows = false;
  vi.mocked(getOrgRepo).mockClear();
  vi.mocked(grantTeamRepo).mockClear();

  await db.delete(groups);
  await db.delete(assignments);
  await db.delete(classes);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "Prof", email: "prof@x.ch" });
  await db.insert(classes).values({
    id: "cls",
    orgId: 42,
    installationId: 100,
    connectedByUserId: "u1",
    joinToken: "tok",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await seedAssignment("assignment", "Assignment One", null);
});

test("group-teams audit: a live team produces no finding", async () => {
  state.liveTeams.add("assignment-one-alpha");
  await seedGroup("alpha", "assignment", "assignment-one-alpha", null);

  expect(await groupTeams.audit(await ctx())).toEqual([]);
});

test("group-teams audit: a deleted team proposes a group delete", async () => {
  await seedGroup(
    "alpha",
    "assignment",
    "assignment-one-alpha",
    "acme/assignment-one-alpha",
  );

  const [f, ...rest] = await groupTeams.audit(await ctx());
  expect(rest).toEqual([]);
  expect(f).toMatchObject({
    key: "group-teams:delete:groupId=alpha",
    reconciler: "group-teams",
    severity: "broken",
  });
  // The teacher must be told the repo survives; that is what makes the delete
  // safe.
  expect(f?.detail).toContain("acme/assignment-one-alpha");
});

test("group-teams apply deletes ONLY the named group", async () => {
  state.liveTeams.add("assignment-one-beta");
  await seedGroup("alpha", "assignment", "assignment-one-alpha", null);
  await seedGroup("beta", "assignment", "assignment-one-beta", null);
  await seedGroup("gamma", "assignment", "assignment-one-gamma", null);

  // alpha and gamma both have dead teams; the teacher checked only alpha.
  const results = await groupTeams.apply(await ctx(), [
    "group-teams:delete:groupId=alpha",
  ]);

  expect(results).toEqual([
    { key: "group-teams:delete:groupId=alpha", ok: true },
  ]);
  expect(await groupIds()).toEqual(["beta", "gamma"]);
});

test("group-teams apply: a row already gone is a success (replay)", async () => {
  await seedGroup("alpha", "assignment", "assignment-one-alpha", null);
  const key = "group-teams:delete:groupId=alpha";

  expect(await groupTeams.apply(await ctx(), [key])).toEqual([
    { key, ok: true },
  ]);
  expect(await groupTeams.apply(await ctx(), [key])).toEqual([
    { key, ok: true },
  ]);
  expect(await groupIds()).toEqual([]);
});

test("work-repos audit: an unrecorded repo is proposed for adoption", async () => {
  state.orgRepos.add("acme/assignment-one-alpha");
  await seedGroup("alpha", "assignment", "assignment-one-alpha", null);

  const [f] = await workRepos.audit(await ctx());
  expect(f).toMatchObject({
    key: "work-repos:adopt:groupId=alpha",
  });
});

test("work-repos audit: a group that already has its repo is left alone", async () => {
  state.orgRepos.add("acme/assignment-one-alpha");
  await seedGroup(
    "alpha",
    "assignment",
    "assignment-one-alpha",
    "acme/assignment-one-alpha",
  );

  expect(await workRepos.audit(await ctx())).toEqual([]);
});

test("work-repos audit: an assignment's own TEMPLATE is never adopted", async () => {
  // Adoption ends in grantTeamRepo, so adopting the template would hand
  // students push on the starter code.
  await seedAssignment(
    "assignment-t",
    "Assignment Two",
    "acme/assignment-two-starter",
  );
  state.orgRepos.add("acme/assignment-two-starter");
  await seedGroup("starter", "assignment-t", "assignment-two-starter", null);

  expect(await workRepos.audit(await ctx())).toEqual([]);
});

test("work-repos apply links the repo and re-grants the team", async () => {
  state.orgRepos.add("acme/assignment-one-alpha");
  await seedGroup("alpha", "assignment", "assignment-one-alpha", null);

  const results = await workRepos.apply(await ctx(), [
    "work-repos:adopt:groupId=alpha",
  ]);

  expect(results).toEqual([
    { key: "work-repos:adopt:groupId=alpha", ok: true },
  ]);
  expect(grantTeamRepo).toHaveBeenCalledWith(
    expect.anything(),
    200,
    "acme",
    "assignment-one-alpha",
    "acme/assignment-one-alpha",
  );
  const [row] = await db.select().from(groups);
  expect(row).toMatchObject({
    ghRepoId: 777,
    ghRepoFullName: "acme/assignment-one-alpha",
  });
});

test("work-repos apply: a group linked between audit and apply is a no-op success", async () => {
  await seedGroup(
    "alpha",
    "assignment",
    "assignment-one-alpha",
    "acme/assignment-one-alpha",
  );

  const results = await workRepos.apply(await ctx(), [
    "work-repos:adopt:groupId=alpha",
  ]);

  expect(results).toEqual([
    { key: "work-repos:adopt:groupId=alpha", ok: true },
  ]);
  expect(getOrgRepo).not.toHaveBeenCalled();
});

test("work-repos apply: a repo deleted since the audit fails as one op, writing nothing", async () => {
  await seedGroup("alpha", "assignment", "assignment-one-alpha", null);
  state.getOrgRepoThrows = true;

  const [result] = await workRepos.apply(await ctx(), [
    "work-repos:adopt:groupId=alpha",
  ]);

  expect(result).toMatchObject({ ok: false, error: "Not Found" });
  expect(grantTeamRepo).not.toHaveBeenCalled();
  const [row] = await db.select().from(groups);
  expect(row?.ghRepoFullName).toBeNull();
});

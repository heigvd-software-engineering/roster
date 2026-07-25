import { env } from "cloudflare:test";
import {
  account,
  classes,
  classMembers,
  getDb,
  groupMembers,
  groups,
  labs,
  user,
} from "@roster/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  membership: { state: "active", role: "member" } as {
    state: "active" | "pending";
    role: string;
  } | null,
  // slug → roster; a missing slug = the team is gone on GitHub.
  rosters: {} as Record<
    string,
    Array<{ id: number; login: string; avatarUrl: string | null }>
  >,
  // repo fullName → org-listing activity.
  activity: {} as Record<
    string,
    { pushedAt: string | null; createdAt: string | null }
  >,
  // Make the org-repos LISTING itself fail (rate limit, outage) — distinct
  // from a repo simply being absent from it.
  activityFails: false,
  // Repo names ALREADY in the org — creating them 422s. `visible` says whether
  // the App installation can then read the repo back (adoption) or not.
  orgRepos: {} as Record<string, { visible: boolean }>,
  // The lab's template repo was DELETED/RENAMED since — /generate 404s.
  templateGone: false,
  // Every team-push grant made, in order — and a switch to make the NEXT
  // grant blow up (simulates a create dying between the row write and the
  // grant).
  grants: [] as Array<{ team: string; repo: string }>,
  grantFails: false,
  // Call counters: the cached-identity hot path must NOT spend these.
  profileCalls: 0,
  orgLoginCalls: 0,
}));

vi.mock("../src/lib/auth/config", () => ({
  createAuth: () => ({ api: { getSession: async () => state.session } }),
}));
vi.mock("../src/lib/auth/github-token", () => ({
  githubAccessToken: async () => "tok",
}));
vi.mock("../src/lib/github/user", () => ({
  fetchGithubProfile: async () => {
    state.profileCalls++;
    return { login: "alice", id: 7, name: "Alice", avatarUrl: "http://a" };
  },
}));
vi.mock("../src/lib/github/app", () => ({
  orgLogin: async () => {
    state.orgLoginCalls++;
    return "acme";
  },
}));
vi.mock("../src/lib/github/org", () => ({
  orgMembership: async () => state.membership,
}));

const repoSeq = vi.hoisted(() => ({ next: 9000 }));
vi.mock("../src/lib/github/repo", async (importOriginal) => {
  // The REAL module also exports `classifyRepoFailure` — pure, no GitHub
  // call — and these tests exercise it for real: only the API-calling
  // operations below are faked.
  const actual =
    await importOriginal<typeof import("../src/lib/github/repo")>();
  /** The REAL 422 GitHub sends when an org repo name is taken: the reason is
   *  in `errors[]`, NOT in the top-level `message`. */
  const nameTaken = () =>
    Object.assign(
      new Error(
        'Repository creation failed.: {"field":"name","message":"name already exists on this account"}',
      ),
      {
        status: 422,
        response: {
          data: {
            message: "Repository creation failed.",
            errors: [
              { field: "name", message: "name already exists on this account" },
            ],
          },
        },
      },
    );
  const create = async (org: string, name: string) => {
    if (state.orgRepos[name]) throw nameTaken();
    return { id: repoSeq.next++, fullName: `${org}/${name}` };
  };
  return {
    ...actual,
    createOrgRepo: async (
      _env: unknown,
      _inst: number,
      org: string,
      name: string,
    ) => create(org, name),
    generateFromTemplate: async (
      _env: unknown,
      _inst: number,
      _template: string,
      org: string,
      name: string,
    ) => {
      if (state.templateGone) {
        throw Object.assign(new Error("Not Found"), { status: 404 });
      }
      return create(org, name);
    },
    getOrgRepo: async (
      _env: unknown,
      _inst: number,
      org: string,
      name: string,
    ) => {
      const existing = state.orgRepos[name];
      if (!existing?.visible) {
        throw Object.assign(new Error("Not Found"), { status: 404 });
      }
      return { id: repoSeq.next++, fullName: `${org}/${name}` };
    },
    grantTeamRepo: async (
      _env: unknown,
      _inst: number,
      _org: string,
      team: string,
      repo: string,
    ) => {
      if (state.grantFails) {
        throw Object.assign(new Error("bad gateway"), { status: 502 });
      }
      state.grants.push({ team, repo });
    },
    orgRepoActivity: async () => {
      if (state.activityFails) {
        throw Object.assign(new Error("rate limited"), { status: 403 });
      }
      return new Map(Object.entries(state.activity));
    },
  };
});

vi.mock("../src/lib/github/team", () => ({
  teamMembers: async (
    _env: unknown,
    _inst: number,
    _org: string,
    slug: string,
  ) => state.rosters[slug] ?? null,
  createTeam: async (
    _env: unknown,
    _inst: number,
    _org: string,
    name: string,
  ) => ({
    id: Math.floor(Math.random() * 1e6),
    slug: name.toLowerCase(),
    name,
  }),
  addTeamMember: async (
    _env: unknown,
    _inst: number,
    _org: string,
    slug: string,
    username: string,
  ) => {
    state.rosters[slug] = [
      ...(state.rosters[slug] ?? []),
      username === "alice"
        ? alice
        : { id: 0, login: username, avatarUrl: null },
    ];
  },
}));

const { labGroupsRoutes } = await import("../src/routes/lab-groups");

const app = new Hono().route("/api", labGroupsRoutes);
const db = getDb(env.DB);
const now = new Date(0);

const alice = { id: 7, login: "alice", avatarUrl: "http://a" };
const bob = { id: 8, login: "bob", avatarUrl: null };
const carol = { id: 9, login: "carol", avatarUrl: null };

type GroupResp = { group: { id: string; name: string; slug: string } };
type RepoResp = { repo: { fullName: string } };
const asGroup = (r: Response) => r.json() as Promise<GroupResp>;
const asRepo = (r: Response) => r.json() as Promise<RepoResp>;

async function seedLab(args?: {
  id?: string;
  groupMode?: "individual" | "group";
  minMembers?: number | null;
  maxMembers?: number | null;
  templateRepoFullName?: string;
  startAt?: Date;
}) {
  const id = args?.id ?? "l1";
  await db.insert(labs).values({
    id,
    classId: "c1",
    title: `Lab ${id}`, // distinct titles → distinct lab slugs
    deadline: new Date("2099-01-01"),
    startAt: args?.startAt ?? null,
    groupMode: args?.groupMode ?? "group",
    minMembers: args?.minMembers ?? 1,
    maxMembers: args?.maxMembers ?? 3,
    templateRepoFullName: args?.templateRepoFullName ?? null,
    createdByUserId: "u1",
    createdAt: now,
    updatedAt: now,
  });
}

/** A group as it really exists: the row, the GitHub team roster, and the
 *  `group_members` mirror that read paths serve from. Stating `members` once
 *  keeps the two in sync, which is what every non-drift test wants. */
async function seedGroup(args: {
  id: string;
  labId: string;
  name?: string;
  repo?: boolean;
  members?: { id: number; login: string; avatarUrl: string | null }[];
}) {
  await db.insert(groups).values({
    id: args.id,
    labId: args.labId,
    ghTeamId: Math.floor(Math.random() * 1e6),
    ghTeamSlug: `${args.id}-slug`,
    slug: `${args.labId}-${args.id}`,
    name: args.name ?? `Group ${args.id}`,
    ghRepoId: args.repo ? Math.floor(Math.random() * 1e6) : null,
    ghRepoFullName: args.repo ? `acme/${args.id}` : null,
    creatorUserId: "u1",
    createdAt: now,
    updatedAt: now,
  });
  if (args.members) await seedRoster(args.id, args.members);
}

/** GitHub's team roster + the cache that mirrors it. */
async function seedRoster(
  groupId: string,
  people: { id: number; login: string; avatarUrl: string | null }[],
) {
  state.rosters[`${groupId}-slug`] = people;
  if (people.length === 0) return;
  await db.insert(groupMembers).values(
    people.map((p) => ({
      id: `${groupId}-${p.id}`,
      groupId,
      githubId: String(p.id),
      login: p.login,
      avatarUrl: p.avatarUrl,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

/** A live class membership — the reuse eligibility rules check enrollment. */
async function seedClassMember(
  person: { id: number; login: string },
  memberState: "active" | "teacher" | "pending" = "active",
) {
  await db.insert(classMembers).values({
    id: `cm-${person.id}`,
    classId: "c1",
    githubId: String(person.id),
    state: memberState,
    login: person.login,
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
  });
}

function createGroup(labId: string, body: object) {
  return app.request(
    `/api/classes/c1/labs/${labId}/groups`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}
const repo = (labId: string, groupId: string) =>
  app.request(
    `/api/classes/c1/labs/${labId}/groups/${groupId}/repo`,
    { method: "POST" },
    env,
  );
const batch = (labId: string) =>
  app.request(`/api/classes/c1/labs/${labId}/repos`, { method: "POST" }, env);
const accept = (labId: string) =>
  app.request(`/api/classes/c1/labs/${labId}/accept`, { method: "POST" }, env);

beforeEach(async () => {
  state.session = { user: { id: "u1" } };
  state.membership = { state: "active", role: "member" };
  state.rosters = {};
  state.activity = {};
  state.activityFails = false;
  state.orgRepos = {};
  state.templateGone = false;
  state.grants = [];
  state.grantFails = false;
  state.profileCalls = 0;
  state.orgLoginCalls = 0;

  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(labs);
  await db.delete(classMembers);
  await db.delete(classes);
  await db.delete(account);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "U1", email: "u1@x.ch" });
  await db.insert(account).values({
    id: "a1",
    userId: "u1",
    providerId: "github",
    accountId: "7",
    accessToken: "tok",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(classes).values({
    id: "c1",
    orgId: 42,
    installationId: 100,
    connectedByUserId: "u1",
    joinToken: "tok-c1",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
});

// --- create (lab-scoped) ---

test("a student creates a group in the lab and auto-joins it", async () => {
  await seedLab();
  const res = await createGroup("l1", { name: "Alpha" });
  expect(res.status).toBe(200);
  expect((await asGroup(res)).group).toMatchObject({
    name: "Alpha",
    slug: "lab-l1-alpha",
  });
  const rows = await db.select().from(groups);
  expect(rows).toMatchObject([
    { labId: "l1", name: "Alpha", slug: "lab-l1-alpha" },
  ]);
  // The GitHub team is named by the lab-scoped slug; the creator auto-joins.
  expect(state.rosters["lab-l1-alpha"]).toEqual([alice]);
});

test("a teacher creates a group without joining it", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab();
  await createGroup("l1", { name: "Alpha" });
  expect(state.rosters["lab-l1-alpha"]).toBeUndefined();
});

test("a duplicate display name in the SAME lab is 409 name_taken", async () => {
  await seedLab();
  await seedGroup({ id: "g1", labId: "l1", name: "Alpha" });
  const res = await createGroup("l1", { name: "Alpha" });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "name_taken" });
});

test("the same name reuses freely across labs (per-lab uniqueness)", async () => {
  await seedLab({ id: "l1" });
  await seedLab({ id: "l2" });
  await seedGroup({ id: "g1", labId: "l1", name: "Alpha" });
  const res = await createGroup("l2", { name: "Alpha" });
  expect(res.status).toBe(200);
  expect((await asGroup(res)).group.slug).toBe("lab-l2-alpha");
});

test("copy-forward copies the WHOLE team when nothing blocks it", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab({ id: "l1" });
  await seedLab({ id: "l2" });
  await seedClassMember(alice);
  await seedClassMember(bob);
  await seedGroup({
    id: "src",
    labId: "l2",
    name: "Team",
    members: [alice, bob],
  });

  const res = await createGroup("l1", { name: "Team", copyFromGroupId: "src" });
  expect(res.status).toBe(200);
  expect(
    (state.rosters["lab-l1-team"] ?? []).map((m) => m.login).sort(),
  ).toEqual(["alice", "bob"]);
});

test("copy-forward refuses when a member is already placed in this lab", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab({ id: "l1" });
  await seedLab({ id: "l2" });
  await seedClassMember(alice);
  await seedClassMember(bob);
  await seedGroup({
    id: "src",
    labId: "l2",
    name: "Team",
    members: [alice, bob],
  });
  // bob is already placed in a group of THIS lab (l1) → all-or-nothing: the
  // whole copy is refused, never a partial team.
  await seedGroup({ id: "here", labId: "l1", name: "Here", members: [bob] });

  const res = await createGroup("l1", { name: "Team", copyFromGroupId: "src" });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "member_already_placed" });
  // No team was created on GitHub.
  expect(state.rosters["lab-l1-team"]).toBeUndefined();
});

test("copy-forward refuses a source larger than the lab's max", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab({ id: "l1", maxMembers: 2 });
  await seedLab({ id: "l2" });
  await seedClassMember(alice);
  await seedClassMember(bob);
  await seedClassMember(carol);
  await seedGroup({
    id: "src",
    labId: "l2",
    name: "Team",
    members: [alice, bob, carol],
  });

  const res = await createGroup("l1", { name: "Team", copyFromGroupId: "src" });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "group_too_large" });
});

test("copy-forward refuses when a member is no longer in the class", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab({ id: "l1" });
  await seedLab({ id: "l2" });
  // alice is enrolled; bob has no class_members row (left the org).
  await seedClassMember(alice);
  await seedGroup({
    id: "src",
    labId: "l2",
    name: "Team",
    members: [alice, bob],
  });

  const res = await createGroup("l1", { name: "Team", copyFromGroupId: "src" });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "member_not_in_class" });
});

test("copy-forward refuses an empty source", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab({ id: "l1" });
  await seedLab({ id: "l2" });
  await seedGroup({ id: "src", labId: "l2", name: "Team", members: [] });

  const res = await createGroup("l1", { name: "Team", copyFromGroupId: "src" });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "source_empty" });
});

test("a student cannot copy a group they're not in", async () => {
  // Caller is alice (a plain member). The reusable list never shows her
  // bob+carol's group; posting its id directly is the backstop this covers.
  await seedLab({ id: "l1" });
  await seedLab({ id: "l2" });
  await seedClassMember(alice);
  await seedClassMember(bob);
  await seedClassMember(carol);
  await seedGroup({
    id: "src",
    labId: "l2",
    name: "Team",
    members: [bob, carol],
  });

  const res = await createGroup("l1", { name: "Team", copyFromGroupId: "src" });
  expect(res.status).toBe(404);
  expect(state.rosters["lab-l1-team"]).toBeUndefined();
});

test("reusable lists the caller's groups from OTHER labs only", async () => {
  await seedLab({ id: "l1" });
  await seedLab({ id: "l2" });
  await seedGroup({
    id: "mine",
    labId: "l2",
    name: "Team Alpha",
    members: [alice, bob],
  });
  // alice not in it
  await seedGroup({
    id: "theirs",
    labId: "l2",
    name: "Team Beta",
    members: [carol],
  });
  // current lab → excluded
  await seedGroup({ id: "here", labId: "l1", name: "Here", members: [alice] });

  const res = await app.request("/api/classes/c1/labs/l1/reusable", {}, env);
  const body = (await res.json()) as {
    groups: Array<{ id: string; name: string; labTitle: string }>;
  };
  // Only alice's group from another lab (l2); not theirs, not the current lab.
  expect(body.groups).toMatchObject([
    { id: "mine", name: "Team Alpha", labTitle: "Lab l2" },
  ]);
});

test("reusable annotates each source with its blocker", async () => {
  await seedLab({ id: "l1" });
  await seedLab({ id: "l2" });
  await seedClassMember(alice);
  await seedClassMember(bob);
  // carol has NO live membership — she left the class.
  await seedGroup({
    id: "fine",
    labId: "l2",
    name: "Fine",
    members: [alice, bob],
  });
  await seedGroup({
    id: "gone",
    labId: "l2",
    name: "Gone",
    members: [alice, carol],
  });
  await seedGroup({ id: "solo", labId: "l2", name: "Solo", members: [alice] });
  // bob is already placed in a group of the CURRENT lab.
  await seedGroup({ id: "here", labId: "l1", name: "Here", members: [bob] });

  const res = await app.request("/api/classes/c1/labs/l1/reusable", {}, env);
  const body = (await res.json()) as {
    groups: Array<{ id: string; blocker: { reason: string } | null }>;
  };
  const byId = new Map(body.groups.map((g) => [g.id, g.blocker]));
  expect(byId.get("solo")).toBeNull();
  expect(byId.get("fine")).toEqual({
    reason: "member_already_placed",
    logins: ["bob"],
  });
  expect(byId.get("gone")).toEqual({
    reason: "member_not_in_class",
    logins: ["carol"],
  });
});

test("reusable lists ALL other-lab groups for a teacher, not just their own", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab({ id: "l1" });
  await seedLab({ id: "l2" });
  // The teacher is a member of neither of these.
  await seedGroup({
    id: "alpha",
    labId: "l2",
    name: "Team Alpha",
    members: [alice, bob],
  });
  await seedGroup({
    id: "beta",
    labId: "l2",
    name: "Team Beta",
    members: [carol],
  });
  // current lab → still excluded, even for a teacher
  await seedGroup({ id: "here", labId: "l1", name: "Here", members: [alice] });

  const res = await app.request("/api/classes/c1/labs/l1/reusable", {}, env);
  const body = (await res.json()) as {
    groups: Array<{ id: string; name: string }>;
  };
  // Both other-lab groups are reusable; the current lab's group is not.
  expect(body.groups.map((g) => g.id).sort()).toEqual(["alpha", "beta"]);
});

// --- list ---

test("lists only THIS lab's groups, with roster + repo + activity", async () => {
  await seedLab({ id: "l1" });
  await seedLab({ id: "l2" });
  await seedGroup({
    id: "g1",
    labId: "l1",
    name: "A",
    repo: true,
    members: [alice, bob],
  });
  // other lab
  await seedGroup({ id: "g2", labId: "l2", name: "B", members: [carol] });
  state.activity["acme/g1"] = {
    pushedAt: "2099-02-01T00:00:00Z",
    createdAt: "2099-01-15T00:00:00Z",
  };

  const res = await app.request("/api/classes/c1/labs/l1/groups", {}, env);
  const body = (await res.json()) as {
    groups: Array<{
      id: string;
      name: string;
      repoFullName: string | null;
      pushedAt: string | null;
      repoCreatedAt: string | null;
      members: unknown[];
    }>;
  };
  expect(body.groups.map((g) => g.id)).toEqual(["g1"]);
  expect(body.groups[0]).toMatchObject({
    name: "A",
    repoFullName: "acme/g1",
    pushedAt: "2099-02-01T00:00:00Z",
    repoCreatedAt: "2099-01-15T00:00:00Z",
  });
  expect(body.groups[0]?.members).toEqual([alice, bob]);
});

test("a repo absent from the org listing AND a confirmed 404 is reported missing", async () => {
  await seedLab({ id: "l1" });
  await seedGroup({ id: "g1", labId: "l1", name: "A", repo: true });
  // Not in state.activity (absent from the bulk listing) and not in
  // state.orgRepos either → getOrgRepo's confirm call 404s.

  const res = await app.request("/api/classes/c1/labs/l1/groups", {}, env);
  const body = (await res.json()) as {
    groups: Array<{ repoFullName: string | null; repoStatus: string }>;
  };
  expect(body.groups[0]).toMatchObject({
    repoFullName: "acme/g1",
    repoStatus: "missing",
  });
  const [row] = await db.select().from(groups).where(eq(groups.id, "g1"));
  expect(row?.ghRepoFullName).toBe("acme/g1"); // untouched until Unlink
});

test("a repo absent from the listing but found under a NEW name (renamed) heals silently", async () => {
  await seedLab({ id: "l1" });
  await seedGroup({ id: "g1", labId: "l1", name: "A", repo: true }); // ghRepoFullName: acme/g1
  // Not in state.activity, but the confirm call (by group.slug, "l1-g1")
  // finds it — under a DIFFERENT full name than what's stored.
  state.orgRepos["l1-g1"] = { visible: true };

  const res = await app.request("/api/classes/c1/labs/l1/groups", {}, env);
  const body = (await res.json()) as {
    groups: Array<{ repoFullName: string | null; repoStatus: string }>;
  };
  expect(body.groups[0]).toMatchObject({
    repoFullName: "acme/l1-g1",
    repoStatus: "ok",
  });
  const [row] = await db.select().from(groups).where(eq(groups.id, "g1"));
  expect(row?.ghRepoFullName).toBe("acme/l1-g1"); // healed, not just in the response
});

test("a failed org-listing fetch never reports a repo as missing", async () => {
  await seedLab({ id: "l1" });
  await seedGroup({ id: "g1", labId: "l1", name: "A", repo: true });
  state.activityFails = true;

  const res = await app.request("/api/classes/c1/labs/l1/groups", {}, env);
  const body = (await res.json()) as {
    groups: Array<{ repoFullName: string | null; repoStatus: string }>;
  };
  expect(body.groups[0]).toMatchObject({
    repoFullName: "acme/g1",
    repoStatus: "ok",
  });
  const [row] = await db.select().from(groups).where(eq(groups.id, "g1"));
  expect(row?.ghRepoFullName).toBe("acme/g1"); // never touched
});

// --- the merged head (lab + class + role + membership state) ---

test("the list carries the lab, class identity, role, and membership state", async () => {
  await seedLab();
  const res = await app.request("/api/classes/c1/labs/l1/groups", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    lab: { id: "l1", title: "Lab l1", groupMode: "group" },
    class: { name: null, login: "acme" },
    role: "student",
    membershipState: "active",
  });

  // A live org Owner reads as the teacher.
  state.membership = { state: "active", role: "admin" };
  const asAdmin = await app.request("/api/classes/c1/labs/l1/groups", {}, env);
  expect(await asAdmin.json()).toMatchObject({ role: "teacher" });
});

test("a PENDING invitee gets the header data and an empty roster, not a 404", async () => {
  await seedLab();
  await seedGroup({ id: "g1", labId: "l1", name: "A", members: [bob] });
  state.membership = { state: "pending", role: "member" };

  const res = await app.request("/api/classes/c1/labs/l1/groups", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    lab: { id: "l1" },
    membershipState: "pending",
    groups: [],
    students: [],
  });

  // allowPending is LIST-only: a pending invitee still can't act.
  expect((await createGroup("l1", { name: "Alpha" })).status).toBe(404);
});

test("the people list carries active students AND teachers, never pending", async () => {
  await seedLab();
  await db.insert(classMembers).values([
    {
      id: "cm-s",
      classId: "c1",
      githubId: "7",
      state: "active",
      login: "alice",
      avatarUrl: "http://a",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "cm-t",
      classId: "c1",
      githubId: "500",
      state: "teacher",
      login: "teach",
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "cm-p",
      classId: "c1",
      githubId: "900",
      state: "pending",
      login: "invited",
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const res = await app.request("/api/classes/c1/labs/l1/groups", {}, env);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    students: Array<{ githubId: string }>;
  };
  // The teacher rides along WITH their state — the picker offers them for
  // placement; the "students without a group" strip filters them out.
  expect(
    body.students.toSorted((a, b) => a.githubId.localeCompare(b.githubId)),
  ).toEqual([
    { githubId: "500", login: "teach", avatarUrl: null, state: "teacher" },
    { githubId: "7", login: "alice", avatarUrl: "http://a", state: "active" },
  ]);
});

// --- cached identities (classes.login + class_members) ---

test("cached logins answer the hot path — no profile fetch, no installation lookup", async () => {
  await db.update(classes).set({ login: "acme" }).where(eq(classes.id, "c1"));
  await db.insert(classMembers).values({
    id: "cm1",
    classId: "c1",
    githubId: "7",
    state: "active",
    login: "alice",
    avatarUrl: "http://a",
    createdAt: now,
    updatedAt: now,
  });
  await seedLab();

  const res = await app.request("/api/classes/c1/labs/l1/groups", {}, env);
  expect(res.status).toBe(200);
  expect(state.profileCalls).toBe(0);
  expect(state.orgLoginCalls).toBe(0);
});

test("without cached identities the resolution falls back to the live lookups", async () => {
  // beforeEach seeds no classMembers row and no classes.login.
  await seedLab();
  const res = await app.request("/api/classes/c1/labs/l1/groups", {}, env);
  expect(res.status).toBe(200);
  expect(state.profileCalls).toBe(1);
  expect(state.orgLoginCalls).toBe(1);
});

// --- repo creation ---

test("create repo enforces the lab min, then names the repo by group slug", async () => {
  await seedLab({ minMembers: 2, maxMembers: 3 });
  await seedGroup({ id: "g1", labId: "l1", name: "A" });

  state.rosters["g1-slug"] = [alice]; // under min
  const under = await repo("l1", "g1");
  expect(under.status).toBe(409);
  expect(await under.json()).toEqual({ error: "group_incomplete" });

  state.rosters["g1-slug"] = [alice, bob];
  const ok = await repo("l1", "g1");
  expect(ok.status).toBe(200);
  expect((await asRepo(ok)).repo.fullName).toBe("acme/l1-g1");

  // Idempotent — the group row now carries the repo.
  const again = await repo("l1", "g1");
  expect((await asRepo(again)).repo.fullName).toBe("acme/l1-g1");
});

test("a repo can't be created for a group of ANOTHER lab", async () => {
  await seedLab({ id: "l1" });
  await seedLab({ id: "l2" });
  await seedGroup({ id: "g1", labId: "l2", name: "A" });
  state.rosters["g1-slug"] = [alice];
  expect((await repo("l1", "g1")).status).toBe(404);
});

// --- batch missing repos ---

test("batch is teacher-only and skips under-min groups", async () => {
  await seedLab({ minMembers: 2 });
  expect((await batch("l1")).status).toBe(404); // member

  state.membership = { state: "active", role: "admin" };
  await seedGroup({ id: "g1", labId: "l1", name: "A" }); // complete
  await seedGroup({ id: "g2", labId: "l1", name: "B" }); // under min
  state.rosters["g1-slug"] = [alice, bob];
  state.rosters["g2-slug"] = [carol];

  const res = await batch("l1");
  expect(await res.json()).toEqual({
    created: 1,
    skipped: [{ groupId: "g2", reason: "group_incomplete" }],
  });
  const g1 = (await db.select().from(groups)).find((g) => g.id === "g1");
  expect(g1?.ghRepoFullName).toBe("acme/l1-g1");
});

// --- individual accept ---

test("accept creates the solo group + repo and reuses on replay", async () => {
  await seedLab({
    id: "l2",
    groupMode: "individual",
    minMembers: null,
    maxMembers: null,
  });
  const res = await accept("l2");
  expect(res.status).toBe(200);
  expect((await asRepo(res)).repo.fullName).toBe("acme/lab-l2-alice");
  expect(await db.select().from(groups)).toMatchObject([
    { labId: "l2", name: "alice", slug: "lab-l2-alice" },
  ]);

  const again = await accept("l2");
  expect((await asRepo(again)).repo.fullName).toBe("acme/lab-l2-alice");
  expect(await db.select().from(groups)).toHaveLength(1);
});

test("accept on an EXISTING solo group mirrors its roster into the cache", async () => {
  // The student's own page finds their group by looking for THEMSELVES in its
  // roster. An accept that answers 200 while `group_members` stays empty is a
  // silent no-op on screen — observed live on lab-6-inidividual-tigoes44.
  await seedLab({
    id: "l2",
    groupMode: "individual",
    minMembers: null,
    maxMembers: null,
  });
  // A solo group whose team exists on GitHub, but with NO cached roster (made
  // before the cache existed).
  await seedGroup({ id: "solo", labId: "l2", name: "alice" });
  state.rosters["solo-slug"] = [alice];

  const res = await accept("l2");

  expect(res.status).toBe(200);
  expect(await db.select().from(groupMembers)).toMatchObject([
    { groupId: "solo", githubId: "7", login: "alice" },
  ]);
});

test("accept NEVER adopts an existing repo — collisions refuse", async () => {
  // Adoption used to grant the team push on ANY same-named org repo: a group
  // named to collide with the teacher's private solution would capture it.
  // Collisions now always refuse; a genuinely interrupted create is recovered
  // on the audit page, where the TEACHER approves the link explicitly.
  await seedLab({
    id: "l2",
    groupMode: "individual",
    minMembers: null,
    maxMembers: null,
  });
  // Readable by the App or not — it must make NO difference anymore.
  state.orgRepos["lab-l2-alice"] = { visible: true };

  const res = await accept("l2");

  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "repo_name_taken" });
  // Nothing recorded, nothing granted.
  expect(await db.select().from(groups)).toMatchObject([
    { labId: "l2", ghRepoFullName: null },
  ]);
  expect(state.grants).toEqual([]);
});

test("a create that dies before the grant is healed by the next click", async () => {
  // createWorkRepo persists the row BEFORE granting: a grant failure leaves a
  // recorded repo whose team has no push. The next create request hits the
  // repo-already-recorded branch and re-asserts the grant (regrantWorkRepo).
  await seedLab();
  await seedGroup({ id: "g1", labId: "l1", members: [alice] });
  state.grantFails = true;

  const first = await repo("l1", "g1");
  expect(first.status).toBe(500); // the grant blew up — but the row is written
  expect(await db.select().from(groups)).toMatchObject([
    { id: "g1", ghRepoFullName: "acme/l1-g1" },
  ]);
  expect(state.grants).toEqual([]);

  state.grantFails = false;
  const again = await repo("l1", "g1");
  expect(again.status).toBe(200);
  expect((await asRepo(again)).repo.fullName).toBe("acme/l1-g1");
  expect(state.grants).toEqual([{ team: "g1-slug", repo: "acme/l1-g1" }]);
});

test("accept reports a name collision it cannot read, and never blames a template the lab lacks", async () => {
  await seedLab({
    id: "l2",
    groupMode: "individual",
    minMembers: null,
    maxMembers: null,
  });
  // The name is taken by a repo the App can't see — adoption is impossible.
  state.orgRepos["lab-l2-alice"] = { visible: false };

  const res = await accept("l2");

  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "repo_name_taken" });
});

test("a template deleted since the lab was created answers template_error", async () => {
  // The lab points at starter code that no longer exists (deleted or renamed
  // on GitHub) — /generate 404s. The student must get the same
  // "ask your teacher" answer as an empty template, never a raw 500.
  await seedLab({ templateRepoFullName: "acme/starter-gone" });
  await seedGroup({ id: "g1", labId: "l1", name: "A", members: [alice] });
  state.templateGone = true;

  const res = await repo("l1", "g1");

  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "template_error" });
});

test("accept never adopts the lab's own template repo", async () => {
  // A slug that collides with the template's name, template in the same org.
  // Adopting it would grant the student team PUSH on the starter code.
  await seedLab({
    id: "l2",
    groupMode: "individual",
    minMembers: null,
    maxMembers: null,
    templateRepoFullName: "acme/lab-l2-alice",
  });
  state.orgRepos["lab-l2-alice"] = { visible: true };

  const res = await accept("l2");

  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "repo_name_taken" });
  // Nothing was recorded, and no grant was made against the template.
  expect(await db.select().from(groups)).toMatchObject([
    { labId: "l2", ghRepoFullName: null },
  ]);
});

test("accept refuses group labs", async () => {
  await seedLab(); // group mode
  const res = await accept("l1");
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "group_lab" });
});

// --- scoping ---

test("a lab from another class is unreachable", async () => {
  await db.insert(classes).values({
    id: "c2",
    orgId: 43,
    installationId: 200,
    connectedByUserId: "u1",
    joinToken: "tok-c2",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(labs).values({
    id: "l9",
    classId: "c2",
    title: "Other",
    deadline: new Date("2099-01-01"),
    createdByUserId: "u1",
    createdAt: now,
    updatedAt: now,
  });
  expect((await createGroup("l9", { name: "X" })).status).toBe(404);
});

// --- the start gate (spec 2026-07-23: students act only once the lab opens) ---

const FUTURE_START = new Date("2098-01-01T08:00:00Z"); // < the 2099 deadline

test("a student cannot create a group before the lab starts", async () => {
  await seedLab({ id: "l1", startAt: FUTURE_START });
  const res = await app.request(
    "/api/classes/c1/labs/l1/groups",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alpha" }),
    },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "not_started" });
});

test("a teacher creates groups before the start (the escape hatch)", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab({ id: "l1", startAt: FUTURE_START });
  const res = await app.request(
    "/api/classes/c1/labs/l1/groups",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alpha" }),
    },
    env,
  );
  expect(res.status).toBe(200);
});

test("a student cannot reach the repo before the start — even one a teacher pre-created", async () => {
  await seedLab({ id: "l1", startAt: FUTURE_START });
  await seedGroup({ id: "g1", labId: "l1", repo: true, members: [alice] });
  const res = await app.request(
    "/api/classes/c1/labs/l1/groups/g1/repo",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "not_started" });
});

test("accept refuses an individual lab before the start", async () => {
  await seedLab({ id: "l1", groupMode: "individual", startAt: FUTURE_START });
  const res = await app.request(
    "/api/classes/c1/labs/l1/accept",
    { method: "POST" },
    env,
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "not_started" });
});

test("a past start behaves exactly like no start", async () => {
  await seedLab({ id: "l1", startAt: new Date("2000-01-01T00:00:00Z") });
  const res = await app.request(
    "/api/classes/c1/labs/l1/groups",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alpha" }),
    },
    env,
  );
  expect(res.status).toBe(200);
});

test("a student's list is head-only before the start; the teacher's is full", async () => {
  await seedLab({ id: "l1", startAt: FUTURE_START });
  await seedGroup({ id: "g1", labId: "l1", name: "A", members: [alice] });

  const student = await app.request("/api/classes/c1/labs/l1/groups", {}, env);
  expect(student.status).toBe(200);
  const sBody = (await student.json()) as {
    lab: { startAt: string | null };
    groups: unknown[];
    students: unknown[];
  };
  expect(sBody.groups).toEqual([]);
  expect(sBody.students).toEqual([]);
  expect(sBody.lab.startAt).toBe("2098-01-01T08:00:00.000Z");

  state.membership = { state: "active", role: "admin" };
  const teacher = await app.request("/api/classes/c1/labs/l1/groups", {}, env);
  const tBody = (await teacher.json()) as { groups: unknown[] };
  expect(tBody.groups).toHaveLength(1);
});

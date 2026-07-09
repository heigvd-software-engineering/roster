import { env } from "cloudflare:test";
import {
  account,
  classes,
  getDb,
  groupMembers,
  groups,
  labs,
  user,
} from "@labs/db";
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
  // Repo names ALREADY in the org — creating them 422s. `visible` says whether
  // the App installation can then read the repo back (adoption) or not.
  orgRepos: {} as Record<string, { visible: boolean }>,
}));

vi.mock("../src/lib/auth/config", () => ({
  createAuth: () => ({ api: { getSession: async () => state.session } }),
}));
vi.mock("../src/lib/auth/github-token", () => ({
  githubAccessToken: async () => "tok",
}));
vi.mock("../src/lib/github/user", () => ({
  fetchGithubProfile: async () => ({
    login: "alice",
    id: 7,
    name: "Alice",
    avatarUrl: "http://a",
  }),
}));
vi.mock("../src/lib/github/app", () => ({ orgLogin: async () => "acme" }));
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
    ) => create(org, name),
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
    grantTeamRepo: async () => {},
    orgRepoActivity: async () => new Map(Object.entries(state.activity)),
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
}) {
  const id = args?.id ?? "l1";
  await db.insert(labs).values({
    id,
    classId: "c1",
    title: `Lab ${id}`, // distinct titles → distinct lab slugs
    deadline: new Date("2099-01-01"),
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
  state.orgRepos = {};

  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(labs);
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

test("copy-forward seeds the roster, skipping members already in this lab", async () => {
  state.membership = { state: "active", role: "admin" };
  await seedLab({ id: "l1" });
  await seedLab({ id: "l2" });
  // Source group on another lab: alice + bob.
  await seedGroup({
    id: "src",
    labId: "l2",
    name: "Team",
    members: [alice, bob],
  });
  // bob is already placed in a group of THIS lab (l1).
  await seedGroup({ id: "here", labId: "l1", name: "Here", members: [bob] });

  const res = await createGroup("l1", { name: "Team", copyFromGroupId: "src" });
  expect(res.status).toBe(200);
  // Copied: alice only (bob skipped — already in l1).
  expect(state.rosters["lab-l1-team"]).toEqual([alice]);
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

test("accept adopts a repo that exists on GitHub but was never recorded", async () => {
  // An earlier attempt created the repo and died before writing the row —
  // exactly the state that left lab ccc4262b unacceptable. The lab has NO
  // template, so the old code answered "template_error" here.
  await seedLab({
    id: "l2",
    groupMode: "individual",
    minMembers: null,
    maxMembers: null,
  });
  state.orgRepos["lab-l2-alice"] = { visible: true };

  const res = await accept("l2");

  expect(res.status).toBe(200);
  expect((await asRepo(res)).repo.fullName).toBe("acme/lab-l2-alice");
  expect(await db.select().from(groups)).toMatchObject([
    { labId: "l2", ghRepoFullName: "acme/lab-l2-alice" },
  ]);
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

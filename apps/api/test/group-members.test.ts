import { env } from "cloudflare:test";
import { classes, getDb, groupMembers, groups, labs, user } from "@roster/db";
import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import type { AuthEnv } from "../src/lib/auth/config";

const state = vi.hoisted(() => ({
  /** Team slug -> live GitHub roster. A slug absent from here 404s (null). */
  rosters: {} as Record<
    string,
    { id: number; login: string; avatarUrl: string | null }[]
  >,
}));

vi.mock("../src/lib/github/team", () => ({
  teamMembers: async (_e: unknown, _i: number, _o: string, slug: string) =>
    state.rosters[slug] ?? null,
}));

const { cachedRoster, cachedRosters, syncGroupMembers } = await import(
  "../src/lib/group-members"
);

const db = getDb(env.DB);
const now = new Date(0);
const authEnv = env as unknown as AuthEnv;

type Person = { id: number; login: string; avatarUrl: string | null };

const alice: Person = { id: 1, login: "alice", avatarUrl: "http://a" };
const bob: Person = { id: 2, login: "bob", avatarUrl: null };
const carol: Person = { id: 3, login: "carol", avatarUrl: "http://c" };

let nextTeamId = 1;

async function seedGroup(id: string, slug: string) {
  await db.insert(groups).values({
    id,
    labId: "l1",
    // groups.ghTeamId is globally unique, so this counts up instead of hashing
    // `id`.
    ghTeamId: nextTeamId++,
    ghTeamSlug: slug,
    slug,
    name: id,
    creatorUserId: "u1",
    createdAt: now,
    updatedAt: now,
  });
  return { id, ghTeamSlug: slug };
}

async function seedRows(groupId: string, people: Person[]) {
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

const loginsOf = async (groupId: string) =>
  (await cachedRoster(db, groupId)).map((p) => p.login).sort();

beforeEach(async () => {
  state.rosters = {};
  nextTeamId = 1;
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(labs);
  await db.delete(classes);
  await db.delete(user);
  await db.insert(user).values({ id: "u1", name: "Prof", email: "p@x.ch" });
  await db.insert(classes).values({
    id: "c1",
    orgId: 42,
    installationId: 100,
    connectedByUserId: "u1",
    joinToken: "tok",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(labs).values({
    id: "l1",
    classId: "c1",
    title: "Lab One",
    deadline: now,
    createdByUserId: "u1",
    createdAt: now,
    updatedAt: now,
  });
});

test("sync mirrors the live team into the cache", async () => {
  const g = await seedGroup("g1", "g1-slug");
  state.rosters["g1-slug"] = [alice, bob];

  const live = await syncGroupMembers(db, authEnv, 100, "acme", g);

  expect(live).toEqual([alice, bob]);
  expect(await loginsOf("g1")).toEqual(["alice", "bob"]);
});

test("sync REPLACES: the live list is the roster, not a union with it", async () => {
  const g = await seedGroup("g1", "g1-slug");
  await seedRows("g1", [alice, bob]);
  state.rosters["g1-slug"] = [carol]; // alice and bob are gone on GitHub

  await syncGroupMembers(db, authEnv, 100, "acme", g);

  expect(await loginsOf("g1")).toEqual(["carol"]);
});

test("sync of an EMPTY team empties the cache", async () => {
  const g = await seedGroup("g1", "g1-slug");
  await seedRows("g1", [alice]);
  state.rosters["g1-slug"] = []; // exists, nobody in it

  expect(await syncGroupMembers(db, authEnv, 100, "acme", g)).toEqual([]);
  expect(await loginsOf("g1")).toEqual([]);
});

test("a team GitHub 404s LEAVES THE ROWS ALONE — unknowable, not empty", async () => {
  // The safety property of this cache. A team we merely failed to read must
  // never be mistaken for a team nobody is in: that would destroy the only
  // record of who was in the group. `group-teams` decides a vanished team's
  // fate, and only after the teacher consents.
  const g = await seedGroup("g1", "g1-slug");
  await seedRows("g1", [alice, bob]);
  // no state.rosters["g1-slug"] → teamMembers returns null

  expect(await syncGroupMembers(db, authEnv, 100, "acme", g)).toBeNull();
  expect(await loginsOf("g1")).toEqual(["alice", "bob"]);
});

test("sync touches ONLY its own group", async () => {
  const g1 = await seedGroup("g1", "g1-slug");
  await seedGroup("g2", "g2-slug");
  await seedRows("g1", [alice]);
  await seedRows("g2", [bob, carol]);
  state.rosters["g1-slug"] = [carol];

  await syncGroupMembers(db, authEnv, 100, "acme", g1);

  expect(await loginsOf("g1")).toEqual(["carol"]);
  expect(await loginsOf("g2")).toEqual(["bob", "carol"]);
});

test("sync is idempotent on replay", async () => {
  const g = await seedGroup("g1", "g1-slug");
  state.rosters["g1-slug"] = [alice, bob];

  await syncGroupMembers(db, authEnv, 100, "acme", g);
  await syncGroupMembers(db, authEnv, 100, "acme", g);

  expect(await db.select().from(groupMembers)).toHaveLength(2);
});

test("deleting the group takes its roster with it (FK cascade)", async () => {
  // `deleteGroup` never touches group_members; it relies on this cascade.
  await seedGroup("g1", "g1-slug");
  await seedRows("g1", [alice, bob]);

  await db.delete(groups).where(eq(groups.id, "g1"));

  expect(await db.select().from(groupMembers)).toEqual([]);
});

test("cachedRosters: one query, every asked-for group, empty ones included", async () => {
  await seedGroup("g1", "g1-slug");
  await seedGroup("g2", "g2-slug");
  await seedRows("g1", [alice]);

  const out = await cachedRosters(db, ["g1", "g2"]);

  // A group nobody has joined is empty, not absent: a caller reading `.get(id)`
  // must be able to tell it from a group it never asked for.
  expect(out.get("g1")).toEqual([alice]);
  expect(out.get("g2")).toEqual([]);
});

test("cachedRosters: no ids → no query, no rows", async () => {
  expect(await cachedRosters(db, [])).toEqual(new Map());
});

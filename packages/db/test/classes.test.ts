import { env } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";
import { listClassesByOrgIds, upsertClassByOrgId } from "../src/classes";
import { classes, getDb, user } from "../src/index";

const db = getDb(env.DB);

// Storage isolation between tests isn't guaranteed by the pool config used
// here, so reset explicitly instead of relying on it.
beforeEach(async () => {
  await db.delete(classes);
  await db.delete(user);
  await db.insert(user).values([
    { id: "u1", name: "U1", email: "u1@example.com" },
    { id: "u2", name: "U2", email: "u2@example.com" },
  ]);
});

test("upsert is keyed on orgId (reinstall updates, no duplicate)", async () => {
  const now = new Date(0);
  await upsertClassByOrgId(db, {
    id: "c1",
    orgId: 42,
    installationId: 100,
    connectedByUserId: "u1",
    now,
  });
  await upsertClassByOrgId(db, {
    id: "c2",
    orgId: 42,
    installationId: 200,
    connectedByUserId: "u1",
    now,
  });

  const rows = await listClassesByOrgIds(db, [42]);
  expect(rows).toHaveLength(1);
  const [row] = rows;
  expect(row?.id).toBe("c1");
  expect(row?.installationId).toBe(200);
});

test("listClassesByOrgIds returns rows matching any given orgId", async () => {
  const now = new Date(0);
  await upsertClassByOrgId(db, {
    id: "c1",
    orgId: 42,
    installationId: 1,
    connectedByUserId: "u1",
    now,
  });
  await upsertClassByOrgId(db, {
    id: "c2",
    orgId: 43,
    installationId: 2,
    connectedByUserId: "u1",
    now,
  });

  const hit = await listClassesByOrgIds(db, [42, 99]);
  expect(hit.map((c) => c.orgId)).toEqual([42]);

  expect(await listClassesByOrgIds(db, [])).toEqual([]);
});

import { eq, inArray } from "drizzle-orm";
import type { getDb } from "./index";
import { classes } from "./schema";

type Db = ReturnType<typeof getDb>;

export async function upsertClassByOrgId(
  db: Db,
  args: {
    id: string;
    orgId: number;
    installationId: number;
    connectedByUserId: string;
    now: Date;
  },
) {
  const [row] = await db
    .insert(classes)
    .values({
      id: args.id,
      orgId: args.orgId,
      installationId: args.installationId,
      connectedByUserId: args.connectedByUserId,
      status: "active",
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoUpdate({
      target: classes.orgId,
      set: {
        installationId: args.installationId,
        status: "active",
        updatedAt: args.now,
      },
    })
    .returning();
  return row;
}

export async function listClassesByUser(db: Db, userId: string) {
  return db.select().from(classes).where(eq(classes.connectedByUserId, userId));
}

export async function listClassesByOrgIds(db: Db, orgIds: number[]) {
  if (orgIds.length === 0) {
    return [];
  }
  return db.select().from(classes).where(inArray(classes.orgId, orgIds));
}

export async function getClassById(db: Db, id: string) {
  const [row] = await db.select().from(classes).where(eq(classes.id, id));
  return row;
}

export async function refreshInstallationId(
  db: Db,
  orgId: number,
  installationId: number,
  now: Date,
) {
  await db
    .update(classes)
    .set({ installationId, updatedAt: now })
    .where(eq(classes.orgId, orgId));
}

import { classMembers, type getDb } from "@labs/db";
import { and, eq, notInArray, sql } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;
type MemberState = "pending" | "active";

/**
 * Writers for the `class_members` enrollment DISPLAY CACHE (data-model spec
 * §2): GitHub owns org membership; these run wherever the app already
 * observes it — the join flow and the teacher hub's roster fetch — so the
 * student class list can be a pure DB read. Display only: nothing may
 * authorize against this table.
 */

/** One observed membership state (join flow write point). */
export async function observeMember(
  db: Db,
  classId: string,
  githubId: string,
  state: MemberState,
) {
  const now = new Date();
  await db
    .insert(classMembers)
    .values({
      id: crypto.randomUUID(),
      classId,
      githubId,
      state,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [classMembers.classId, classMembers.githubId],
      set: { state, updatedAt: now },
    });
}

/** Observed NON-membership → drop the stale row (lazy repair). */
export async function forgetMember(db: Db, classId: string, githubId: string) {
  await db
    .delete(classMembers)
    .where(
      and(
        eq(classMembers.classId, classId),
        eq(classMembers.githubId, githubId),
      ),
    );
}

/** Full-roster reconciliation from the teacher hub's orgPeople fetch:
 *  upsert active + pending members, drop everyone no longer on the roster. */
export async function syncRoster(
  db: Db,
  classId: string,
  roster: { active: string[]; pending: string[] },
) {
  const now = new Date();
  const keep = [...roster.active, ...roster.pending];
  await db
    .delete(classMembers)
    .where(
      keep.length === 0
        ? eq(classMembers.classId, classId)
        : and(
            eq(classMembers.classId, classId),
            notInArray(classMembers.githubId, keep),
          ),
    );
  const values = (["active", "pending"] as const).flatMap((state) =>
    roster[state].map((githubId) => ({
      id: crypto.randomUUID(),
      classId,
      githubId,
      state,
      createdAt: now,
      updatedAt: now,
    })),
  );
  if (values.length > 0) {
    await db
      .insert(classMembers)
      .values(values)
      .onConflictDoUpdate({
        target: [classMembers.classId, classMembers.githubId],
        set: { state: sql`excluded.state`, updatedAt: now },
      });
  }
}

import { classMembers, type getDb } from "@labs/db";
import { and, eq, notInArray, sql } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;
type MemberState = "pending" | "active" | "teacher";

/** What a write point knows about the person besides the stable id. */
export type ObservedIdentity = {
  githubId: string;
  login: string | null;
  avatarUrl: string | null;
};

/**
 * Writers for the `class_members` enrollment DISPLAY CACHE (data-model spec
 * §2): GitHub owns org membership; these run wherever the app already
 * observes it — the join flow and the teacher hub's roster fetch — so the
 * student class list (and its teacher popover) can be pure DB reads.
 * Display only: nothing may authorize against this table.
 */

/** One observed membership state (join flow write point). */
export async function observeMember(
  db: Db,
  classId: string,
  identity: ObservedIdentity,
  state: MemberState,
) {
  const now = new Date();
  await db
    .insert(classMembers)
    .values({
      id: crypto.randomUUID(),
      classId,
      githubId: identity.githubId,
      login: identity.login,
      avatarUrl: identity.avatarUrl,
      state,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [classMembers.classId, classMembers.githubId],
      set: {
        state,
        login: identity.login,
        avatarUrl: identity.avatarUrl,
        updatedAt: now,
      },
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
 *  upsert active/pending members + teachers (org Owners), drop everyone no
 *  longer on the roster. */
export async function syncRoster(
  db: Db,
  classId: string,
  roster: {
    active: ObservedIdentity[];
    pending: ObservedIdentity[];
    teacher: ObservedIdentity[];
  },
) {
  const now = new Date();
  const keep = [...roster.active, ...roster.pending, ...roster.teacher].map(
    (p) => p.githubId,
  );
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
  const values = (["active", "pending", "teacher"] as const).flatMap((state) =>
    roster[state].map((identity) => ({
      id: crypto.randomUUID(),
      classId,
      githubId: identity.githubId,
      login: identity.login,
      avatarUrl: identity.avatarUrl,
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
        set: {
          state: sql`excluded.state`,
          login: sql`excluded.login`,
          avatarUrl: sql`excluded.avatar_url`,
          updatedAt: now,
        },
      });
  }
}

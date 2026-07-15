import { classMembers, type getDb } from "@labs/db";
import { and, eq } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;
/** The `class_members.state` enum, straight from the schema — never hand-copied. */
export type MemberState = (typeof classMembers.$inferSelect)["state"];

/** What a write point knows about the person besides the stable id. */
type ObservedIdentity = {
  githubId: string;
  login: string | null;
  avatarUrl: string | null;
};

/**
 * Writers for the `class_members` enrollment DISPLAY CACHE (data-model spec
 * §2): GitHub owns org membership; these run wherever the app already observes
 * it — the join flow, and the roster reconciler when a teacher accepts a finding.
 * Display only: nothing may authorize against this table.
 *
 * Both write ONE person, the one they were handed. There is deliberately no
 * bulk-sweep writer: a "delete everyone absent from the live roster" function
 * would let a stale proposal remove students it never named, which is exactly
 * the blast radius the reconcile design bounds. The roster reconciler diffs in
 * `audit` and applies these one subject at a time.
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

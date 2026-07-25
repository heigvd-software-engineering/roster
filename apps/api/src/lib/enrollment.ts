import { classMembers, type getDb } from "@roster/db";
import { and, eq, sql } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;
/** The `class_members.state` enum, straight from the schema — never hand-copied. */
export type MemberState = (typeof classMembers.$inferSelect)["state"];

/** An UNANSWERED invitation, whichever role it is for. Two states mean
 *  "invited", so asking `state === "pending"` anywhere is a bug waiting for an
 *  invited teacher to walk into it. */
export const isInvited = (state: MemberState) =>
  state === "pending" || state === "pending_teacher";

/**
 * What a write point knows about the person. The two ids are two different
 * ID SPACES and a row may carry either or both — GitHub decides which one a
 * given observation can see:
 *
 * - `githubId` only — a member/Owner off the live roster, or the CALLER
 *   observing their own pending invite (`/orgs/{org}/memberships/{username}`
 *   knows who asked, but not which invitation).
 * - `invitationId` only — an open invite off `/orgs/{org}/invitations`, which
 *   returns login and email but NEVER the invitee's user id.
 * - both — an invite WE sent (`inviteTeacher` picked the invitee, so it knows
 *   the user id, and got the invitation id back).
 *
 * At least one must be set; `observeMember` throws otherwise, because a row
 * identified by neither could never be found again.
 */
type ObservedIdentity = {
  githubId: string | null;
  invitationId?: string | null;
  login: string | null;
  avatarUrl: string | null;
};

/** How a caller names ONE existing row — the two id spaces, discriminated. */
export type MemberKey = { githubId: string } | { invitationId: string };

/**
 * The GitHub USER ids of rows that have one, deduplicated — the input to any
 * `account.accountId` lookup.
 *
 * `githubId` is nullable for exactly one reason (an open invitation nobody can
 * attribute to a user), so on rows already filtered to `active`/`teacher` this
 * drops nothing — it exists to PROVE that to the type system in one place
 * rather than leaving a bare `.filter(id => id !== null)` at every call site,
 * where it reads like a runtime concern that it isn't.
 */
export const memberUserIds = (rows: { githubId: string | null }[]) => [
  ...new Set(rows.map((r) => r.githubId).filter((id) => id !== null)),
];

const keyColumn = (key: MemberKey) =>
  "githubId" in key
    ? eq(classMembers.githubId, key.githubId)
    : eq(classMembers.invitationId, key.invitationId);

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
  const { githubId, invitationId = null, login, avatarUrl } = identity;
  if (githubId === null && invitationId === null) {
    throw new Error(
      "observeMember: a row needs a github id or an invitation id",
    );
  }
  const now = new Date();
  // Upsert on whichever id the OBSERVER can see, so re-observing the same
  // person updates their row instead of duplicating it. An invitation id is
  // the narrower fact — only one write point has it, and when it does the row
  // is that invitation — so it wins the target when both are present.
  const target =
    invitationId !== null
      ? [classMembers.classId, classMembers.invitationId]
      : [classMembers.classId, classMembers.githubId];
  await db
    .insert(classMembers)
    .values({
      id: crypto.randomUUID(),
      classId,
      githubId,
      invitationId,
      login,
      avatarUrl,
      state,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target,
      set: {
        state,
        // Both ids are re-asserted: an observation that learns the OTHER id
        // (an invite we sent, then the same person off the live roster) fills
        // it in rather than leaving the row half-identified. Never widened to
        // null — `?? sql\`excluded\`` is not expressible here, so a writer that
        // knows only one id passes null and we keep what we had via COALESCE.
        githubId: sql`coalesce(${githubId}, ${classMembers.githubId})`,
        invitationId: sql`coalesce(${invitationId}, ${classMembers.invitationId})`,
        login,
        avatarUrl,
        updatedAt: now,
      },
    });
}

/** Observed NON-membership → drop the stale row (lazy repair). */
export async function forgetMember(db: Db, classId: string, key: MemberKey) {
  await db
    .delete(classMembers)
    .where(and(eq(classMembers.classId, classId), keyColumn(key)));
}

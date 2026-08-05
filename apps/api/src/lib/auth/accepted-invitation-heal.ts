import { account, classes, classMembers, getDb } from "@roster/db";
import { and, eq, inArray } from "drizzle-orm";
import { forgetMember, observeMember } from "../enrollment";
import type { AuthEnv } from "./config";

/**
 * Resolve the caller's own accepted org invitations, teacher or student.
 * Called from `customSession`, so it runs on every session read.
 *
 * Both roles get here the same way: something cached a row saying "invited"
 * (`inviteTeacher` sending an Owner invite, or the join flow observing a
 * student's pending membership), and then the person accepted on GitHub, which
 * tells us nothing. Someone showing up is the closest signal we get to "they
 * accepted", which is why this hangs off session reads rather than sign-in
 * alone: a teacher already signed in when they accepted would otherwise stay
 * listed as invited until their next login. Access holds either way (it is
 * always live GitHub state), but without the heal the placeholder survives
 * until a reconcile and a student stays visibly blocked.
 *
 * Writing needs proof the invitation was accepted, and only GitHub has it: a
 * cached `pending_teacher` row is evidence of nothing. So the live role decides
 * the state, `admin` → `teacher` and anything else → `active`, the rule the
 * rest of the app uses (those two states are one membership differing only by
 * role).
 *
 * Two properties keep it cheap:
 *
 * - The DB gate runs first. Almost every session read has no invited row, so it
 *   stops after one indexed query and never touches GitHub. The GitHub call
 *   happens roughly once per accepted invitation, ever.
 * - It heals only the caller's own rows. Everyone else stays reconcile's job,
 *   the same blast radius the display cache has everywhere else.
 *
 * Never throws: a failed heal must not cost anyone their session. The row stays
 * stale and reconcile repairs it, which is the pre-existing behaviour anyway.
 */
export async function healAcceptedInvitations(
  env: AuthEnv,
  userId: string,
): Promise<void> {
  try {
    const db = getDb(env.DB);

    // The caller's GitHub identity. No linked account → nothing to match.
    const [linked] = await db
      .select({ githubId: account.accountId })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "github")));
    if (!linked?.githubId) return;

    // The gate: one indexed lookup (class_members_github_id_idx). A user with
    // nothing outstanding ends here.
    const stale = await db
      .select({
        classId: classMembers.classId,
        invitationId: classMembers.invitationId,
        login: classMembers.login,
        avatarUrl: classMembers.avatarUrl,
      })
      .from(classMembers)
      .where(
        and(
          eq(classMembers.githubId, linked.githubId),
          inArray(classMembers.state, ["pending", "pending_teacher"]),
        ),
      );
    if (stale.length === 0) return;

    // Only now is a GitHub call worth making. Lazy import: `github-token`
    // imports `createAuth` from ./auth/config, which imports this module, so a
    // static import would close the cycle at module-eval time.
    const { githubAccessToken } = await import("./github-token");
    const { userOrgMemberships } = await import("../github/user");

    const token = await githubAccessToken(env, userId);
    if (!token) return;
    const { byLogin } = await userOrgMemberships(token);

    // Which of those classes they are now a live, active member of, and in what
    // role. The cached row proposes; this live answer authorizes the write and
    // decides the state.
    const orgs = await db
      .select({ id: classes.id, login: classes.login })
      .from(classes)
      .where(
        inArray(
          classes.id,
          stale.map((s) => s.classId),
        ),
      );
    const acceptedState = new Map<string, "teacher" | "active">();
    for (const o of orgs) {
      const m = o.login ? byLogin.get(o.login.toLowerCase()) : undefined;
      // `pending` means the invitation is still open, so nothing to heal.
      if (m?.state !== "active") continue;
      acceptedState.set(o.id, m.role === "admin" ? "teacher" : "active");
    }

    for (const row of stale) {
      const state = acceptedState.get(row.classId);
      if (!state) continue;
      // Drop the invitation placeholder, then record the real membership. The
      // delete is keyed on the invitation because that is what makes the row an
      // invitation; the insert carries only the user id, so nothing is left
      // claiming they are still invited.
      if (row.invitationId !== null) {
        await forgetMember(db, row.classId, {
          invitationId: row.invitationId,
        });
      }
      await observeMember(
        db,
        row.classId,
        {
          githubId: linked.githubId,
          login: row.login,
          // Carried over, never blanked: this is a state change, not a fresh
          // observation. Writing null would manufacture drift, and reconcile
          // would offer "changed their avatar" after every accepted invitation.
          avatarUrl: row.avatarUrl,
        },
        state,
      );
    }
  } catch {
    // Silent by contract; see above.
  }
}

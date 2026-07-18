import { account, classes, classMembers, getDb } from "@labs/db";
import { and, eq, inArray } from "drizzle-orm";
import { forgetMember, observeMember } from "../enrollment";
import type { AuthEnv } from "./config";

/**
 * Resolve the caller's OWN accepted org invitations — teacher or student.
 * Called from `customSession`, so it runs whenever the session is read.
 *
 * Both roles get here the same way: something wrote a cached row saying
 * "invited" (`inviteTeacher` sending an Owner invite, or the join flow
 * observing a student's pending membership), and then the person accepted on
 * GitHub, which tells us nothing at all. Without this the placeholder survives
 * until somebody runs a reconcile — they hold the class either way, since
 * access is always live GitHub state, but they keep showing up as invited and
 * a student stays visibly blocked.
 *
 * The live role decides what they become: `admin` → `teacher`, anything else
 * → `active`. That is the same rule the rest of the app uses, because those
 * two states are one membership differing only by role.
 *
 * "Whenever they show up" is the closest signal we get to "they accepted",
 * which is why this hangs off session reads rather than sign-in alone: a
 * teacher who was already signed in when they accepted would otherwise stay
 * listed as invited until their next login. Two properties keep it cheap:
 *
 * - The DB gate runs FIRST. Almost every session read has no invited row, so it
 *   stops after one indexed query and never touches GitHub. The GitHub call
 *   happens roughly once per accepted invitation, ever.
 * - It heals only the CALLER's own rows. Everyone else stays reconcile's job,
 *   which is the same blast radius the display cache has everywhere else.
 *
 * Writing requires PROOF the invitation was accepted, and only GitHub has it:
 * a cached row saying `pending_teacher` is not evidence of anything. So the
 * live membership decides, exactly as the hub's Owner check does.
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

    // THE GATE. One indexed lookup (class_members_github_id_idx), and for a
    // user with nothing outstanding it ends here.
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
    // imports `createAuth` from ./auth/config, and this module is imported BY
    // that config — a static import would close the cycle at module-eval time.
    const { githubAccessToken } = await import("./github-token");
    const { userOrgMemberships } = await import("../github/user");

    const token = await githubAccessToken(env, userId);
    if (!token) return;
    const { byLogin } = await userOrgMemberships(token);

    // Which of those classes they are NOW a live, ACTIVE member of, and in what
    // role. The cached row proposes; this is what authorizes the write — and
    // the role decides the state, exactly as it does everywhere else (`teacher`
    // and `active` are one membership differing only by role).
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
      // `pending` here means the invitation is still open — nothing to heal.
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
          // observation, and we have learned nothing new about their face.
          // Writing null here would manufacture drift — reconcile would then
          // offer "changed their avatar" after every accepted invitation.
          avatarUrl: row.avatarUrl,
        },
        state,
      );
    }
  } catch {
    // Deliberately silent — see the contract above.
  }
}

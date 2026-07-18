import { getDb } from "@labs/db";
import { healAcceptedInvitations } from "./accepted-invitation-heal";
import type { AuthEnv } from "./config";

/**
 * What every session read returns, and what it does on the way.
 *
 * Extracted from the `customSession` plugin so both halves are testable: the
 * plugin itself is Better Auth's to call, but WHAT it does on each read is
 * ours, and a wiring mistake here (dropping the heal, or the flag) is exactly
 * the kind of thing that leaves a green suite and a broken app.
 *
 * Generic over `user`/`session` so the SPA keeps inferring the real session
 * shape through `customSessionClient<Auth>` — narrowing them here would erase
 * the fields the client depends on.
 */
export async function buildSessionPayload<U extends { id: string }, S>(
  env: AuthEnv,
  user: U,
  session: S,
): Promise<{ user: U; session: S; githubLinked: boolean }> {
  // Two independent questions, one round trip. The heal returns immediately
  // unless this user has an outstanding invitation, and never throws — a
  // session read must not depend on it.
  const [, accounts] = await Promise.all([
    healAcceptedInvitations(env, user.id),
    getDb(env.DB).query.account.findMany({
      where: (a, { eq }) => eq(a.userId, user.id),
      columns: { providerId: true },
    }),
  ]);
  return {
    user,
    session,
    // Drives the onboarding gate: true once a `github` account row exists, so
    // the client knows whether to send them through linking without a second
    // request.
    githubLinked: accounts.some((a) => a.providerId === "github"),
  };
}

import { type Class, classes, getDb } from "@labs/db";
import { eq } from "drizzle-orm";
import { authedFactory } from "../factory";
import { githubAccessToken } from "../lib/auth/github-token";
import type { AuthedEnv } from "../lib/auth/require-auth";
import { forgetMember, observeMember } from "../lib/enrollment";
import { orgLogin } from "../lib/github/app";
import { inviteOrgMember, orgInfo, orgMembership } from "../lib/github/org";
import { fetchGithubProfile } from "../lib/github/user";

/**
 * Student-facing join flow. The token IS the authorization — anyone signed in
 * with a usable GitHub link may look up the class behind a link they possess
 * and ask to be invited. Deliberately NO isOrgAdmin here; class ids never
 * appear in this flow. An UNKNOWN token reads as 404 invalid_link, so the
 * response never reveals whether a class exists. A KNOWN token whose class is
 * unreachable reads as 409 class_needs_reconcile — the token is already proven
 * valid at that point, so this hides nothing, and the student deserves to know
 * the link is fine and their teacher has something to fix.
 *
 * Both routes are also write points for the `class_members` enrollment
 * display cache (display only, never authorization): an observed membership
 * state is recorded, observed non-membership drops the row, and org Owners
 * (teachers on their own link) are never cached as enrollees.
 */

type JoinContext = {
  cls: Class;
  login: string;
  username: string;
  /** The caller's GitHub user id, as `class_members`/`account` store it. */
  githubId: string;
  /** The caller's GitHub avatar — cached with the observed membership. */
  avatarUrl: string | null;
};

type Resolved =
  | { ok: true; ctx: JoinContext }
  | {
      ok: false;
      status: 403 | 404 | 409;
      error: "invalid_link" | "github_not_linked" | "class_needs_reconcile";
    };

async function resolveJoin(
  env: AuthedEnv["Bindings"],
  userId: string,
  token: string,
): Promise<Resolved> {
  const db = getDb(env.DB);
  const [cls] = await db
    .select()
    .from(classes)
    .where(eq(classes.joinToken, token));
  if (!cls) {
    return { ok: false, status: 404, error: "invalid_link" };
  }

  const ghToken = await githubAccessToken(env, userId);
  const profile = ghToken ? await fetchGithubProfile(ghToken) : null;
  if (!profile) {
    // Client-side the Auth guard prevents this; the API still refuses cleanly.
    return { ok: false, status: 403, error: "github_not_linked" };
  }

  try {
    const login = await orgLogin(env, cls.installationId);
    return {
      ok: true,
      ctx: {
        cls,
        login,
        username: profile.login,
        githubId: String(profile.id),
        avatarUrl: profile.avatarUrl ?? null,
      },
    };
  } catch {
    // The token is VALID — we found its class. The org is unreachable: the App
    // was uninstalled, or `installationId` went stale on a reinstall the teacher
    // never completed. Saying "invalid link" here blames the student for a link
    // that is perfect, and hides the one thing that would fix it.
    //
    // This reveals nothing the success path doesn't: a healthy class already
    // returns its name and avatar to anyone holding the token. Only an UNKNOWN
    // token still reads as `invalid_link`, so whether a class exists stays
    // hidden from someone who never had the link.
    return { ok: false, status: 409, error: "class_needs_reconcile" };
  }
}

/** Record an observed membership state in the display cache. Owners are
 *  cached as TEACHERS (shown on the student class card), never as
 *  enrollees. */
async function observeMembership(
  db: ReturnType<typeof getDb>,
  cls: Class,
  ctx: JoinContext,
  membership: { state: string; role: string } | null,
) {
  const identity = {
    githubId: ctx.githubId,
    login: ctx.username,
    avatarUrl: ctx.avatarUrl,
  };
  if (!membership) {
    await forgetMember(db, cls.id, ctx.githubId);
    return;
  }
  if (membership.role === "admin") {
    await observeMember(db, cls.id, identity, "teacher");
    return;
  }
  if (membership.state === "active" || membership.state === "pending") {
    await observeMember(db, cls.id, identity, membership.state);
  }
}

/** Class preview + the caller's live membership state for a join link. */
export const previewJoin = authedFactory.createHandlers(async (c) => {
  const token = c.req.param("token");
  if (!token) return c.json({ error: "invalid_link" }, 404);
  const r = await resolveJoin(c.env, c.get("user").id, token);
  if (!r.ok) return c.json({ error: r.error }, r.status);
  const { cls, login, username } = r.ctx;

  const org = await orgInfo(c.env, cls.installationId, login);
  const membership = await orgMembership(
    c.env,
    cls.installationId,
    login,
    username,
  );

  const db = getDb(c.env.DB);
  await observeMembership(db, cls, r.ctx, membership);
  // Keep the org identity cache fresh — the student class list reads it
  // with zero GitHub calls (data-model spec §2).
  if (
    org.login !== cls.login ||
    org.name !== cls.name ||
    org.avatarUrl !== cls.avatarUrl
  ) {
    await db
      .update(classes)
      .set({
        login: org.login,
        name: org.name,
        avatarUrl: org.avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(classes.id, cls.id));
  }

  // `role` lets the UI tell an org owner (teacher on their own link) apart
  // from an enrolled student — "active" alone reads as "enrolled".
  return c.json({
    class: org,
    membership: (membership?.state ?? "none") as "none" | "pending" | "active",
    role: membership?.role ?? null,
  });
});

/** Create the caller's org invite (idempotent; never demotes an Owner). */
export const requestJoin = authedFactory.createHandlers(async (c) => {
  const token = c.req.param("token");
  if (!token) return c.json({ error: "invalid_link" }, 404);
  const r = await resolveJoin(c.env, c.get("user").id, token);
  if (!r.ok) return c.json({ error: r.error }, r.status);
  const { cls, login, username, githubId } = r.ctx;

  const db = getDb(c.env.DB);
  const current = await orgMembership(
    c.env,
    cls.installationId,
    login,
    username,
  );
  // Existing membership (active, or any pending invite) is left untouched:
  // replaying is a no-op, and an org OWNER opening their own link must never
  // be demoted by a role:"member" PUT.
  if (current) {
    await observeMembership(db, cls, r.ctx, current);
    return c.json({ membership: current.state, role: current.role });
  }
  const membership = await inviteOrgMember(
    c.env,
    cls.installationId,
    login,
    username,
  );
  await observeMember(
    db,
    cls.id,
    { githubId, login: username, avatarUrl: r.ctx.avatarUrl },
    "pending",
  );
  // A fresh invite is always role "member" (the PUT above requests it).
  return c.json({ membership, role: "member" });
});

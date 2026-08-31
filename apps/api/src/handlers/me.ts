import { getDb } from "@roster/db";
import { factory } from "../factory";
import { createAuth } from "../lib/auth/config";
import { githubAccessToken } from "../lib/auth/github-token";
import { isSuperAdmin, userCanCreateClasses } from "../lib/auth/super-admin";
import {
  fetchGithubProfile,
  type GithubProfile,
  GithubUnavailableError,
} from "../lib/github/user";

/** The GitHub link's live state. "unknown" means GitHub couldn't answer, and
 *  the gate fails open on it (banner, not onboarding): only a proven-dead
 *  token ("unlinked") sends a user back to re-link. */
type GithubState = "linked" | "unlinked" | "unknown";

/**
 * Current user (Drizzle-inferred `User`), their linked GitHub profile, and the
 * professional email (HES-SO audience: the identity email). The shape reaches
 * the frontend through hc<AppType>, never hand-written.
 */
export const getMe = factory.createHandlers(async (c) => {
  // Client config rides on the boot fetch: the SPA is static assets with no
  // env of its own, so the Worker env is the only configuration surface.
  const githubAppInstallUrl = `https://github.com/apps/${c.env.GITHUB_APP_SLUG}/installations/new`;

  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({
      user: null,
      github: null,
      githubState: "unlinked" as GithubState,
      githubAppInstallUrl,
      githubAccountId: null,
      isSuperAdmin: false,
      canCreateClasses: false,
    });
  }

  const db = getDb(c.env.DB);
  const user = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, session.user.id),
  });

  // GitHub App user tokens expire after 8h. githubAccessToken refreshes an
  // expired one from the stored refresh token, so a stale link heals here
  // instead of bouncing the user back to onboarding.
  const token = await githubAccessToken(c.env, session.user.id);
  let github: GithubProfile | null = null;
  let githubState: GithubState = "unlinked";
  if (token) {
    try {
      github = await fetchGithubProfile(token);
      // "linked" means GitHub is usable right now (we just read the profile
      // with the refreshed token). A null profile is a proven-dead token
      // (401), the only thing that sends the user back to (re)link.
      githubState = github ? "linked" : "unlinked";
    } catch (err) {
      if (!(err instanceof GithubUnavailableError)) throw err;
      // /api/me is the boot fetch and must answer. An outage is not a dead
      // link: report "unknown" and let the SPA fail open with a warning.
      githubState = "unknown";
    }
  }
  // Both capabilities ride the boot fetch: `isSuperAdmin` (config) shows the
  // admin zone, `canCreateClasses` (the grant row, one condition even for
  // admins) shows "New class". Display only: the setup callback and
  // /api/admin re-check server-side.
  const superAdmin = isSuperAdmin(c.env, user?.email);
  const canCreateClasses = user ? await userCanCreateClasses(db, user) : false;

  // Better Auth 1.7 unlinks by account row id, not by provider, and that row
  // is server-side only — so the boot fetch is where the SPA gets it. It is the
  // caller's own account and reaches nobody else's session.
  const githubAccount = await db.query.account.findFirst({
    where: (a, { and, eq }) =>
      and(eq(a.userId, session.user.id), eq(a.providerId, "github")),
    columns: { id: true },
  });

  return c.json({
    user: user ?? null,
    github,
    githubState,
    githubAppInstallUrl,
    githubAccountId: githubAccount?.id ?? null,
    isSuperAdmin: superAdmin,
    canCreateClasses,
  });
});

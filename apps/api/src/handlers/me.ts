import { getDb } from "@labs/db";
import { factory } from "../factory";
import { createAuth } from "../lib/auth/config";
import { githubAccessToken } from "../lib/auth/github-token";
import {
  fetchGithubProfile,
  type GithubProfile,
  GithubUnavailableError,
} from "../lib/github/user";
import { readAffiliationEmails } from "../lib/switch/claims";

/** The GitHub link's LIVE state. "unknown" = GitHub couldn't answer — the
 *  gate fails OPEN on it (banner, not onboarding): only a PROVEN-dead token
 *  ("unlinked") may send a user back to re-link. */
type GithubState = "linked" | "unlinked" | "unknown";

/**
 * Current user (Drizzle-inferred `User`) + their linked GitHub profile + edu-ID
 * affiliation emails, flowing to the frontend via hc<AppType> (no hand shape).
 */
export const getMe = factory.createHandlers(async (c) => {
  // Client config rides on the boot fetch — the SPA has no env of its own
  // (static assets); the Worker env is the single configuration surface.
  const githubAppInstallUrl = `https://github.com/apps/${c.env.GITHUB_APP_SLUG}/installations/new`;

  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({
      user: null,
      github: null,
      githubState: "unlinked" as GithubState,
      affiliations: [] as string[],
      githubAppInstallUrl,
    });
  }

  const db = getDb(c.env.DB);
  const user = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, session.user.id),
  });
  const switchAccount = await db.query.account.findFirst({
    where: (a, { and, eq }) =>
      and(eq(a.userId, session.user.id), eq(a.providerId, "switch")),
    columns: { idToken: true },
  });

  // GitHub App user tokens expire after 8h — githubAccessToken refreshes an
  // expired one with the stored refresh token, so a stale link self-heals
  // here instead of bouncing the user back to onboarding.
  const token = await githubAccessToken(c.env, session.user.id);
  let github: GithubProfile | null = null;
  let githubState: GithubState = "unlinked";
  if (token) {
    try {
      github = await fetchGithubProfile(token);
      // "linked" = GitHub is USABLE right now (we read the profile with the
      // refreshed token). A null profile is a PROVEN-dead token (401) — the
      // gate sends the user to (re)link on that, and only on that.
      githubState = github ? "linked" : "unlinked";
    } catch (err) {
      if (!(err instanceof GithubUnavailableError)) throw err;
      // /api/me is the boot fetch — it must answer. An outage is not a dead
      // link: report "unknown" and let the SPA fail open with a warning.
      githubState = "unknown";
    }
  }
  const affiliations = switchAccount?.idToken
    ? readAffiliationEmails(switchAccount.idToken)
    : [];

  return c.json({
    user: user ?? null,
    github,
    githubState,
    affiliations,
    githubAppInstallUrl,
  });
});

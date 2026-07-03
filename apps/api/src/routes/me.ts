import { getDb } from "@labs/db";
import { Hono } from "hono";
import { createAuth, type Env } from "../auth/config";
import { fetchGithubProfile } from "../github/user";
import { readAffiliationEmails } from "../switch/claims";

/**
 * Current user (Drizzle-inferred `User`) + their linked GitHub profile + edu-ID
 * affiliation emails, flowing to the frontend via hc<AppType> (no hand shape).
 */
export const meRoutes = new Hono<Env>().get("/me", async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({
      user: null,
      github: null,
      githubLinked: false,
      affiliations: [] as string[],
    });
  }

  const db = getDb(c.env.DB);
  const user = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, session.user.id),
  });
  const ghAccount = await db.query.account.findFirst({
    where: (a, { and, eq }) =>
      and(eq(a.userId, session.user.id), eq(a.providerId, "github")),
    columns: { accessToken: true },
  });
  const switchAccount = await db.query.account.findFirst({
    where: (a, { and, eq }) =>
      and(eq(a.userId, session.user.id), eq(a.providerId, "switch")),
    columns: { idToken: true },
  });

  const github = ghAccount?.accessToken
    ? await fetchGithubProfile(ghAccount.accessToken)
    : null;
  const affiliations = switchAccount?.idToken
    ? readAffiliationEmails(switchAccount.idToken)
    : [];

  // `githubLinked` = GitHub is USABLE right now (we read the profile with the
  // stored token). A null profile — no link at all, or a dead/expired token —
  // reports false, so the onboarding gate sends the user to (re)link, for
  // whatever reason it isn't working. Step 2 will refresh an expired token
  // first, so an expired-but-refreshable link self-heals instead of onboarding.
  return c.json({
    user: user ?? null,
    github,
    githubLinked: github !== null,
    affiliations,
  });
});

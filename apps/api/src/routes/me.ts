import { getDb } from "@labs/db";
import { Hono } from "hono";
import { createAuth, type Env } from "../auth";

type GithubProfile = {
  login: string;
  id: number;
  name: string | null;
  avatarUrl: string;
};

/**
 * Fetch the linked user's live GitHub profile with their stored token. Returns
 * null on ANY failure (expired token, rate limit, outage) — a null profile is
 * NOT the same as being unlinked; the link status is tracked separately.
 */
async function fetchGithubProfile(
  token: string,
): Promise<GithubProfile | null> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "labs",
    },
  });
  if (!res.ok) {
    return null;
  }
  const gh = (await res.json()) as {
    login: string;
    id: number;
    name: string | null;
    avatar_url: string;
  };
  return {
    login: gh.login,
    id: gh.id,
    name: gh.name,
    avatarUrl: gh.avatar_url,
  };
}

/** Decode a JWT payload (no verification — it's our own stored id_token). */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const part = jwt.split(".")[1];
  if (!part) {
    return null;
  }
  try {
    const bytes = Uint8Array.from(
      atob(part.replace(/-/g, "+").replace(/_/g, "/")),
      (ch) => ch.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * The user's institutional affiliation emails, from the SWITCH id_token's
 * `swissEduIDLinkedAffiliationMail` claim. Static profile data, so we read it
 * from the stored token — no live call, no token-expiry concern. (The personal
 * `swissEduIDAssociatedMail` is intentionally excluded — it's not an affiliation.)
 */
function readAffiliationEmails(idToken: string): string[] {
  const p = decodeJwtPayload(idToken) as {
    swissEduIDLinkedAffiliationMail?: unknown;
  } | null;
  const linked = p?.swissEduIDLinkedAffiliationMail;
  return Array.isArray(linked) ? (linked as string[]) : [];
}

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
  const githubAccount = await db.query.account.findFirst({
    where: (a, { and, eq }) =>
      and(eq(a.userId, session.user.id), eq(a.providerId, "github")),
    columns: { accessToken: true },
  });
  const switchAccount = await db.query.account.findFirst({
    where: (a, { and, eq }) =>
      and(eq(a.userId, session.user.id), eq(a.providerId, "switch")),
    columns: { idToken: true },
  });

  const github = githubAccount?.accessToken
    ? await fetchGithubProfile(githubAccount.accessToken)
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

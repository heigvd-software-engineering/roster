import { getDb } from "@labs/db";
import { Hono } from "hono";
import { createAuth, type Env } from "../auth";

type GithubProfile = {
  login: string;
  id: number;
  name: string | null;
  avatarUrl: string;
};

/** Fetch the linked user's live GitHub profile with their stored token. */
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

/**
 * Current user (Drizzle-inferred `User`) + their linked GitHub profile, both
 * flowing to the frontend via hc<AppType> with no hand-written shape.
 */
export const meRoutes = new Hono<Env>().get("/me", async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ user: null, github: null });
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

  const github = githubAccount?.accessToken
    ? await fetchGithubProfile(githubAccount.accessToken)
    : null;

  return c.json({ user: user ?? null, github });
});

import { classes, getDb } from "@labs/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { type AuthedEnv, requireAuth } from "../auth/require-auth";
import { orgLogin } from "../github/app";
import { inviteOrgMember, orgInfo, orgMembership } from "../github/org";
import { fetchGithubProfile } from "../github/user";

/**
 * Student-facing join flow. The token IS the authorization — anyone signed in
 * with a usable GitHub link may look up the class behind a link they possess
 * and ask to be invited. Deliberately NO isOrgAdmin here; class ids never
 * appear in this flow. Failures that mean "this link goes nowhere" (unknown
 * token, dead installation) all read as 404 invalid_link so the response
 * doesn't reveal whether a class exists.
 */

type JoinContext = {
  installationId: number;
  login: string;
  username: string;
};

type Resolved =
  | { ok: true; ctx: JoinContext }
  | {
      ok: false;
      status: 403 | 404;
      error: "invalid_link" | "github_not_linked";
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

  const ghAccount = await db.query.account.findFirst({
    where: (a, op) =>
      op.and(op.eq(a.userId, userId), op.eq(a.providerId, "github")),
    columns: { accessToken: true },
  });
  const profile = ghAccount?.accessToken
    ? await fetchGithubProfile(ghAccount.accessToken)
    : null;
  if (!profile) {
    // Client-side the Auth guard prevents this; the API still refuses cleanly.
    return { ok: false, status: 403, error: "github_not_linked" };
  }

  try {
    const login = await orgLogin(env, cls.installationId);
    return {
      ok: true,
      ctx: {
        installationId: cls.installationId,
        login,
        username: profile.login,
      },
    };
  } catch {
    // App uninstalled / installation dead — the link goes nowhere.
    return { ok: false, status: 404, error: "invalid_link" };
  }
}

export const joinRoutes = new Hono<AuthedEnv>()
  .use("/join/*", requireAuth)
  .get("/join/:token", async (c) => {
    const r = await resolveJoin(c.env, c.get("user").id, c.req.param("token"));
    if (!r.ok) return c.json({ error: r.error }, r.status);
    const { installationId, login, username } = r.ctx;

    const org = await orgInfo(c.env, installationId, login);
    const membership = await orgMembership(
      c.env,
      installationId,
      login,
      username,
    );
    return c.json({
      class: org,
      membership: (membership?.state ?? "none") as
        | "none"
        | "pending"
        | "active",
    });
  })
  .post("/join/:token", async (c) => {
    const r = await resolveJoin(c.env, c.get("user").id, c.req.param("token"));
    if (!r.ok) return c.json({ error: r.error }, r.status);
    const { installationId, login, username } = r.ctx;

    const current = await orgMembership(c.env, installationId, login, username);
    // Existing membership (active, or any pending invite) is left untouched:
    // replaying is a no-op, and an org OWNER opening their own link must never
    // be demoted by a role:"member" PUT.
    if (current) {
      return c.json({ membership: current.state });
    }
    const membership = await inviteOrgMember(
      c.env,
      installationId,
      login,
      username,
    );
    return c.json({ membership });
  });

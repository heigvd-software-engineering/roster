import {
  getClassById,
  getDb,
  listClassesByOrgIds,
  refreshInstallationId,
} from "@labs/db";
import { Hono } from "hono";
import { type AuthedEnv, requireAuth } from "../auth/require-auth";
import { appJwtOctokit, installationOctokit } from "../github/clients";
import { callerGithubId, isOrgAdmin } from "../github/teacher";
import { userInstallationsByOrgId } from "../github/user-installations";
import { githubUserToken } from "../github/user-token";

/** Resolves the org login for an installation via the App JWT. The `account`
 *  union includes the (rarer) enterprise-account shape, which has no `login`
 *  field — narrow with `in` rather than assuming the org shape. */
async function orgLogin(env: AuthedEnv["Bindings"], installationId: number) {
  const { data } = await appJwtOctokit(env).request(
    "GET /app/installations/{installation_id}",
    { installation_id: installationId },
  );
  if (!data.account || !("login" in data.account)) {
    throw new Error("installation account has no login");
  }
  return data.account.login;
}

export const classesRoutes = new Hono<AuthedEnv>()
  .use("/classes", requireAuth)
  .use("/classes/*", requireAuth)
  .post("/classes/:id/confirm", async (c) => {
    const db = getDb(c.env.DB);
    const cls = await getClassById(db, c.req.param("id"));
    if (!cls) return c.json({ error: "not_found" }, 404);

    const login = await orgLogin(c.env, cls.installationId);

    // Teacher check: live org Owner. 404 (not 403) — don't confirm existence
    // of a class the caller can't see. `connectedByUserId` is provenance only.
    const ghId = await callerGithubId(db, c.get("user").id);
    if (
      ghId === null ||
      !(await isOrgAdmin(c.env, cls.installationId, login, ghId))
    ) {
      return c.json({ error: "not_found" }, 404);
    }

    const gh = await installationOctokit(c.env, cls.installationId);
    await gh.request("PATCH /orgs/{org}", {
      org: login,
      default_repository_permission: "none",
    });
    const { data } = await gh.request("GET /orgs/{org}", { org: login });
    return c.json({
      ok: data.default_repository_permission === "none",
      org: { login },
    });
  })
  .get("/classes", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");

    // Identity first: no GitHub id or no user token means no installations
    // call is even worth making.
    const ghId = await callerGithubId(db, user.id);
    const token = await githubUserToken(db, user.id);
    if (ghId === null || !token) return c.json({ classes: [] });

    // Reconcile against the user's LIVE installations — the installationId we
    // stored can go stale on reinstall, and an org the user uninstalled the
    // App from must be dropped (its class row is skipped, not deleted).
    const byOrgId = await userInstallationsByOrgId(token);

    const rows = await listClassesByOrgIds(db, [...byOrgId.keys()]);

    const out: Array<{
      id: string;
      orgId: number;
      login: string;
      name: string | null;
      avatarUrl: string;
    }> = [];
    for (const cls of rows) {
      const live = byOrgId.get(cls.orgId);
      if (!live) continue; // App uninstalled from this org — skip.
      try {
        // Teacher check: only live org Owners see the class (installation
        // access alone is NOT enough — students gain it in F8).
        if (!(await isOrgAdmin(c.env, live.installationId, live.login, ghId))) {
          continue;
        }
        if (live.installationId !== cls.installationId) {
          await refreshInstallationId(
            db,
            cls.orgId,
            live.installationId,
            new Date(),
          );
        }
        const gh = await installationOctokit(c.env, live.installationId);
        const { data: org } = await gh.request("GET /orgs/{org}", {
          org: live.login,
        });
        out.push({
          id: cls.id,
          orgId: cls.orgId,
          login: org.login,
          name: org.name ?? null,
          avatarUrl: org.avatar_url,
        });
      } catch {
        // One org's failure (rate limit, revoked install, admin-check error)
        // must not 500 the whole list — skip this class, keep going.
      }
    }
    return c.json({ classes: out });
  });

import {
  getClassById,
  getDb,
  listClassesByUser,
  refreshInstallationId,
} from "@labs/db";
import { Hono } from "hono";
import { Octokit } from "octokit";
import { appJwtOctokit, installationOctokit } from "../github";
import { callerGithubId, isOrgAdmin } from "../github-teacher";
import { githubUserToken } from "../github-user";
import { type AuthedEnv, requireAuth } from "../require-auth";

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
    const rows = await listClassesByUser(db, user.id);
    if (rows.length === 0) return c.json({ classes: [] });

    // Reconcile against the user's LIVE installations — the installationId we
    // stored can go stale on reinstall, and an org the user uninstalled the
    // App from must be dropped (its class row is skipped, not deleted).
    const token = await githubUserToken(db, user.id);
    const userGh = new Octokit({ auth: token });
    const { data: insts } = await userGh.request("GET /user/installations");
    const byOrgId = new Map<
      number,
      { installationId: number; login: string }
    >();
    for (const inst of insts.installations) {
      if (inst.account && "login" in inst.account) {
        byOrgId.set(inst.account.id, {
          installationId: inst.id,
          login: inst.account.login,
        });
      }
    }

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
      if (live.installationId !== cls.installationId) {
        await refreshInstallationId(
          db,
          cls.orgId,
          live.installationId,
          new Date(),
        );
      }
      try {
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
        // A single org's live enrich failing (rate limit, transient GitHub
        // error) shouldn't 500 the whole list — skip that class, keep going.
      }
    }
    return c.json({ classes: out });
  });

import { getClassById, getDb } from "@labs/db";
import { Hono } from "hono";
import { appJwtOctokit, installationOctokit } from "../github";
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
  .use(requireAuth)
  .post("/classes/:id/confirm", async (c) => {
    const cls = await getClassById(getDb(c.env.DB), c.req.param("id"));
    if (!cls) return c.json({ error: "not_found" }, 404);

    const login = await orgLogin(c.env, cls.installationId);
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
  });

import { getDb, upsertClassByOrgId } from "@labs/db";
import { Hono } from "hono";
import { Octokit } from "octokit";
import { createAuth, type Env } from "../auth";
import { appJwtOctokit } from "../github";
import { githubUserToken } from "../github-user";

/**
 * The GitHub App install Setup URL callback. Attributes the new class to the
 * signed-in user (first-party cookie), but that cookie alone doesn't prove
 * THIS user is the one who installed the App on the target installation —
 * installation ids are small enumerable ints, so any signed-in user could
 * otherwise claim any org's installation as their own class. We verify the
 * caller actually has this installation among their own (`GET
 * /user/installations` with their linked GitHub token) before upserting.
 * This server-side ownership check also supersedes the spec's `state` CSRF
 * param — it binds the callback's caller to the installation directly.
 */
export const setupRoutes = new Hono<Env>().get("/github/setup", async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) return c.redirect("/"); // login gate on the SPA takes over

  const installationId = Number(c.req.query("installation_id"));
  if (!installationId) return c.redirect("/?error=no_installation");

  const db = getDb(c.env.DB);
  const token = await githubUserToken(db, session.user.id);
  if (!token) return c.redirect("/?error=github_not_linked");

  const userGh = new Octokit({ auth: token });
  const { data: userInstallations } = await userGh.request(
    "GET /user/installations",
  );
  if (!userInstallations.installations.some((i) => i.id === installationId)) {
    return c.redirect("/?error=not_your_installation");
  }

  const { data } = await appJwtOctokit(c.env).request(
    "GET /app/installations/{installation_id}",
    { installation_id: installationId },
  );
  // The `account` union includes the (rarer) enterprise-account shape, which
  // has no `type` field — narrow with `in` rather than assuming `simple-user`.
  if (
    !data.account ||
    !("type" in data.account) ||
    data.account.type !== "Organization"
  ) {
    return c.redirect("/?error=not_an_org");
  }

  const cls = await upsertClassByOrgId(db, {
    id: crypto.randomUUID(),
    orgId: data.account.id,
    installationId,
    connectedByUserId: session.user.id,
    now: new Date(),
  });
  if (!cls) {
    // `.returning()` after an insert/upsert always yields one row.
    throw new Error("upsertClassByOrgId returned no row");
  }
  return c.redirect(`/classes/${cls.id}/confirm`);
});

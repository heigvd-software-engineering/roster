import { getDb, upsertClassByOrgId } from "@labs/db";
import { Hono } from "hono";
import { createAuth, type Env } from "../auth";
import { appJwtOctokit } from "../github";

/**
 * The GitHub App install Setup URL callback. Attributes the new class to the
 * signed-in user (first-party cookie) and resolves the org via the App JWT —
 * the installing user's org membership isn't re-checked here (GitHub already
 * gated who can install the App on the org).
 */
export const setupRoutes = new Hono<Env>().get("/github/setup", async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) return c.redirect("/"); // login gate on the SPA takes over

  const installationId = Number(c.req.query("installation_id"));
  if (!installationId) return c.redirect("/?error=no_installation");

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

  const cls = await upsertClassByOrgId(getDb(c.env.DB), {
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

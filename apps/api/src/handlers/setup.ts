import { classes, getDb } from "@labs/db";
import { factory } from "../factory";
import { createAuth } from "../lib/auth/config";
import { installationAccount } from "../lib/github/app";
import { userHasInstallation } from "../lib/github/user";
import { mintJoinToken } from "../lib/join-token";

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
export const githubSetupCallback = factory.createHandlers(async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) return c.redirect("/"); // login gate on the SPA takes over

  const installationId = Number(c.req.query("installation_id"));
  if (!installationId) return c.redirect("/?error=no_installation");

  const db = getDb(c.env.DB);
  const ghAccount = await db.query.account.findFirst({
    where: (a, op) =>
      op.and(op.eq(a.userId, session.user.id), op.eq(a.providerId, "github")),
    columns: { accessToken: true },
  });
  const token = ghAccount?.accessToken;
  if (!token) return c.redirect("/?error=github_not_linked");

  if (!(await userHasInstallation(token, installationId))) {
    return c.redirect("/?error=not_your_installation");
  }

  const installAccount = await installationAccount(c.env, installationId);
  if (!installAccount?.isOrganization) {
    return c.redirect("/?error=not_an_org");
  }

  // Upsert keyed on the stable org id: a reinstall refreshes the
  // installation id but must NOT rotate joinToken (the cohort's link) or
  // reassign provenance.
  const now = new Date();
  const [cls] = await db
    .insert(classes)
    .values({
      id: crypto.randomUUID(),
      orgId: installAccount.id,
      installationId,
      connectedByUserId: session.user.id,
      joinToken: mintJoinToken(),
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: classes.orgId,
      set: { installationId, status: "active", updatedAt: now },
    })
    .returning();
  if (!cls) {
    // `.returning()` after an insert/upsert always yields one row.
    throw new Error("class upsert returned no row");
  }
  return c.redirect(`/classes/${cls.id}/confirm`);
});

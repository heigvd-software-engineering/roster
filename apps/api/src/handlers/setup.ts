import { classes, getDb } from "@labs/db";
import { eq } from "drizzle-orm";
import { factory } from "../factory";
import { createAuth } from "../lib/auth/config";
import { githubAccessToken } from "../lib/auth/github-token";
import { installationAccount } from "../lib/github/app";
import { orgInfo } from "../lib/github/org";
import { userHasInstallation } from "../lib/github/user";
import { mintJoinToken } from "../lib/join-token";

/**
 * The GitHub App install Setup URL callback. It does two different jobs, with
 * two different threat models — hence two paths.
 *
 * REPAIR (an existing class). A reinstall mints a new installation id, and
 * GitHub fires the Setup URL in whatever browser performed it — possibly with no
 * labs cookie (the org-settings page; a second org owner who has never signed in
 * here). `installationAccount` runs on the App's OWN JWT, so GitHub — not the
 * caller — names the org that owns this installation. An attacker passing an
 * arbitrary `installation_id` therefore cannot choose the WHERE: GitHub resolves
 * it to that installation's true org, and an App has exactly one installation per
 * org. The worst achievable write is the correct value, or a no-op. So the repair
 * needs no session, no token, and no ownership check — and it writes only the
 * installation pointer and the org identity cache: never `status` (a session-less
 * call must not resurrect a deactivated class), never `joinToken` (the cohort's
 * link), never provenance.
 *
 * CREATE (a new class). Now provenance matters. The cookie alone does not prove
 * THIS user installed the App — installation ids are small enumerable ints, so
 * any signed-in user could otherwise claim any org's installation as their own
 * class. We verify the caller actually holds this installation (`GET
 * /user/installations` with their linked GitHub token). That server-side check
 * also supersedes the spec's `state` CSRF param: it binds the caller to the
 * installation directly.
 */
export const githubSetupCallback = factory.createHandlers(async (c) => {
  const installationId = Number(c.req.query("installation_id"));
  if (!installationId) return c.redirect("/?error=no_installation");

  // The App's own JWT. GitHub answers "which account owns this installation?".
  const installAccount = await installationAccount(c.env, installationId);
  if (!installAccount?.isOrganization) {
    return c.redirect("/?error=not_an_org");
  }

  const db = getDb(c.env.DB);
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  const [existing] = await db
    .select()
    .from(classes)
    .where(eq(classes.orgId, installAccount.id));

  // Seed the org identity cache from the installation we just resolved. The
  // teacher hub renders `login`/`avatarUrl` live off /user/installations, but
  // `name` — and the STUDENT hub's whole card, a pure DB read — come from these
  // columns. Nothing else writes them: the hub no longer does, and the `identity`
  // reconciler only runs when a teacher opens the page. Without this, a freshly
  // connected class has no name until someone reconciles it.
  //
  // It also covers the one drift reconciliation cannot reach: while the App is
  // uninstalled the class vanishes from the hub (no installation token, so no way
  // to authorize the caller), and reconnecting here is the only way back in. If
  // the org was renamed in the meantime, this is where we notice.
  const org = await orgInfo(c.env, installationId, installAccount.login);
  const now = new Date();

  if (existing) {
    await db
      .update(classes)
      .set({
        // Pointer + identity ONLY. Never `status` (a session-less call must not
        // resurrect a deactivated class), never `joinToken`, never provenance.
        installationId,
        login: org.login,
        name: org.name,
        avatarUrl: org.avatarUrl,
        updatedAt: now,
      })
      .where(eq(classes.orgId, installAccount.id));
    // Signed out, the SPA's login gate takes over from "/".
    return c.redirect(session ? `/classes/${existing.id}/confirm` : "/");
  }

  if (!session) return c.redirect("/");
  const token = await githubAccessToken(c.env, session.user.id);
  if (!token) return c.redirect("/?error=github_not_linked");
  if (!(await userHasInstallation(token, installationId))) {
    return c.redirect("/?error=not_your_installation");
  }

  const [cls] = await db
    .insert(classes)
    .values({
      id: crypto.randomUUID(),
      orgId: installAccount.id,
      installationId,
      connectedByUserId: session.user.id,
      joinToken: mintJoinToken(),
      status: "active",
      login: org.login,
      name: org.name,
      avatarUrl: org.avatarUrl,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!cls) {
    // `.returning()` after an insert always yields one row.
    throw new Error("class insert returned no row");
  }
  return c.redirect(`/classes/${cls.id}/confirm`);
});

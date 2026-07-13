import { zValidator } from "@hono/zod-validator";
import { classes, getDb } from "@labs/db";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { authedFactory } from "../factory";
import { callerGithub } from "../lib/access";
import { githubAccessToken } from "../lib/auth/github-token";
import type { AuthedEnv } from "../lib/auth/require-auth";
import { isOrgAdmin } from "../lib/github/org";
import { userInstallationsByOrgId } from "../lib/github/user";
import { applyFindings, runAudit } from "../lib/reconcile";
import { buildContext } from "../lib/reconcile/context";

type Denied = { error: "not_found" | "no_installation"; status: 404 | 403 };

/**
 * Both endpoints resolve the class the same way, and the order matters.
 *
 * The LIVE installation id is derived from `GET /user/installations` BEFORE the
 * authorization check. `resolveClassAsTeacher` would authorize via
 * `orgLogin(cls.installationId)` — the stored pointer — so a stale one would make
 * the page whose whole purpose is to repair it refuse to load.
 *
 * The teacher check is live (`isOrgAdmin`). `class_members` may never authorize:
 * a cached `teacher` row is a display fact, not a role. And `/user/installations`
 * lists installations the caller can ACCESS, not ones they own — a student with
 * push on a work repo appears there — so it decides nothing on its own.
 */
async function teacherContext(
  c: Context<AuthedEnv>,
): Promise<{ ctx: ReturnType<typeof buildContext> } | Denied> {
  const db = getDb(c.env.DB);
  const userId = c.get("user").id;
  const caller = await callerGithub(db, userId);
  const token = await githubAccessToken(c.env, userId);
  if (!caller || !token) return { error: "not_found", status: 404 };

  const [cls] = await db
    .select()
    .from(classes)
    .where(eq(classes.id, c.req.param("id") ?? ""));
  if (!cls) return { error: "not_found", status: 404 };

  const live = (await userInstallationsByOrgId(token)).get(cls.orgId);
  if (!live) return { error: "no_installation", status: 403 };

  const admin = await isOrgAdmin(
    c.env,
    live.installationId,
    live.login,
    caller.ghId,
  );
  if (!admin) return { error: "not_found", status: 404 };

  return { ctx: buildContext(c.env, db, cls, live) };
}

/** Read-only. Runs every reconciler and reports what drifted. Writes nothing —
 *  the teacher decides what, if anything, gets repaired. */
export const auditClass = authedFactory.createHandlers(async (c) => {
  const r = await teacherContext(c);
  if ("error" in r) return c.json({ error: r.error }, r.status);
  const { cls } = r.ctx;
  return c.json({
    auditedAt: new Date().toISOString(),
    // Class identity so the page renders its header from this one request,
    // not a second (expensive) /api/classes fetch just to name the class.
    class: { id: cls.id, name: cls.name, login: cls.login },
    findings: await runAudit(r.ctx),
  });
});

/** A teacher accepts a set of findings by key. Nothing else is touched: the
 *  reconcilers apply exactly these operations, never a bulk sweep. */
const reconcileInput = z.object({ keys: z.array(z.string()).max(200) });

export const reconcileClass = authedFactory.createHandlers(
  zValidator("json", reconcileInput),
  async (c) => {
    const r = await teacherContext(c);
    if ("error" in r) return c.json({ error: r.error }, r.status);
    const { keys } = c.req.valid("json");

    // Only the reconcilers write. This handler dispatches and reports; it does
    // not stamp the class row, because "when Apply last ran" is a different
    // question from "is this class in sync", and only the audit answers that.
    const results = await applyFindings(r.ctx, keys);

    return c.json({
      applied: results.filter((x) => x.ok),
      failed: results.filter((x) => !x.ok),
    });
  },
);

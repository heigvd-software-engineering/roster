import type { getDb, User } from "@roster/db";
import { createMiddleware } from "hono/factory";
import type { AuthEnv } from "./config";
import { createAuth } from "./config";
import type { AuthedEnv } from "./require-auth";

/**
 * Super admins are config, not data: exactly the emails in
 * `SUPER_ADMIN_EMAILS` (comma-separated, case-insensitive, whitespace
 * tolerated). Unset means no super admins and the app fails closed: with an
 * empty `class_creators` table nobody can create classes, so every deployment
 * must set the var (DEPLOY.md).
 */
export function isSuperAdmin(
  env: AuthEnv,
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  return (env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

/** Class creation means a `class_creators` row, one condition for everyone.
 *  Super admins hold no implicit grant; they flip their own toggle in the zone
 *  like anyone else (admin means managing grants, not creating). */
export async function userCanCreateClasses(
  db: ReturnType<typeof getDb>,
  user: Pick<User, "id">,
): Promise<boolean> {
  const row = await db.query.classCreators.findFirst({
    where: (t, { eq }) => eq(t.userId, user.id),
    columns: { userId: true },
  });
  // `!= null` not `!== undefined`: if the ORM's "no row" answer ever became
  // `null`, strict-undefined would fail open and make everyone a class creator.
  return row != null;
}

/** Gate for /api/admin/*: 401 without a session, 403 without admin. The
 *  account-menu link is convenience; this is the security boundary. */
export const requireSuperAdmin = createMiddleware<AuthedEnv>(
  async (c, next) => {
    const session = await createAuth(c.env).api.getSession({
      headers: c.req.raw.headers,
    });
    if (!session) return c.json({ error: "unauthorized" }, 401);
    if (!isSuperAdmin(c.env, session.user.email)) {
      return c.json({ error: "forbidden" }, 403);
    }
    c.set("user", session.user as User);
    return next();
  },
);

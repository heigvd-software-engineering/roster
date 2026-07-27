import type { getDb, User } from "@roster/db";
import { createMiddleware } from "hono/factory";
import type { AuthEnv } from "./config";
import { createAuth } from "./config";
import type { AuthedEnv } from "./require-auth";

/**
 * Super admins are CONFIG, not data: exactly the emails in
 * `SUPER_ADMIN_EMAILS` (comma-separated, case-insensitive, whitespace
 * tolerated). Empty/unset = no super admins — the app FAILS CLOSED:
 * with an empty `class_creators` table nobody can create classes, so
 * every deployment must set the var (DEPLOY.md).
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

/** Class creation = super admin OR a `class_creators` row. Admins are
 *  implicitly creators — they never grant themselves. */
export async function userCanCreateClasses(
  env: AuthEnv,
  db: ReturnType<typeof getDb>,
  user: Pick<User, "id" | "email">,
): Promise<boolean> {
  if (isSuperAdmin(env, user.email)) return true;
  const row = await db.query.classCreators.findFirst({
    where: (t, { eq }) => eq(t.userId, user.id),
    columns: { userId: true },
  });
  return row !== undefined;
}

/** Gate for /api/admin/*: 401 without a session, 403 without admin. The
 *  account-menu link is convenience; THIS is the security boundary. */
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

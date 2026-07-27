import { zValidator } from "@hono/zod-validator";
import { classCreators, getDb, user } from "@roster/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { authedFactory } from "../factory";
import { isSuperAdmin } from "../lib/auth/super-admin";

/**
 * The super-admin zone's data: every SWITCH user in the app (the `user`
 * table IS the SWITCH users), with the ONE derived capability the rest of
 * the app uses — `canCreateClasses` = super admin OR granted row — so the
 * zone never disagrees with the gate. `isSuperAdmin` rides along so the
 * UI can lock those rows (their grant is config, not a toggle).
 * School-scale: no pagination, keyword filtering is client-side.
 */
export const listUsers = authedFactory.createHandlers(async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      grant: classCreators.userId,
    })
    .from(user)
    .leftJoin(classCreators, eq(classCreators.userId, user.id))
    .orderBy(user.name);
  return c.json({
    users: rows.map(({ grant, ...u }) => {
      const admin = isSuperAdmin(c.env, u.email);
      return {
        ...u,
        isSuperAdmin: admin,
        canCreateClasses: admin || grant !== null,
      };
    }),
  });
});

/** PUT = the desired end state; both directions are idempotent. */
export const setClassCreator = authedFactory.createHandlers(
  zValidator("json", z.object({ enabled: z.boolean() })),
  async (c) => {
    // `param` types as string | undefined here (factory handlers don't see
    // the route path) — an absent id is just an unknown user.
    const userId = c.req.param("id");
    if (!userId) return c.json({ error: "not_found" }, 404);
    const { enabled } = c.req.valid("json");
    const db = getDb(c.env.DB);
    const [target] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId));
    if (!target) return c.json({ error: "not_found" }, 404);
    if (enabled) {
      await db
        .insert(classCreators)
        .values({ userId, createdAt: new Date() })
        .onConflictDoNothing();
    } else {
      await db.delete(classCreators).where(eq(classCreators.userId, userId));
    }
    return c.json({ ok: true });
  },
);

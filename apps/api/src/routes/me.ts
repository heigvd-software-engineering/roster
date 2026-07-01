import { getDb } from "@labs/db";
import { Hono } from "hono";
import { createAuth, type Env } from "../auth";

/**
 * Current user, queried from D1 → its type IS the Drizzle-inferred `User`,
 * which flows to the frontend via hc<AppType> with no hand-written shape.
 */
export const meRoutes = new Hono<Env>().get("/me", async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ user: null });
  }
  const user = await getDb(c.env.DB).query.user.findFirst({
    where: (u, { eq }) => eq(u.id, session.user.id),
  });
  return c.json({ user: user ?? null });
});

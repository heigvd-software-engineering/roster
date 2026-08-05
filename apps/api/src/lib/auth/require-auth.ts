import type { User } from "@roster/db";
import { createMiddleware } from "hono/factory";
import type { AppBindings } from "../../env";
import { createAuth } from "./config";

export type AuthedEnv = { Bindings: AppBindings; Variables: { user: User } };

/** Loads the Better Auth session; 401 if absent, else sets a non-null user. */
export const requireAuth = createMiddleware<AuthedEnv>(async (c, next) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("user", session.user as User);
  return next();
});

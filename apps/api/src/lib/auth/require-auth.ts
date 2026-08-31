import type { User } from "@roster/db";
import { createMiddleware } from "hono/factory";
import type { AppBindings } from "../../env";
import { createAuth } from "./config";

export type AuthedEnv = { Bindings: AppBindings; Variables: { user: User } };

/**
 * An actor injected through the env wins; otherwise the Better Auth session
 * decides, 401 if absent. The env branch serves exactly one caller: the MCP
 * lane, which verified a token and resolved its user before re-entering the
 * API internally. External requests cannot reach the env (test 9.1), so for
 * them this middleware behaves as it always has.
 */
export const requireAuth = createMiddleware<AuthedEnv>(async (c, next) => {
  // Optional chain: unit tests mount this middleware with no bindings at all,
  // and `c.env` is then undefined rather than an empty object.
  const actor = c.env?.MCP_ACTOR;
  if (actor) {
    c.set("user", actor);
    return next();
  }
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("user", session.user as User);
  return next();
});

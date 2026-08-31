import { Hono } from "hono";
import { listAssistants } from "../handlers/assistants";
import { type AuthedEnv, requireAuth } from "../lib/auth/require-auth";

export const assistantsRoutes = new Hono<AuthedEnv>()
  .use("/assistants", requireAuth)
  .get("/assistants", ...listAssistants);

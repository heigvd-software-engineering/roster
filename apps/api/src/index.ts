import { Hono } from "hono";
import type { Env } from "./env";
import { requireSameOrigin } from "./lib/http/same-origin";
import { apiSecurityHeaders } from "./lib/http/security-headers";
import { apiOnError } from "./on-error";

export type { Auth } from "./lib/auth/config";

import { adminRoutes } from "./routes/admin";
import { assignmentGroupsRoutes } from "./routes/assignment-groups";
import { assignmentsRoutes } from "./routes/assignments";
import { authRoutes } from "./routes/auth";
import { classesRoutes } from "./routes/classes";
import { groupsRoutes } from "./routes/groups";
import { healthRoutes } from "./routes/health";
import { joinRoutes } from "./routes/join";
import { meRoutes } from "./routes/me";
import { setupRoutes } from "./routes/setup";

// The Worker only handles /api/* (wrangler.jsonc `run_worker_first`); the
// Assets layer serves the SPA, so no ASSETS binding or catch-all fallback is
// needed. `.route()` composes each resource module and its RPC types.
const app = new Hono<Env>()
  // These two guards wrap every API response, the 404 and the 500 included.
  // Rate limits are not here: a limit belongs beside the path it protects, so
  // each route module declares its own (`lib/http/rate-limit.ts`).
  //
  // The SPA's headers are a separate surface, generated into
  // build/client/_headers for the Assets layer
  // (apps/www/scripts/security-headers.mjs).
  .use("/api/*", apiSecurityHeaders, requireSameOrigin)
  .route("/api/auth", authRoutes)
  .route("/api", healthRoutes)
  .route("/api", meRoutes)
  .route("/api", adminRoutes)
  .route("/api", setupRoutes)
  .route("/api", classesRoutes)
  .route("/api", groupsRoutes)
  .route("/api", assignmentGroupsRoutes)
  .route("/api", assignmentsRoutes)
  .route("/api", joinRoutes)
  // Registered last, so it catches only paths no module above matched.
  .all("/api/*", (c) => c.json({ error: "Not found" }, 404))
  // One translator for thrown errors. Tests that mount a route module
  // directly attach it too, so the contract holds everywhere.
  .onError(apiOnError);

export type AppType = typeof app;
export default app;

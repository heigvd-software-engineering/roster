import { hostHeaderValidation } from "@modelcontextprotocol/hono";
import { Hono } from "hono";
import type { Env } from "./env";
import { requireSameOrigin } from "./lib/http/same-origin";
import { apiSecurityHeaders } from "./lib/http/security-headers";
import { handleMcp } from "./lib/mcp/lane";
import { apiOnError } from "./on-error";

export type { Auth } from "./lib/auth/config";

import { adminRoutes } from "./routes/admin";
import { assignmentGroupsRoutes } from "./routes/assignment-groups";
import { assignmentsRoutes } from "./routes/assignments";
import { assistantsRoutes } from "./routes/assistants";
import { authRoutes } from "./routes/auth";
import { classesRoutes } from "./routes/classes";
import { discoveryRoutes } from "./routes/discovery";
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
  // Origin-root discovery, mounted before the /api tree (see the module).
  .route("/", discoveryRoutes)
  .route("/api", healthRoutes)
  .route("/api", meRoutes)
  .route("/api", adminRoutes)
  .route("/api", assistantsRoutes)
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

// The MCP lane (decision #8), mounted on the finished const: an arrow inside
// the chain above would reference `app` in its own initializer and TypeScript
// refuses the circularity. Outside /api/*, so apiSecurityHeaders and
// requireSameOrigin do not apply — and requireSameOrigin would pass anyway
// for a caller that sends no Origin, which is why the adapter's own
// host-header validation is the guard that matters here (the allowed host is
// the one we answer as; a mismatched Host is a DNS-rebinding attempt).
// The mount hands `app` to the lane; the lane never imports it from this
// file — that would be a circular import. `/mcp` is not part of AppType on
// purpose: it is a protocol endpoint, not an RPC surface for the SPA.
app
  .use("/mcp", (c, next) =>
    hostHeaderValidation([new URL(c.env.BETTER_AUTH_URL).hostname])(c, next),
  )
  .all("/mcp", (c) => handleMcp(app, c));

export type AppType = typeof app;
export default app;

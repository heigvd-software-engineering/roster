import { Hono } from "hono";
import type { Env } from "./env";
import { requireSameOrigin } from "./lib/http/same-origin";
import { apiSecurityHeaders } from "./lib/http/security-headers";
import { apiOnError } from "./on-error";

export type { Auth } from "./lib/auth/config";

import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { classesRoutes } from "./routes/classes";
import { groupsRoutes } from "./routes/groups";
import { healthRoutes } from "./routes/health";
import { joinRoutes } from "./routes/join";
import { labGroupsRoutes } from "./routes/lab-groups";
import { labsRoutes } from "./routes/labs";
import { meRoutes } from "./routes/me";
import { setupRoutes } from "./routes/setup";

// The Worker only handles /api/* (wrangler.jsonc `run_worker_first`). The SPA
// and static assets are served by Cloudflare's Assets layer, so the Worker
// needs no ASSETS binding or catch-all fallback. Each resource is its own
// route module under ./routes; `.route()` composes them AND their RPC types.
const app = new Hono<Env>()
  // The two guards that apply to EVERY API response, wrapping the route
  // modules and therefore the 404 and the 500 too: how a response may be
  // rendered (security-headers), and whether a browser says the request came
  // from another site (same-origin). Per-path ceilings are NOT here — a rate
  // limit belongs beside the path it protects, so each route module declares
  // its own (`lib/http/rate-limit.ts`).
  //
  // The SPA's own headers are a DIFFERENT surface — generated into
  // build/client/_headers and served by the Assets layer, which this Worker
  // never sees (apps/www/scripts/security-headers.mjs).
  .use("/api/*", apiSecurityHeaders, requireSameOrigin)
  .route("/api/auth", authRoutes)
  .route("/api", healthRoutes)
  .route("/api", meRoutes)
  .route("/api", adminRoutes)
  .route("/api", setupRoutes)
  .route("/api", classesRoutes)
  .route("/api", groupsRoutes)
  .route("/api", labGroupsRoutes)
  .route("/api", labsRoutes)
  .route("/api", joinRoutes)
  // Unknown API routes return JSON 404s (registered last, so it only catches
  // paths no module above matched).
  .all("/api/*", (c) => c.json({ error: "Not found" }, 404))
  // One translator for thrown errors (GitHub unavailable → 503). Tests that
  // mount a route module directly attach this too — same contract everywhere.
  .onError(apiOnError);

export type AppType = typeof app;
export default app;

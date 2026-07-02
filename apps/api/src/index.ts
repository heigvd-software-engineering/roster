import { Hono } from "hono";
import type { Env } from "./auth/config";

export type { Auth } from "./auth/config";

import { authRoutes } from "./routes/auth";
import { classesRoutes } from "./routes/classes";
import { healthRoutes } from "./routes/health";
import { meRoutes } from "./routes/me";
import { setupRoutes } from "./routes/setup";

// The Worker only handles /api/* (wrangler.jsonc `run_worker_first`). The SPA
// and static assets are served by Cloudflare's Assets layer, so the Worker
// needs no ASSETS binding or catch-all fallback. Each resource is its own
// route module under ./routes; `.route()` composes them AND their RPC types.
const app = new Hono<Env>()
  .route("/api/auth", authRoutes)
  .route("/api", healthRoutes)
  .route("/api", meRoutes)
  .route("/api", setupRoutes)
  .route("/api", classesRoutes)
  // Unknown API routes return JSON 404s (registered last, so it only catches
  // paths no module above matched).
  .all("/api/*", (c) => c.json({ error: "Not found" }, 404));

export type AppType = typeof app;
export default app;

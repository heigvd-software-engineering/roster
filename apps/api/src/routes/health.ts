import { Hono } from "hono";
import type { Env } from "../auth/config";

export const healthRoutes = new Hono<Env>().get("/health", (c) =>
  c.json({ ok: true } as const),
);

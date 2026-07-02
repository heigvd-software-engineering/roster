import { Hono } from "hono";
import type { Env } from "../auth";

export const healthRoutes = new Hono<Env>().get("/health", (c) =>
  c.json({ ok: true } as const),
);

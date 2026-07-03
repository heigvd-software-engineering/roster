import { Hono } from "hono";
import { health } from "../handlers/health";
import type { Env } from "../lib/auth/config";

export const healthRoutes = new Hono<Env>().get("/health", ...health);

import { Hono } from "hono";
import type { Env } from "../auth/config";
import { health } from "../handlers/health";

export const healthRoutes = new Hono<Env>().get("/health", ...health);

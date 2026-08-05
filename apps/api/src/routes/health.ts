import { Hono } from "hono";
import type { Env } from "../env";
import { health } from "../handlers/health";

export const healthRoutes = new Hono<Env>().get("/health", ...health);

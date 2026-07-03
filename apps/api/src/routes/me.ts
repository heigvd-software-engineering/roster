import { Hono } from "hono";
import { getMe } from "../handlers/me";
import type { Env } from "../lib/auth/config";

export const meRoutes = new Hono<Env>().get("/me", ...getMe);

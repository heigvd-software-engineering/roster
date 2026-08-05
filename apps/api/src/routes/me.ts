import { Hono } from "hono";
import type { Env } from "../env";
import { getMe } from "../handlers/me";

export const meRoutes = new Hono<Env>().get("/me", ...getMe);

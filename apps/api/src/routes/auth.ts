import { Hono } from "hono";
import type { Env } from "../auth/config";
import { betterAuthHandler } from "../handlers/auth";

/** Better Auth owns everything under /api/auth/* (mounted at that prefix). */
export const authRoutes = new Hono<Env>().on(
  ["GET", "POST"],
  "/*",
  ...betterAuthHandler,
);

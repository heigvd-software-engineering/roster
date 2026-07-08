import { Hono } from "hono";
import { betterAuthHandler } from "../handlers/auth";
import type { Env } from "../lib/auth/config";

/** Better Auth owns everything under /api/auth/* (mounted at that prefix). */
export const authRoutes = new Hono<Env>().on(
  ["GET", "POST"],
  "/*",
  ...betterAuthHandler,
);

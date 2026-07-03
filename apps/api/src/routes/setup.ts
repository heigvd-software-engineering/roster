import { Hono } from "hono";
import { githubSetupCallback } from "../handlers/setup";
import type { Env } from "../lib/auth/config";

export const setupRoutes = new Hono<Env>().get(
  "/github/setup",
  ...githubSetupCallback,
);

import { Hono } from "hono";
import type { Env } from "../auth/config";
import { githubSetupCallback } from "../handlers/setup";

export const setupRoutes = new Hono<Env>().get(
  "/github/setup",
  ...githubSetupCallback,
);

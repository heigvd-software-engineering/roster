import { Hono } from "hono";
import { createAuth, type Env } from "../auth";

/** Better Auth handles everything under /api/auth/* (mounted at that prefix). */
export const authRoutes = new Hono<Env>().on(["GET", "POST"], "/*", (c) =>
  createAuth(c.env).handler(c.req.raw),
);

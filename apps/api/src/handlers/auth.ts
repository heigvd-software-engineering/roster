import { factory } from "../factory";
import { createAuth } from "../lib/auth/config";

/** Better Auth handles everything under its mount point. */
export const betterAuthHandler = factory.createHandlers((c) =>
  createAuth(c.env).handler(c.req.raw),
);

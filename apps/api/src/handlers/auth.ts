import { createAuth } from "../auth/config";
import { factory } from "../factory";

/** Better Auth handles everything under its mount point. */
export const betterAuthHandler = factory.createHandlers((c) =>
  createAuth(c.env).handler(c.req.raw),
);

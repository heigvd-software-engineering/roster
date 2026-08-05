import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./env";
import { GithubUnavailableError } from "./lib/github/user";

/**
 * The app's one error translator (registered in index.ts; a test that mounts a
 * route module must attach it itself). "GitHub can't answer" is a transient upstream
 * fault, so it answers 503 and the client can retry, never a 404 or 500 that
 * blames the user's link, their join token, or the class. Everything else
 * stays a 500: that's a bug, and a friendlier answer would hide it.
 */
export const apiOnError: ErrorHandler<Env> = (err, c) => {
  if (err instanceof GithubUnavailableError) {
    console.error("github unavailable:", err.message);
    return c.json({ error: "github_unavailable" }, 503);
  }
  if (err instanceof HTTPException) {
    // Hono's own (e.g. malformed auth): keep its intended status.
    return err.getResponse();
  }
  console.error(err);
  return c.json({ error: "internal" }, 500);
};

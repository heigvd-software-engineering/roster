import { createMiddleware } from "hono/factory";
import type { Env } from "../../env";

/** The methods that can CHANGE something. A GET may be expensive, but it is
 *  never the thing CSRF is trying to reach. */
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Refuse a state-changing request that a browser tells us came from another
 * site. Defence in depth: the session cookie is already `SameSite=Lax`, so a
 * cross-site POST carries no credentials and lands on `requireAuth` as a 401.
 * This is the second lock — it holds if the cookie attributes ever change (a
 * `SameSite=None` needed for some future embed), and it costs two header reads.
 *
 * Both signals are browser-CONTROLLED headers a page cannot forge:
 *
 * - `Sec-Fetch-Site: cross-site` — the browser's own verdict, and the one that
 *   still answers correctly when `Origin` is absent.
 * - `Origin` — checked against BETTER_AUTH_URL, the single origin this Worker
 *   serves (`wrangler.jsonc`: one Worker, SPA and API, so first-party cookies).
 *
 * A MISSING `Origin` is allowed through. Browsers send it on every unsafe
 * request, including same-origin form posts, so absence means a non-browser
 * caller — curl, a test, a future CLI — which is not what CSRF is about, and
 * which has no ambient cookie to abuse either. Rejecting on absence would only
 * break those callers.
 *
 * Not `hono/csrf`, deliberately, though it reads the same two headers: that one
 * engages only for form-style content types (its documented threat model),
 * refuses when BOTH signals are absent, and answers plain-text `Forbidden`.
 * Here every unsafe method is covered whatever its content type, a missing
 * `Origin` passes for the reason above, and the refusal is JSON like every
 * other answer this API gives.
 */
export const requireSameOrigin = createMiddleware<Env>(async (c, next) => {
  if (!UNSAFE.has(c.req.method)) return next();

  if (c.req.header("Sec-Fetch-Site") === "cross-site") {
    return c.json({ error: "cross_origin" }, 403);
  }
  const origin = c.req.header("Origin");
  if (
    origin !== undefined &&
    origin !== new URL(c.env.BETTER_AUTH_URL).origin
  ) {
    return c.json({ error: "cross_origin" }, 403);
  }
  return next();
});

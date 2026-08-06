import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import type { Env } from "../../env";

/**
 * Response headers for `/api/*`. `apps/www/scripts/security-headers.mjs`
 * generates the SPA's own headers (CSP included) into `build/client/_headers`,
 * which Cloudflare's Assets layer serves and this Worker never sees: two
 * surfaces on one origin, neither covering the other.
 *
 * An API response needs less than a document does. Nothing here is ever a page,
 * so the whole job is keeping a browser from treating one as a page. Hono's
 * `secureHeaders` carries that set (nosniff, HSTS, COOP, Referrer-Policy, and
 * it drops X-Powered-By); only the two things it can't know are given here:
 * that these responses are never framed or rendered as documents (hence the
 * sandboxing CSP, `default-src 'none'` and no `'self'`), and that every one is
 * per-caller, so no shared cache may hold one.
 */
const headers = secureHeaders({
  // SAMEORIGIN is the default; an API response has no reason to be framed at
  // all.
  xFrameOptions: "DENY",
  referrerPolicy: "no-referrer",
  // Not the SPA's policy: this one forbids everything, because a JSON body has
  // nothing legitimate to load if a browser is ever tricked into rendering it.
  contentSecurityPolicy: {
    defaultSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'none'"],
  },
});

/** `secureHeaders` plus the one header it has no opinion on. */
export const apiSecurityHeaders = createMiddleware<Env>(async (c, next) => {
  await headers(c, next);
  // Only on responses we own: Better Auth's OAuth redirects carry their own
  // caching intent, and no API answer is worth a shared cache anyway.
  if (!c.res.headers.has("Cache-Control")) {
    c.res.headers.set("Cache-Control", "no-store");
  }
});
